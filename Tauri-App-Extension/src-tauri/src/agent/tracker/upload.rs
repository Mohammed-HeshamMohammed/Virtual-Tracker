//! Handing a screenshot or an app slice to the event queue.

use super::*;

impl ActivityTracker {
    pub(super) fn upload_screenshot(
        &self,
        session_id: &str,
        window: &crate::capture::window::ForegroundWindow,
    ) {
        let Some(event) = self.events.screenshot(window) else {
            return;
        };
        if self.api.lock().post_events(session_id, std::slice::from_ref(&event)) {
            log::info!("Activity uploaded");
        } else {
            self.queue.enqueue(session_id, &[event]);
        }
    }

    pub(super) fn upload_app_slice(
        &self,
        session_id: &str,
        window: &crate::capture::window::ForegroundWindow,
    ) {
        // A window we could not identify is a gap in what the agent can see, not an app
        // called "Unknown".
        if !window.is_identified() {
            log::debug!("skipping app slice: foreground window could not be identified");
            return;
        }

        if window.is_shell_surface() {
            log::debug!(
                "skipping app slice: {} is a shell surface, not an app",
                window.process_name
            );
            return;
        }

        let app_event = self.events.app_slice(window);
        let app_ok = self.api.lock().post_events(session_id, std::slice::from_ref(&app_event));
        if !app_ok {
            self.queue.enqueue(session_id, &[app_event]);
        }

        // Was true unconditionally whenever no URL was captured at all (not a browser, or
        // the capture script came back empty) — every non-browser app log line was claiming
        let mut url_sent = 0usize;
        let url_events = self.events.url_slices(window);
        if !url_events.is_empty() {
            let url_ok = self.api.lock().post_events(session_id, &url_events);
            if url_ok {
                url_sent = url_events.len();
            } else {
                self.queue.enqueue(session_id, &url_events);
            }
        }

        if app_ok {
            self.activity.reset();
            log::info!(
                "Logged app slice: {}{}",
                window.app_name,
                match url_sent {
                    0 => String::new(),
                    1 => " + URL".to_string(),
                    n => format!(" + {n} URLs"),
                }
            );
        } else {
            log::warn!("App/URL upload failed for session {session_id}, queued for retry");
        }
    }
}
