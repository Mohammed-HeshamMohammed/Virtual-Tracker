//! In-process UI Automation reader for the focused browser's address bar.
#![cfg_attr(not(windows), allow(dead_code))]

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// One address-bar change, as it happened.
#[derive(Debug, Clone)]
pub struct UrlObservation {
    pub hwnd: usize,
    pub url: String,
    pub at: Instant,
}

/// Everything the event handler has recorded since the last call.
pub fn drain_url_changes() -> Vec<UrlObservation> {
    #[cfg(windows)]
    {
        imp::drain_observations()
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Attempts allowed before a reader that has never once produced a URL is written off as
/// broken (see `healthy`).
const TRIAL_ATTEMPTS: u64 = 25;

static ATTEMPTS: AtomicU64 = AtomicU64::new(0);
static SUCCESSES: AtomicU64 = AtomicU64::new(0);

/// Read the address-bar URL for a browser window.
#[allow(unused_variables)]
pub fn read_url(hwnd: usize, timeout: Duration) -> Option<String> {
    #[cfg(windows)]
    {
        ATTEMPTS.fetch_add(1, Ordering::Relaxed);
        let url = imp::read_url(hwnd, timeout);
        if url.is_some() {
            SUCCESSES.fetch_add(1, Ordering::Relaxed);
        }
        url
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Whether a `None` from `read_url` should be trusted as "this window really has no URL"
/// rather than "the reader is broken".
pub fn healthy() -> bool {
    if !available() {
        return false;
    }
    SUCCESSES.load(Ordering::Relaxed) > 0 || ATTEMPTS.load(Ordering::Relaxed) < TRIAL_ATTEMPTS
}

/// Whether the in-process reader is usable at all.
pub fn available() -> bool {
    #[cfg(windows)]
    {
        imp::available()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Shared with the script path so both produce identical output.
pub fn normalize_url(raw: &str) -> Option<String> {
    let text = raw.trim();
    if text.is_empty() || text.contains(char::is_whitespace) {
        return None;
    }
    if text.starts_with("http://") || text.starts_with("https://") {
        return Some(text.to_string());
    }
    // Host.tld, optionally with a path - the omnibox's scheme-less display.
    let host = text.split('/').next().unwrap_or("");
    let looks_like_host = host.contains('.')
        && !host.starts_with('.')
        && !host.ends_with('.')
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':')
        && host
            .rsplit('.')
            .next()
            .is_some_and(|tld| tld.len() >= 2 && tld.chars().all(|c| c.is_ascii_alphabetic()));
    if looks_like_host {
        Some(format!("https://{text}"))
    } else {
        None
    }
}

#[cfg(windows)]
mod imp {
    use super::normalize_url;
    use parking_lot::Mutex;
    use std::collections::HashMap;
    use std::sync::mpsc::{sync_channel, SyncSender};
    use std::sync::OnceLock;
    use std::thread;
    use std::time::{Duration, Instant};

    use windows::core::VARIANT;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
    };
    use windows::Win32::UI::Accessibility::{
        CUIAutomation, IUIAutomation, IUIAutomationCondition, IUIAutomationElement,
        IUIAutomationPropertyChangedEventHandler, IUIAutomationPropertyChangedEventHandler_Impl,
        IUIAutomationValuePattern, TreeScope_Descendants, TreeScope_Element,
        UIA_AutomationIdPropertyId, UIA_ComboBoxControlTypeId, UIA_ControlTypePropertyId,
        UIA_EditControlTypeId, UIA_NamePropertyId, UIA_PROPERTY_ID, UIA_ValuePatternId,
        UIA_ValueValuePropertyId,
    };

    /// Value-changed events we've been handed but not yet reported.
    const MAX_PENDING_OBSERVATIONS: usize = 256;

    static OBSERVATIONS: Mutex<Vec<super::UrlObservation>> = Mutex::new(Vec::new());

    /// Records one address-bar change.
    fn observe(hwnd: usize, raw: &str) {
        let Some(url) = super::normalize_url(raw) else {
            return;
        };
        let mut pending = OBSERVATIONS.lock();
        if pending.last().is_some_and(|last: &super::UrlObservation| {
            last.hwnd == hwnd && last.url == url
        }) {
            // Chromium fires several value-changed events per navigation as the omnibox
            // settles; only the distinct URL matters.
            return;
        }
        if pending.len() >= MAX_PENDING_OBSERVATIONS {
            pending.remove(0);
        }
        pending.push(super::UrlObservation {
            hwnd,
            url,
            at: Instant::now(),
        });
    }

    pub fn drain_observations() -> Vec<super::UrlObservation> {
        std::mem::take(&mut *OBSERVATIONS.lock())
    }

    /// COM callback subscribed to one omnibox element's value.
    #[windows::core::implement(IUIAutomationPropertyChangedEventHandler)]
    struct ValueChangeHandler {
        hwnd: usize,
    }

    impl IUIAutomationPropertyChangedEventHandler_Impl for ValueChangeHandler_Impl {
        fn HandlePropertyChangedEvent(
            &self,
            _sender: Option<&IUIAutomationElement>,
            propertyid: UIA_PROPERTY_ID,
            newvalue: &VARIANT,
        ) -> windows::core::Result<()> {
            if propertyid == UIA_ValueValuePropertyId {
                if let Ok(text) = windows::core::BSTR::try_from(newvalue) {
                    observe(self.hwnd, &text.to_string());
                }
            }
            Ok(())
        }
    }

    /// How long the worker gives one UIA search before abandoning it.
    const WORKER_FIND_BUDGET: Duration = Duration::from_secs(6);

    type Reply = SyncSender<Option<String>>;
    type Request = (usize, Reply);

    static REQUESTS: OnceLock<Option<SyncSender<Request>>> = OnceLock::new();

    fn sender() -> Option<&'static SyncSender<Request>> {
        REQUESTS.get_or_init(start_worker).as_ref()
    }

    pub fn available() -> bool {
        sender().is_some()
    }

    pub fn read_url(hwnd: usize, timeout: Duration) -> Option<String> {
        if hwnd == 0 {
            return None;
        }
        let tx = sender()?;
        let (reply_tx, reply_rx) = sync_channel(0);
        // Try_send, not send: a full queue means the worker is stuck on a previous window,
        // and waiting our turn would just move the stall here.
        if tx.try_send((hwnd, reply_tx)).is_err() {
            log::debug!("URL capture: UIA worker busy, skipping this tick");
            return None;
        }
        reply_rx.recv_timeout(timeout).ok().flatten()
    }

    fn start_worker() -> Option<SyncSender<Request>> {
        let (tx, rx) = sync_channel::<Request>(1);
        let started = thread::Builder::new()
            .name("vt-uia".into())
            .spawn(move || {
                // MTA: this thread only ever makes client calls and may block, which is
                // exactly what Microsoft's UIA client guidance says to keep off an STA.
                let init = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
                if init.is_err() {
                    log::warn!("URL capture: CoInitializeEx failed ({init:?}); UIA reader off");
                    // Drain so callers get a prompt None instead of hanging.
                    while let Ok((_, reply)) = rx.recv() {
                        let _ = reply.try_send(None);
                    }
                    return;
                }
                let mut reader = match unsafe { Reader::new() } {
                    Ok(reader) => reader,
                    Err(err) => {
                        log::warn!("URL capture: UIA init failed ({err}); falling back to script");
                        while let Ok((_, reply)) = rx.recv() {
                            let _ = reply.try_send(None);
                        }
                        return;
                    }
                };
                log::info!("URL capture: in-process UIA reader ready");
                while let Ok((hwnd, reply)) = rx.recv() {
                    let url = unsafe { reader.read(hwnd) };
                    // The caller may already have timed out and dropped its receiver;
                    // that's fine, the result is simply discarded.
                    let _ = reply.try_send(url);
                }
            })
            .is_ok();
        if started {
            Some(tx)
        } else {
            None
        }
    }

    struct Reader {
        automation: IUIAutomation,
        omnibox: IUIAutomationCondition,
        /// Omnibox element per browser HWND.
        cache: HashMap<usize, IUIAutomationElement>,
        /// Windows a search has already failed on, so we don't re-walk their tree every
        /// tick.
        misses: HashMap<usize, u32>,
        /// Live value-changed subscriptions, kept so they can be removed again - UIA holds
        /// the handler alive until we do.
        handlers: HashMap<usize, (IUIAutomationElement, IUIAutomationPropertyChangedEventHandler)>,
    }

    impl Reader {
        unsafe fn new() -> windows::core::Result<Self> {
            let automation: IUIAutomation =
                CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)?;
            let omnibox = build_omnibox_condition(&automation)?;
            Ok(Self {
                automation,
                omnibox,
                cache: HashMap::new(),
                misses: HashMap::new(),
                handlers: HashMap::new(),
            })
        }

        unsafe fn read(&mut self, hwnd: usize) -> Option<String> {
            // Fast path - one cross-process property read, no tree walk.
            if let Some(element) = self.cache.get(&hwnd).cloned() {
                match read_value(&element) {
                    Ok(value) => return normalize_url(&value),
                    Err(_) => {
                        // Window closed, or the element went stale.
                        self.cache.remove(&hwnd);
                        self.unsubscribe(hwnd);
                    }
                }
            }

            // A window whose tree we've already searched without finding an address bar
            // isn't going to grow one - don't pay for the walk again on every tick.
            if self.misses.get(&hwnd).is_some_and(|n| *n >= 2) {
                return None;
            }

            let started = std::time::Instant::now();
            let element = self.find(hwnd);
            let elapsed = started.elapsed();
            if elapsed > WORKER_FIND_BUDGET {
                log::warn!(
                    "URL capture: address-bar search on window {hwnd} took {}ms - heavy page",
                    elapsed.as_millis()
                );
            }

            let Some(element) = element else {
                *self.misses.entry(hwnd).or_insert(0) += 1;
                return None;
            };
            self.misses.remove(&hwnd);
            if self.cache.len() > 64 {
                // Browser windows come and go; a periodic reset just means a few of them
                // pay for one more search.
                self.unsubscribe_all();
                self.cache.clear();
                self.misses.clear();
            }
            self.cache.insert(hwnd, element.clone());
            self.subscribe(hwnd, &element);
            read_value(&element).ok().and_then(|v| normalize_url(&v))
        }

        /// Subscribe to this omnibox's value so navigations are seen as they happen rather
        /// than sampled once a tick.
        unsafe fn subscribe(&mut self, hwnd: usize, element: &IUIAutomationElement) {
            if self.handlers.contains_key(&hwnd) {
                return;
            }
            let handler: IUIAutomationPropertyChangedEventHandler =
                ValueChangeHandler { hwnd }.into();
            let registered = self.automation.AddPropertyChangedEventHandlerNativeArray(
                element,
                TreeScope_Element,
                None,
                &handler,
                &[UIA_ValueValuePropertyId],
            );
            match registered {
                Ok(()) => {
                    self.handlers.insert(hwnd, (element.clone(), handler));
                }
                Err(err) => {
                    // Not fatal - polling still works, we just miss navigations between
                    // ticks for this window.
                    log::debug!("URL capture: could not subscribe to window {hwnd}: {err}");
                }
            }
        }

        unsafe fn unsubscribe(&mut self, hwnd: usize) {
            if let Some((element, handler)) = self.handlers.remove(&hwnd) {
                let _ = self
                    .automation
                    .RemovePropertyChangedEventHandler(&element, &handler);
            }
        }

        unsafe fn unsubscribe_all(&mut self) {
            let keys: Vec<usize> = self.handlers.keys().copied().collect();
            for hwnd in keys {
                self.unsubscribe(hwnd);
            }
        }

        unsafe fn find(&self, hwnd: usize) -> Option<IUIAutomationElement> {
            let root = self
                .automation
                .ElementFromHandle(HWND(hwnd as *mut core::ffi::c_void))
                .ok()?;
            root.FindFirst(TreeScope_Descendants, &self.omnibox).ok()
        }
    }

    unsafe fn read_value(element: &IUIAutomationElement) -> windows::core::Result<String> {
        let pattern: IUIAutomationValuePattern =
            element.GetCurrentPatternAs(UIA_ValuePatternId)?;
        Ok(pattern.CurrentValue()?.to_string())
    }

    unsafe fn build_omnibox_condition(
        automation: &IUIAutomation,
    ) -> windows::core::Result<IUIAutomationCondition> {
        let type_conditions: Vec<Option<IUIAutomationCondition>> =
            [UIA_EditControlTypeId, UIA_ComboBoxControlTypeId]
                .iter()
                .map(|control_type| {
                    automation
                        .CreatePropertyCondition(
                            UIA_ControlTypePropertyId,
                            &VARIANT::from(control_type.0),
                        )
                        .ok()
                })
                .collect();

        // Union across every engine in capture/browsers.rs: one condition that finds
        // Chromium's omnibox and Firefox's urlbar alike, so a single prebuilt search serves
        let mut identity_conditions: Vec<Option<IUIAutomationCondition>> = Vec::new();
        for id in crate::capture::browsers::all_omnibox_automation_ids() {
            identity_conditions.push(
                automation
                    .CreatePropertyCondition(UIA_AutomationIdPropertyId, &VARIANT::from(id))
                    .ok(),
            );
        }
        for name in crate::capture::browsers::all_omnibox_names() {
            identity_conditions.push(
                automation
                    .CreatePropertyCondition(UIA_NamePropertyId, &VARIANT::from(name))
                    .ok(),
            );
        }

        let any_type = automation.CreateOrConditionFromNativeArray(&type_conditions)?;
        let any_identity = automation.CreateOrConditionFromNativeArray(&identity_conditions)?;
        automation.CreateAndCondition(&any_type, &any_identity)
    }
}


#[cfg(test)]
#[path = "uia_url_tests.rs"]
mod uia_url_tests;
