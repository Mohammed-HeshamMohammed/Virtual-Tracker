//! One pass of the tracking loop, and the paths it can take: offline, paused,
//! idle-escalating, or a normal credited tick.

use super::*;

impl ActivityTracker {
    /// The part of a tick that needs no network and no shared lock - crediting elapsed time
    /// and checking idle escalation.
    pub(super) fn tick_local_progress(&self, state: &mut TickState) {
        if !state.was_active || state.current_session.is_empty() {
            // Not tracking - or paused by the server (C1).
            state.last_tick_at = Instant::now();
            return;
        }
        let idle_now = self.tick_progress(state);
        let _ = idle_now;

        // Idle escalation must not wait on a poll either: it is the thing that stops a
        // session nobody is at, and delaying it would credit active time to an empty chair.
        let stopped = self.tick_idle_escalation(
            &mut state.idle_watch,
            &state.task_id,
            &state.last_project_id,
            &state.active_baseline,
            &state.active_elapsed,
            &state.idle_baseline,
            &state.idle_elapsed,
            state.idle_time_disabled,
            state.idle_threshold_sec_for_project,
        );
        if stopped {
            // Exactly what the polling path does on an idle stop (see the sibling call in
            // `tick`) - the session is over the same way whichever tick happened to notice.
            state.was_active = false;
            state.current_session = String::new();
            *self.session_id.lock() = None;
            self.reset_task_progress(state);
        }
    }

    /// Re-baseline the tracked totals against the server's own figures.
    ///
    /// Runs when the tracked task changes under an open session (a resume onto a
    pub(super) fn rebaseline_for_task(
        &self,
        state: &mut TickState,
        session: &serde_json::Value,
        session_id: &str,
        session_task_id: &str,
        task_changed: bool,
    ) {
        let tracking = if session_task_id.is_empty() {
            None
        } else {
            self.api.lock().fetch_task_time_tracking(&session_task_id).ok()
        };
        // Task-less (calling project) sessions have no per-task totals to re-baseline
        // from, so the session's own accumulated seconds are the cumulative figure -
        let session_seconds = |key: &str| {
            session.get(key).and_then(|v| v.as_u64()).unwrap_or(0)
        };
        if task_changed {
            state.task_id = session_task_id.to_string();
            state.active_elapsed = 0;
            state.idle_elapsed = 0;
            state.active_baseline = tracking
                .as_ref()
                .map(|t| t.active_seconds)
                .unwrap_or_else(|| session_seconds("activeSeconds"));
            state.idle_baseline = tracking
                .as_ref()
                .map(|t| t.idle_seconds)
                .unwrap_or_else(|| session_seconds("idleSeconds"));
        }

        // Task-anchored sessions get this from the same fetch_task_time_tracking call
        // above (task-time-tracking.js attaches the owning project's settings to every
        state.idle_time_disabled = tracking
            .as_ref()
            .map(|t| t.disable_idle_time)
            .unwrap_or_else(|| {
                session.get("disableIdleTime").and_then(|v| v.as_bool()).unwrap_or(false)
            });
        let reported_threshold = tracking
            .as_ref()
            .map(|t| t.idle_time_seconds)
            .unwrap_or_else(|| {
                session
                    .get("idleTimeSeconds")
                    .and_then(|v| v.as_u64())
                    .unwrap_or_else(|| self.idle_threshold_sec.load(Ordering::Relaxed))
            });
        // The org-wide poll has always been validated (apply_idle_thresholds), but the
        // per-project value went straight in unchecked - and nothing upstream
        state.idle_threshold_sec_for_project = if valid_idle_threshold(reported_threshold) {
            reported_threshold
        } else {
            let fallback = self.idle_threshold_sec.load(Ordering::Relaxed);
            log::warn!(
                "Project reported an unusable idle allowance ({reported_threshold}s) - falling back to the org-wide {fallback}s"
            );
            fallback
        };
        state.idle_settings_stale = false;

        // an unclean exit (crash/kill/reboot) between two `sync` calls loses
        // whatever PS-1's on-disk mirror hadn't reached the server yet - reconcile
        // against it here, same GREATEST-style rule TC-4 already applies
        // server-side for `sync`, so a restart never displays less than what was
        // last actually shown. Scoped to the exact same session+task on purpose: a
        // leftover file from an already-closed session must never bleed into a new
        // one.
        let persisted_task_id = if session_task_id.is_empty() {
            None
        } else {
            Some(session_task_id.to_string())
        };
        if let Some(persisted) = self.progress.load() {
            if persisted.session_id == session_id && persisted.task_id == persisted_task_id {
                state.active_baseline = state.active_baseline.max(persisted.active_seconds);
                state.idle_baseline = state.idle_baseline.max(persisted.idle_seconds);
            }
        }

        state.next_sync_at = Instant::now();
    }

