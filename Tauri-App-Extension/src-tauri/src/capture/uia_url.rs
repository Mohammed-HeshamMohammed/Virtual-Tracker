//! In-process UI Automation reader for the focused browser's address bar.
//!
//! Replaces spawning `get-browser-url.ps1` on every app-slice tick. Two things
//! made that expensive enough to hurt heavy pages (call-centre dialers and the
//! like, whose accessibility trees are enormous):
//!
//!   1. A fresh `powershell.exe` per tick - process start, `Add-Type`, JIT.
//!   2. A fresh *search* per tick. Locating the omnibox means a
//!      `FindFirst(TreeScope_Descendants)`, and on Chromium a search that has
//!      to enumerate forces the renderer to realise its whole a11y tree.
//!
//! The fix for (2) is that the omnibox element is stable for the lifetime of a
//! browser window - only its *value* changes as you navigate. So search once
//! per window, cache the element, and every later read is a single
//! `CurrentValue()` call: one cheap cross-process hop, no tree walk at all.
//!
//! All UIA work happens on one long-lived worker thread that owns the COM
//! apartment and the cache, so nothing has to be marshalled between threads.
//! Callers get a plain `Option<String>` back over a channel with their own
//! timeout, exactly like the old subprocess path.
//!
//! Windows-only in practice: every caller is behind `#[cfg(windows)]`. The
//! module still compiles everywhere so its tests run on the Linux CI box.
#![cfg_attr(not(windows), allow(dead_code))]

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// One address-bar change, as it happened. Polling every APP_LOG_INTERVAL_SEC
/// only ever sees whatever page a member happened to be on at the sample
/// instant - someone moving through five records in a dialer in fifteen
/// seconds got one of them recorded. Subscribing to the omnibox's value
/// instead means every navigation is seen, with the timestamp it occurred at,
/// so real dwell can be attributed per URL.
#[derive(Debug, Clone)]
pub struct UrlObservation {
    pub hwnd: usize,
    pub url: String,
    pub at: Instant,
}

/// Everything the event handler has recorded since the last call. Ordered
/// oldest-first; consecutive duplicates for one window are already collapsed.
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

/// Attempts allowed before a reader that has never once produced a URL is
/// written off as broken (see `healthy`). Generously more than the handful of
/// ticks a real session needs to hit its first readable address bar.
const TRIAL_ATTEMPTS: u64 = 25;

static ATTEMPTS: AtomicU64 = AtomicU64::new(0);
static SUCCESSES: AtomicU64 = AtomicU64::new(0);

/// Read the address-bar URL for a browser window. `None` when the window has
/// no readable address bar, the reader is unavailable, or it didn't answer
/// within `timeout`.
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

/// Whether a `None` from `read_url` should be trusted as "this window really
/// has no URL" rather than "the reader is broken".
///
/// Safety valve: if this code has a bug, or UIA behaves differently on some
/// machine, the in-process path would silently return `None` forever and URL
/// capture would just stop working with nothing in the logs to say why. After
/// `TRIAL_ATTEMPTS` reads with not one success, we stop trusting it and the
/// caller resumes using the (now much cheaper) script - degrading to the old
/// behaviour instead of losing the feature.
pub fn healthy() -> bool {
    if !available() {
        return false;
    }
    SUCCESSES.load(Ordering::Relaxed) > 0 || ATTEMPTS.load(Ordering::Relaxed) < TRIAL_ATTEMPTS
}

/// Whether the in-process reader is usable at all. `false` means the caller
/// should fall back to the script path (non-Windows, or COM/UIA refused to
/// start).
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

