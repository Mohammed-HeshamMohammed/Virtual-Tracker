use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::capture::activity::ActivityMeter;
use crate::capture::events::EventBuilder;
use crate::capture::window::get_foreground_window;
use crate::client::api::ApiClient;
use crate::config::Settings;
use crate::constants::{APP_LOG_INTERVAL_SEC, FIRST_SCREENSHOT_DELAY_SEC, SESSION_POLL_SEC};

pub type StatusCallback = Arc<dyn Fn(String) + Send + Sync>;

pub struct ActivityTracker {
    api: Arc<Mutex<ApiClient>>,
    events: EventBuilder,
    activity: Arc<ActivityMeter>,
    on_status: Option<StatusCallback>,
    stop: Arc<AtomicBool>,
    session_id: Arc<Mutex<Option<String>>>,
}

impl ActivityTracker {
    pub fn new(
        api: Arc<Mutex<ApiClient>>,
        settings: &Settings,
        activity: Arc<ActivityMeter>,
        on_status: Option<StatusCallback>,
    ) -> Self {
        let events = EventBuilder::new(
            Arc::clone(&activity),
            settings.url_script_path.clone(),
            settings.macos_url_script_path.clone(),
        );
        Self {
            api,
            events,
            activity,
            on_status,
            stop: Arc::new(AtomicBool::new(false)),
            session_id: Arc::new(Mutex::new(None)),
        }
    }

    pub fn start(self: &Arc<Self>) {
        if !self.stop.swap(false, Ordering::SeqCst) {
            // was already running potentially — always spawn fresh if previous stopped
        }
        self.stop.store(false, Ordering::SeqCst);
        self.activity.start();
        let tracker = Arc::clone(self);
        thread::Builder::new()
            .name("vt-tracker".into())
            .spawn(move || tracker.loop_run())
            .ok();
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        *self.session_id.lock() = None;
    }

    fn emit_status(&self, text: &str) {
        if let Some(cb) = &self.on_status {
            cb(text.to_string());
        }
    }

    fn loop_run(&self) {
        let mut last_app_log_at = Instant::now() - Duration::from_secs(APP_LOG_INTERVAL_SEC);
        let mut next_screenshot_at = Instant::now();
        let mut was_active = false;
        let mut current_session = String::new();

        while !self.stop.load(Ordering::SeqCst) {
            if let Err(err) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                self.tick(
                    &mut last_app_log_at,
                    &mut next_screenshot_at,
                    &mut was_active,
                    &mut current_session,
                );
            })) {
                log::warn!("Tracker tick failed: {err:?}");
            }
            thread::sleep(Duration::from_secs(SESSION_POLL_SEC));
        }
    }

    fn tick(
        &self,
        last_app_log_at: &mut Instant,
        next_screenshot_at: &mut Instant,
        was_active: &mut bool,
        current_session: &mut String,
    ) {
        let session = self.api.lock().fetch_session();
        let Some(session) = session else {
            if *was_active {
                self.emit_status("Signed in — waiting for timer");
            }
            *was_active = false;
            *current_session = String::new();
            *self.session_id.lock() = None;
            return;
        };

        let status = session
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if status != "active" {
            if status == "idle" {
                self.emit_status("Timer idle — capture paused");
            } else if *was_active {
                self.emit_status("Signed in — waiting for timer");
            }
            *was_active = false;
            *current_session = String::new();
            *self.session_id.lock() = None;
            return;
        }

        let session_id = match session.get("id").and_then(|v| v.as_str()) {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => return,
        };

        let window = get_foreground_window();

        if current_session.as_str() != session_id {
            *current_session = session_id.clone();
            *self.session_id.lock() = Some(session_id.clone());
            *last_app_log_at = Instant::now() - Duration::from_secs(APP_LOG_INTERVAL_SEC);
            *next_screenshot_at = Instant::now() + Duration::from_secs(FIRST_SCREENSHOT_DELAY_SEC);
            log::info!("Tracking session {session_id}");
            self.upload_app_slice(&session_id, &window);
            *last_app_log_at = Instant::now();
        }

        *was_active = true;
        self.emit_status("Task session active");

        let now = Instant::now();
        if now >= *next_screenshot_at {
            self.upload_screenshot(&session_id, &window);
            *next_screenshot_at =
                now + Duration::from_secs(self.events.random_screenshot_delay_sec());
        }

        if now.duration_since(*last_app_log_at).as_secs() >= APP_LOG_INTERVAL_SEC {
            self.upload_app_slice(&session_id, &window);
            *last_app_log_at = now;
        }
    }

    fn upload_screenshot(
        &self,
        session_id: &str,
        window: &crate::capture::window::ForegroundWindow,
    ) {
        let Some(event) = self.events.screenshot(window) else {
            return;
        };
        if self.api.lock().post_events(session_id, &[event]) {
            log::info!("Activity uploaded");
        }
    }

    fn upload_app_slice(
        &self,
        session_id: &str,
        window: &crate::capture::window::ForegroundWindow,
    ) {
        let app_event = self.events.app_slice(window);
        let app_ok = self.api.lock().post_events(session_id, &[app_event.clone()]);

        let mut url_ok = true;
        if let Some(url_event) = self.events.url_slice(window) {
            url_ok = self.api.lock().post_events(session_id, &[url_event]);
        }

        if app_ok {
            self.activity.reset();
            log::info!(
                "Logged app slice: {}{}",
                window.app_name,
                if url_ok { " + URL" } else { "" }
            );
        } else {
            log::warn!("App/URL upload failed for session {session_id}");
        }
    }
}
