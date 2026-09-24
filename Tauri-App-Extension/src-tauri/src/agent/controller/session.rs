//! Starting, stopping, pausing and resuming the tracked session, plus the
//! checks that can refuse to start one.

use super::*;

impl AgentController {
    pub fn get_session(&self) -> SessionInfo {
        let mut session = self.api.lock().current_session_info();
        // Idle state lives in the tracker, not the server - attach it to the poll the UI
        // already runs rather than adding a second one.
        session.idle_stage = self
            .tracker
            .lock()
            .as_ref()
            .map(|t| t.idle_stage())
            .unwrap_or(0);
        session
    }

    /// tracking cannot start before the current disclosure notice has been
    /// acknowledged. Fails CLOSED on a network problem or a malformed response - the
    /// entire point of a consent gate is that "couldn't check" must never be silently
    /// read as "consented".
    pub(super) fn blocked_by_monitoring_notice(&self) -> Option<String> {
        match self.api.lock().fetch_monitoring_notice() {
            Ok(Some(notice)) if notice.requires_acknowledgement => {
                Some("Review the monitoring notice before starting the timer.".into())
            }
            Ok(_) => None,
            Err(_) => {
                Some("Could not verify the monitoring notice — check your connection and try again.".into())
            }
        }
    }

    /// An idle-triggered stop from the *previous* session can still be queued for delivery
    /// (`ActivityTracker::flush_pending_stop`) at the moment the user clicks Start again.
    pub(super) fn blocked_by_pending_idle_stop(&self) -> Option<String> {
        let tracker = self.tracker.lock();
        match tracker.as_ref() {
            Some(tracker) if !tracker.flush_pending_stop() => {
                Some("Still finishing the previous idle stop — try starting again in a moment.".into())
            }
            _ => None,
        }
    }

    /// The current disclosure notice for the UI to show.
    pub fn get_monitoring_notice(&self) -> Option<crate::types::MonitoringNoticeView> {
        self.api.lock().fetch_monitoring_notice().ok().flatten()
    }

    /// Records that the notice was shown AND accepted - the two-step
    /// disclosure-then-consent model from CF-0.2, collapsed into one command because the UI
    pub fn acknowledge_monitoring_notice(&self, notice_version: &str) -> bool {
        let disclosed = self.api.lock().post_monitoring_disclosure(notice_version).is_ok();
        let consented = self.api.lock().post_monitoring_consent(notice_version).is_ok();
        disclosed && consented
    }

    pub fn start_task_session(&self, task_id: &str) -> ActionResult {
        if task_id.trim().is_empty() {
            return ActionResult {
                success: false,
                error: Some("Select a task first".into()),
                session: None,
            };
        }
        if let Some(error) = self.blocked_by_monitoring_notice() {
            return ActionResult { success: false, error: Some(error), session: None };
        }
        if let Some(error) = self.blocked_by_pending_idle_stop() {
            return ActionResult { success: false, error: Some(error), session: None };
        }
        // Seed with the task's known cumulative totals instead of 0s so a stop/resume (or a
        // session reused across tasks) doesn't reset the clock the enforcement check on the
        let tracking = self.api.lock().fetch_task_time_tracking(task_id.trim()).ok();
        let active_baseline = tracking.as_ref().map(|t| t.active_seconds).unwrap_or(0);
        let idle_baseline = tracking.as_ref().map(|t| t.idle_seconds).unwrap_or(0);
        match self.api.lock().post_session_action(
            "start",
            Some(task_id.trim()),
            None,
            active_baseline,
            idle_baseline,
            None,
            Some("member_start"),
        ) {
            Ok(session) => {
                self.on_status_changed("Task session active".into());
                ActionResult {
                    success: true,
                    error: None,
                    session: Some(session),
                }
            }
            Err(error) => ActionResult {
                success: false,
                error: Some(error),
                session: None,
            },
        }
    }

    /// Timer for a "calling" project, which has no tasks at all.
    pub fn start_project_session(&self, project_id: &str) -> ActionResult {
        let project_id = project_id.trim();
        if project_id.is_empty() {
            return ActionResult {
                success: false,
                error: Some("Select a project first".into()),
                session: None,
            };
        }
        if let Some(error) = self.blocked_by_monitoring_notice() {
            return ActionResult { success: false, error: Some(error), session: None };
        }
        if let Some(error) = self.blocked_by_pending_idle_stop() {
            return ActionResult { success: false, error: Some(error), session: None };
        }
        match self
            .api
            .lock()
            .post_session_action("start", None, Some(project_id), 0, 0, None, Some("member_start"))
        {
            Ok(session) => {
                self.on_status_changed("Task session active".into());
                ActionResult {
                    success: true,
                    error: None,
                    session: Some(session),
                }
            }
            Err(error) => ActionResult {
                success: false,
                error: Some(error),
                session: None,
            },
        }
    }

    /// `stop_note` carries what the member said they worked on, when the project has
    /// require_stop_note on.
    pub fn stop_session(&self, stop_note: Option<&str>) -> ActionResult {
        let tracker = self.tracker.lock();
        let (task_id, active_seconds, idle_seconds) = tracker
            .as_ref()
            .map(|t| t.current_task_progress())
            .unwrap_or((None, 0, 0));
        // TC-Y: this posts "stop" straight to the API, bypassing the tick loop entirely
        if let Some(tracker) = tracker.as_ref() {
            tracker.note_stop_requested();
        }
        drop(tracker);
        match self
            .api
            .lock()
            .post_session_action("stop", task_id.as_deref(), None, active_seconds, idle_seconds, stop_note, Some("member_stop"))
        {
            Ok(session) => {
                self.on_status_changed("Signed in — waiting for timer".into());
                ActionResult {
                    success: true,
                    error: None,
                    session: Some(session),
                }
            }
            Err(error) => ActionResult {
                success: false,
                error: Some(error),
                session: None,
            },
        }
    }

    /// The break button: marks the session idle (preserving its accumulated totals, unlike
    /// `stop_session`) and tells the tick loop to stop counting active time until
    pub fn pause_session(&self) -> ActionResult {
        let tracker = self.tracker.lock();
        let Some(tracker) = tracker.as_ref() else {
            return ActionResult { success: false, error: Some("No active session".into()), session: None };
        };
        match tracker.pause() {
            Ok(()) => ActionResult { success: true, error: None, session: None },
            Err(error) => ActionResult { success: false, error: Some(error), session: None },
        }
    }

    pub fn resume_session(&self) -> ActionResult {
        let tracker = self.tracker.lock();
        let Some(tracker) = tracker.as_ref() else {
            return ActionResult { success: false, error: Some("No active session".into()), session: None };
        };
        match tracker.resume() {
            Ok(()) => ActionResult { success: true, error: None, session: None },
            Err(error) => ActionResult { success: false, error: Some(error), session: None },
        }
    }

    pub fn is_session_paused(&self) -> bool {
        self.tracker.lock().as_ref().is_some_and(|t| t.is_paused())
    }
}