/// Shared with the script path so both produce identical output. Accepts a
/// full http(s) URL, or a bare `host.tld[/path]` which the omnibox shows when
/// the scheme is hidden.
pub fn normalize_url(raw: &str) -> Option<String> {
    let text = raw.trim();
    if text.is_empty() || text.contains(char::is_whitespace) {
        return None;
    }
    if text.starts_with("http://") || text.starts_with("https://") {
        return Some(text.to_string());
    }
    // host.tld, optionally with a path - the omnibox's scheme-less display.
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

    /// Value-changed events we've been handed but not yet reported. Bounded:
    /// the tracker drains this every app-slice tick, so anything past this is
    /// a runaway page redirecting in a loop, not real browsing.
    const MAX_PENDING_OBSERVATIONS: usize = 256;

    static OBSERVATIONS: Mutex<Vec<super::UrlObservation>> = Mutex::new(Vec::new());

    /// Records one address-bar change. Called on a UIA-owned thread, so it
    /// does the absolute minimum: parse, push, return. Anything slow here
    /// back-pressures the browser's own event delivery.
    fn observe(hwnd: usize, raw: &str) {
        let Some(url) = super::normalize_url(raw) else {
            return;
        };
        let mut pending = OBSERVATIONS.lock();
        if pending.last().is_some_and(|last: &super::UrlObservation| {
            last.hwnd == hwnd && last.url == url
        }) {
            // Chromium fires several value-changed events per navigation as
            // the omnibox settles; only the distinct URL matters.
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

    /// COM callback subscribed to one omnibox element's value. `hwnd` is baked
    /// in because the event gives us the element, not the window.
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

    /// How long the worker gives one UIA search before abandoning it. The
    /// caller has its own (shorter) deadline; this only bounds how long the
    /// worker itself stays stuck on a pathological window.
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
        // try_send, not send: a full queue means the worker is stuck on a
        // previous window, and waiting our turn would just move the stall here.
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
                // MTA: this thread only ever makes client calls and may block,
                // which is exactly what Microsoft's UIA client guidance says
                // to keep off an STA.
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
                    // The caller may already have timed out and dropped its
                    // receiver; that's fine, the result is simply discarded.
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
        /// Omnibox element per browser HWND. The element outlives navigation;
        /// only its value changes.
        cache: HashMap<usize, IUIAutomationElement>,
        /// Windows a search has already failed on, so we don't re-walk their
        /// tree every tick. Cleared whenever the cache is trimmed.
        misses: HashMap<usize, u32>,
        /// Live value-changed subscriptions, kept so they can be removed
        /// again - UIA holds the handler alive until we do.
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
                        // Window closed, or the element went stale. Fall
                        // through and search once more.
                        self.cache.remove(&hwnd);
                        self.unsubscribe(hwnd);
                    }
                }
            }

            // A window whose tree we've already searched without finding an
            // address bar isn't going to grow one - don't pay for the walk
            // again on every tick.
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
                // Browser windows come and go; a periodic reset just means a
                // few of them pay for one more search.
                self.unsubscribe_all();
                self.cache.clear();
                self.misses.clear();
            }
            self.cache.insert(hwnd, element.clone());
            self.subscribe(hwnd, &element);
            read_value(&element).ok().and_then(|v| normalize_url(&v))
        }

        /// Subscribe to this omnibox's value so navigations are seen as they
        /// happen rather than sampled once a tick. Scoped to the single
        /// element and the single property - the cheapest subscription UIA
        /// offers, and nothing like walking the tree.
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
                    // Not fatal - polling still works, we just miss
                    // navigations between ticks for this window.
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

    /// `(ControlType is Edit or ComboBox) AND (AutomationId or Name is one we
    /// know)`. One condition, therefore one tree walk - the script used to
    /// issue one search per candidate id and name.
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

        // Union across every engine in capture/browsers.rs: one condition
        // that finds Chromium's omnibox and Firefox's urlbar alike, so a
        // single prebuilt search serves whatever browser the member opens.
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
mod tests {
    use super::normalize_url;

    #[test]
    fn full_urls_pass_through() {
        assert_eq!(
            normalize_url("https://github.com/x?y=1"),
            Some("https://github.com/x?y=1".into())
        );
        assert_eq!(normalize_url("  http://example.com  "), Some("http://example.com".into()));
    }

    #[test]
    fn a_scheme_less_host_gets_https() {
        assert_eq!(normalize_url("example.com"), Some("https://example.com".into()));
        assert_eq!(
            normalize_url("amplifiedprop.readymode.com/#"),
            Some("https://amplifiedprop.readymode.com/#".into())
        );
    }

    #[test]
    fn omnibox_text_that_is_not_a_url_is_rejected() {
        // A half-typed search, an empty bar, or a place name - never a URL.
        for text in ["", "   ", "how to fix uia", "Search Google or type a URL", "readymode"] {
            assert_eq!(normalize_url(text), None, "should reject {text:?}");
        }
    }