    /// The session is over: forget the task, the totals and the session id.
    pub(super) fn end_session(&self, state: &mut TickState) {
        self.reset_task_progress(state);
        state.was_active = false;
        state.current_session = String::new();
        *self.session_id.lock() = None;
    }

    /// The session poll failed. Keep crediting time and capturing against the last known
    /// session so an outage costs the member nothing.
    pub(super) fn tick_offline(&self, state: &mut TickState) {
        state.failed_session_fetches = state.failed_session_fetches.saturating_add(1);
        if state.failed_session_fetches == DEGRADED_TICKS {
            self.emit_status("Offline — still counting, not yet synced");
        }
        if !state.was_active || state.current_session.is_empty() {
            return;
        }
        let window = get_foreground_window();
        let session_id = state.current_session.clone();
        let now = Instant::now();
        let idle_now = self.tick_progress(state);
        // No screenshots while idle - see tick_progress's doc comment.
        if !idle_now && now >= state.next_screenshot_at {
            self.upload_screenshot(&session_id, &window);
            state.next_screenshot_at =
                now + Duration::from_secs(self.events.random_screenshot_delay_sec());
        }
        if now.duration_since(state.last_app_log_at).as_secs() >= APP_LOG_INTERVAL_SEC {
            self.upload_app_slice(&session_id, &window);
            state.last_app_log_at = now;
        }
    }

    pub(super) fn tick(&self, state: &mut TickState) {
        // Cheap no-op unless the hooks have gone quiet while the OS is still seeing input.
        self.activity.restart_hooks_if_dead();

        self.maybe_flush_queue(&mut state.next_flush_at);
        self.maybe_refresh_display_names(&mut state.next_display_name_refresh_at);
        self.maybe_refresh_activity_scoring(&mut state.next_scoring_refresh_at);

        // Retry an idle-stop that hasn't landed yet, and do nothing else this tick.
        if self.pending_stop.lock().is_some() {
            self.try_deliver_pending_stop();
            return;
        }

        // Break in progress: skip fetch_session/status handling entirely so the server's
        // "idle" status (set by `pause()`) never gets read back as "session over" and reset
        if self.paused.load(Ordering::SeqCst) {
            self.tick_paused(state);
            return;
        }

        // Bound to a `let` on purpose, same reasoning as
        // `AgentController::sign_in_with_password`'s `session_bootstrap` call: a temporary
        state.ticks_since_session_fetch = state.ticks_since_session_fetch.saturating_add(1);
        if state.ticks_since_session_fetch < SESSION_FETCH_EVERY_N_TICKS {
            self.tick_local_progress(state);
            return;
        }
        let Some(client) = self.api.try_lock_for(SESSION_FETCH_LOCK_WAIT) else {
            log::debug!("session poll skipped: the API client is busy serving the UI");
            self.tick_local_progress(state);
            return;
        };
        state.ticks_since_session_fetch = 0;
        let fetched = { client }.fetch_session();
        let session = match fetched {
            Ok(session) => {
                if state.failed_session_fetches >= DEGRADED_TICKS {
                    self.emit_status("Reconnected — your time is confirmed");
                }
                state.failed_session_fetches = 0;
                session
            }
            Err(_) => {
                self.tick_offline(state);
                return;
            }
        };
        let Some(session) = session else {
            let stop_was_requested = self.expect_stop.swap(false, Ordering::SeqCst);
            if !stop_was_requested && self.try_recover_lost_session(state) {
                self.emit_status("Task session active");
                return;
            }
            if state.was_active {
                self.emit_status("Signed in — waiting for timer");
            }
            self.end_session(state);
            return;
        };

        let status = session
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if status != "active" {
            if status == "idle" && !state.current_session.is_empty() {
                if state.was_active {
                    self.emit_status("Timer idle — capture paused");
                }
                state.was_active = false;
                // Nothing is credited while paused.
                state.last_tick_at = Instant::now();
                return;
            }
            if status == "idle" {
                self.emit_status("Timer idle — capture paused");
            } else if state.was_active {
                self.emit_status("Signed in — waiting for timer");
            }
            self.end_session(state);
            return;
        }

        let session_id = match session.get("id").and_then(|v| v.as_str()) {
            Some(id) if !id.is_empty() => id.to_string(),
            _ => return,
        };

        let window = get_foreground_window();

        if state.current_session.as_str() != session_id {
            state.current_session = session_id.clone();
            // A different session can carry different project settings even when the task
            // id is unchanged (and is always unchanged for task-less sessions, where it is
            state.idle_settings_stale = true;
            *self.session_id.lock() = Some(session_id.clone());
            state.last_app_log_at = Instant::now() - Duration::from_secs(APP_LOG_INTERVAL_SEC);
            state.next_screenshot_at = Instant::now() + Duration::from_secs(FIRST_SCREENSHOT_DELAY_SEC);
            log::info!("Tracking session {session_id}");
            self.upload_app_slice(&session_id, &window);
            state.last_app_log_at = Instant::now();
        }

        // Task can change under a session that's already open (resume onto a different
        // task) - re-baseline from the server's known totals for it whenever the tracked
        let session_task_id = session
            .get("taskId")
            .or_else(|| session.get("task_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let task_changed = state.task_id.as_str() != session_task_id;
        // Settings follow *either* identity.
        if task_changed || state.idle_settings_stale {
            self.rebaseline_for_task(state, &session, &session_id, &session_task_id, task_changed);
        }

        if !state.was_active {
            // Coming back from a pause (C1), or starting: count from now.
            state.last_tick_at = Instant::now();
        }
        state.was_active = true;

        let now = Instant::now();
        let idle_now = self.tick_progress(state);
        self.maybe_flag_synthetic_input();

        // Calling-project sessions have no task, so they sync on project id instead -
        // gating purely on task id would leave their time unrecorded.
        let session_project_id = session
            .get("projectId")
            .or_else(|| session.get("project_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !session_project_id.is_empty() {
            state.last_project_id = session_project_id.clone();
            *self.last_project_id.lock() = session_project_id.clone();
        }

        if self.tick_idle_escalation(
            &mut state.idle_watch,
            &state.task_id,
            &session_project_id,
            &state.active_baseline,
            &state.active_elapsed,
            &state.idle_baseline,
            &state.idle_elapsed,
            state.idle_time_disabled,
            state.idle_threshold_sec_for_project,
        ) {
            // Timer was stopped for idling; this session is over.
            state.was_active = false;
            state.current_session = String::new();
            *self.session_id.lock() = None;
            self.reset_task_progress(state);
            return;
        }

        // No screenshots while idle - see tick_progress's doc comment.
        let capture_excluded = self.events.is_capture_excluded(&window);

        // That elapsed while nobody was there to be captured.
        if !idle_now && !capture_excluded && now >= state.next_screenshot_at {
            self.upload_screenshot(&session_id, &window);
            state.next_screenshot_at =
                now + Duration::from_secs(self.events.random_screenshot_delay_sec());
        }

        if !capture_excluded && now.duration_since(state.last_app_log_at).as_secs() >= APP_LOG_INTERVAL_SEC {
            self.upload_app_slice(&session_id, &window);
            state.last_app_log_at = now;
        }

        if (!state.task_id.is_empty() || !session_project_id.is_empty()) && now >= state.next_sync_at {
            let active_total = state.active_baseline + state.active_elapsed;
            let idle_total = state.idle_baseline + state.idle_elapsed;
            let sync_result = self.api.lock().post_session_action(
                "sync",
                Some(state.task_id.as_str()).filter(|id| !id.is_empty()),
                Some(session_project_id.as_str()).filter(|id| !id.is_empty()),
                active_total,
                idle_total,
                None,
                None,
            );
            state.next_sync_at = now + Duration::from_secs(SESSION_SYNC_INTERVAL_SEC);

            // The server already truncated active_seconds against the task's daily cap
            // (timerCapped) or stopped counting because the project's own budget stop-timer
            let cap = match &sync_result {
                Ok(info) if info.timer_capped => {
                    Some(("Timer stopped — task's daily hour limit reached", "timer_cap"))
                }
                Ok(info) if info.budget_capped => {
                    Some(("Timer stopped — project's budget limit reached", "budget_cap"))
                }
                _ => None,
            };
            if let Some((message, reason)) = cap {
                log::info!("{message} - stopping timer");
                let _ = self.api.lock().post_session_action(
                    "stop",
                    Some(state.task_id.as_str()).filter(|id| !id.is_empty()),
                    Some(session_project_id.as_str()).filter(|id| !id.is_empty()),
                    active_total,
                    idle_total,
                    None,
                    Some(reason),
                );
                state.was_active = false;
                state.current_session = String::new();
                *self.session_id.lock() = None;
                self.reset_task_progress(state);
                self.emit_status(message);
            }
        }
    }

    /// AC-1: "a session that's 100% active but ~100% injected is a near-certain fake" -
    /// falls out of ACT-1's real hooks almost for free.
    pub(super) fn maybe_flag_synthetic_input(&self) {
        const HIGH_ACTIVITY_SCORE: u32 = 80;
        const HIGH_INJECTED_FRACTION: f64 = 0.85;
        const RENOTIFY_AFTER: Duration = Duration::from_secs(10 * 60);

        let score = self.activity.score();
        if score < HIGH_ACTIVITY_SCORE {
            return;
        }
        let Some(fraction) = self.activity.injected_fraction() else {
            return;
        };
        if fraction < HIGH_INJECTED_FRACTION {
            return;
        }

        let mut last_warning = self.last_synthetic_warning_at.lock();
        let now = Instant::now();
        if last_warning.is_some_and(|at| now.duration_since(at) < RENOTIFY_AFTER) {
            return;
        }
        *last_warning = Some(now);
        log::warn!(
            "Possible synthetic input: activity score {score}% with {:.0}% of input OS-flagged as injected",
            fraction * 100.0
        );
    }

    /// Idle enforcement.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn tick_idle_escalation(
        &self,
        watch: &mut IdleWatch,
        task_id: &str,
        project_id: &str,
        active_baseline: &u64,
        active_elapsed: &u64,
        idle_baseline: &u64,
        idle_elapsed: &u64,
        idle_time_disabled: bool,
        idle_threshold_sec: u64,
    ) -> bool {
        // Idle time disabled for this project means no warn/alert/ auto-stop/rewind either
        // - the switch does what it says end to end, not just for the active/idle split in
        if idle_time_disabled {
            return false;
        }
        // Idle escalation is Windows-only until real input-hook listeners exist for other
        // platforms (see ActivityMeter::run_listeners / HOOKS_SUPPORTED).
        if !ActivityMeter::HOOKS_SUPPORTED {
            return false;
        }
        let idle_for = self.activity.idle_seconds();
        let active_total = active_baseline.saturating_add(*active_elapsed);

        // Real input: remember this as the last honest point the clock can be rewound to.
        if idle_for < idle_threshold_sec {
            if watch.stage != 0 {
                watch.stage = 0;
                *self.idle_stage.lock() = 0;
                self.emit_status("Task session active");
            }
            watch.active_at_last_input = active_total;
            return false;
        }

        // Past the project's own allowance: stop immediately and rewind.
        let (rewound, reversed) = Self::rewind_active(active_total, watch.active_at_last_input);
        let idle_total = idle_baseline.saturating_add(*idle_elapsed).saturating_add(reversed);

        log::info!(
            "Idle {}s past the project's {}s allowance - stopping timer, reversing {}s of active time (from {}s to {}s) into idle",
            idle_for,
            idle_threshold_sec,
            reversed,
            active_total,
            rewound
        );

        self.set_task_progress(task_id, rewound, idle_total);
        let delivered = self
            .api
            .lock()
            .post_session_action(
                "stop",
                Some(task_id).filter(|id| !id.is_empty()),
                Some(project_id).filter(|id| !id.is_empty()),
                rewound,
                idle_total,
                None,
                Some("idle_escalation"),
            )
            .is_ok();
        if !delivered {
            // The network problem that often accompanies an idle stretch must not mean the
            // stop is silently lost.
            *self.pending_stop.lock() = Some(PendingStop {
                task_id: task_id.to_string(),
                project_id: project_id.to_string(),
                active_seconds: rewound,
                idle_seconds: idle_total,
            });
            log::warn!("Idle-stop POST failed - will retry until delivered, tracking stays halted meanwhile");
        }

        watch.stage = 3;
        *self.idle_stage.lock() = 3;
        watch.active_at_last_input = 0;
        self.emit_status("Timer stopped — idle too long, idle time removed");
        true
    }

    /// While paused, credits the whole wall-clock delta to idle (a break is not activity)
    /// and periodically re-syncs so the paused session's `updated_at` stays fresh enough to
    pub(super) fn tick_paused(&self, state: &mut TickState) {
        let now = Instant::now();
        // Same carry as tick_progress - a break's seconds are counted the same way worked
        // ones are, so the remainder is owed here too rather than thrown away on every tick
        let elapsed = now.duration_since(state.last_tick_at);
        let delta = Self::credited_seconds(elapsed);
        state.last_tick_at = now - (elapsed - Self::consumed_span(elapsed, delta));
        if !state.idle_time_disabled {
            state.idle_elapsed += delta;
        }
        self.set_task_progress(
            &state.task_id,
            state.active_baseline + state.active_elapsed,
            state.idle_baseline + state.idle_elapsed,
        );
        if now >= state.next_sync_at {
            let task_id = (!state.task_id.is_empty()).then(|| state.task_id.as_str());
            let project_id = (!state.last_project_id.is_empty()).then(|| state.last_project_id.as_str());
            let _ = self.api.lock().post_session_action(
                "sync",
                task_id,
                project_id,
                state.active_baseline + state.active_elapsed,
                state.idle_baseline + state.idle_elapsed,
                None,
                None,
            );
            state.next_sync_at = now + Duration::from_secs(SESSION_SYNC_INTERVAL_SEC);
        }
    }

    /// Attempts to resume a session the server closed as abandoned, carrying the local
    /// unsynced total (baseline + elapsed) forward as the new session's starting point
    pub(super) fn try_recover_lost_session(&self, state: &mut TickState) -> bool {
        if !state.was_active || state.current_session.is_empty() {
            return false;
        }
        let has_task = !state.task_id.is_empty();
        let has_project = !state.last_project_id.is_empty();
        if !has_task && !has_project {
            return false;
        }
        let active_total = state.active_baseline + state.active_elapsed;
        let idle_total = state.idle_baseline + state.idle_elapsed;
        if active_total == 0 && idle_total == 0 {
            return false;
        }
        let task_id = has_task.then(|| state.task_id.as_str());
        let project_id = has_project.then(|| state.last_project_id.as_str());
        match self
            .api
            .lock()
            .post_session_action("start", task_id, project_id, active_total, idle_total, None, Some("recovered_after_reap"))
        {
            Ok(info) => {
                log::warn!(
                    "Recovered a session the server closed as abandoned - resumed with {active_total}s active / {idle_total}s idle carried forward"
                );
                state.current_session = info.id.unwrap_or_default();
                // This adopts a brand-new session id without going through the tick's own
                // session-change branch, so nothing else would mark the project's idle
                state.idle_settings_stale = true;
                *self.session_id.lock() = Some(state.current_session.clone());
                state.active_baseline = active_total;
                state.active_elapsed = 0;
                state.idle_baseline = idle_total;
                state.idle_elapsed = 0;
                state.last_tick_at = Instant::now();
                state.next_sync_at = Instant::now() + Duration::from_secs(SESSION_SYNC_INTERVAL_SEC);
                true
            }
            Err(err) => {
                log::warn!("Could not recover abandoned session (will retry next tick): {err}");
                false
            }
        }
    }
}