    #[test]
    fn a_trailing_or_leading_dot_is_not_a_host() {
        assert_eq!(normalize_url(".com"), None);
        assert_eq!(normalize_url("example."), None);
        assert_eq!(normalize_url("example.4"), None);
    }

    /// End-to-end against a real browser. Ignored by default: needs a desktop
    /// session and an installed Chrome, so it can't run on the Linux CI box.
    /// Run by hand on Windows after touching the UIA code:
    ///
    ///   cargo test --lib -- --ignored --nocapture reads_a_live_browser
    #[cfg(windows)]
    #[test]
    #[ignore = "needs a real desktop session and Chrome installed"]
    fn reads_a_live_browser_address_bar() {
        use std::process::Command;
        use std::time::{Duration, Instant};

        const TARGET: &str = "https://example.com/";
        let chrome = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        ]
        .into_iter()
        .find(|p| std::path::Path::new(p).exists())
        .expect("Chrome not installed");

        let profile = std::env::temp_dir().join(format!("vt-uia-test-{}", std::process::id()));
        let mut child = Command::new(chrome)
            .args([
                &format!("--user-data-dir={}", profile.display()),
                "--no-first-run",
                "--no-default-browser-check",
                "--new-window",
                TARGET,
            ])
            .spawn()
            .expect("launch chrome");

        // Chrome forks; the window belongs to whichever chrome.exe owns it, so
        // ask the OS rather than assuming it's our direct child.
        let hwnd = (|| {
            let deadline = Instant::now() + Duration::from_secs(30);
            while Instant::now() < deadline {
                let out = Command::new("powershell")
                    .args([
                        "-NoProfile",
                        "-Command",
                        "(Get-Process chrome -ErrorAction SilentlyContinue | \
                         Where-Object { $_.MainWindowHandle -ne 0 } | \
                         Select-Object -First 1).MainWindowHandle",
                    ])
                    .output()
                    .ok()?;
                let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if let Ok(handle) = text.parse::<usize>() {
                    if handle != 0 {
                        return Some(handle);
                    }
                }
                std::thread::sleep(Duration::from_millis(500));
            }
            None
        })();

        let result = hwnd.and_then(|hwnd| {
            // First read pays for the tree search, later ones use the cache.
            let mut last = None;
            let deadline = Instant::now() + Duration::from_secs(20);
            while Instant::now() < deadline && last.is_none() {
                last = super::read_url(hwnd, Duration::from_secs(8));
                if last.is_none() {
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
            // Second read should be the cheap cached path.
            let started = Instant::now();
            let cached = super::read_url(hwnd, Duration::from_secs(8));
            eprintln!("cached read took {}ms -> {cached:?}", started.elapsed().as_millis());
            last
        });

        // Solution C: the first read subscribes to the omnibox, so navigating
        // now should surface without anyone polling for it.
        let mut observed: Vec<String> = Vec::new();
        if result.is_some() {
            let _ = super::drain_url_changes(); // discard the initial settle
            let _ = Command::new(chrome)
                .args([
                    &format!("--user-data-dir={}", profile.display()),
                    "https://example.net/",
                ])
                .spawn()
                .map(|mut c| {
                    let _ = c.wait();
                });
            let deadline = Instant::now() + Duration::from_secs(20);
            while Instant::now() < deadline && observed.is_empty() {
                std::thread::sleep(Duration::from_millis(500));
                observed = super::drain_url_changes()
                    .into_iter()
                    .map(|o| o.url)
                    .collect();
            }
            eprintln!("event-driven observations: {observed:?}");
        }

        let _ = child.kill();
        let _ = child.wait();
        let _ = Command::new("taskkill").args(["/F", "/IM", "chrome.exe"]).output();
        let _ = std::fs::remove_dir_all(&profile);

        let url = result.expect("no URL read from a live Chrome window");
        eprintln!("read: {url}");
        assert!(
            url.starts_with("https://example.com"),
            "expected example.com, got {url}"
        );
        assert!(
            observed.iter().any(|u| u.contains("example.net")),
            "value-changed subscription never reported the navigation; saw {observed:?}"
        );
    }
}
