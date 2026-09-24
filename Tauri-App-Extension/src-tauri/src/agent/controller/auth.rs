//! Signing in, signing out, and restoring a stored session.

use super::*;

impl AgentController {
    pub(super) fn restore_session(self: &Arc<Self>) {
        let stored = self.store.load();
        if !stored.device_id.is_empty() && !stored.agent_secret.is_empty() {
            self.api
                .lock()
                .set_device_credential(&stored.device_id, &stored.agent_secret);
        }
        if stored.id_token.len() >= MIN_TOKEN_LENGTH && looks_like_jwt(&stored.id_token) {
            self.apply_tokens(stored.id_token, stored.refresh_token);
        }
    }

    pub(super) fn apply_tokens(self: &Arc<Self>, id_token: String, refresh_token: String) {
        self.api.lock().set_tokens(&id_token, &refresh_token);

        // Claim a device credential if we don't already hold one.
        if !self.api.lock().has_device_credential() {
            self.api.lock().refresh_token_if_needed();
            self.api.lock().ensure_device_registered();
        }

        // Captured during link exchange or the calls above; read it back off the client
        // rather than threading it through every callback.
        let (device_id, agent_secret) = {
            let api = self.api.lock();
            (
                api.device_id.clone().unwrap_or_default(),
                api.agent_secret.clone().unwrap_or_default(),
            )
        };
        let persisted = self.store.save(&StoredCredentials {
            id_token: id_token.clone(),
            refresh_token: refresh_token.clone(),
            device_id: device_id.clone(),
            agent_secret: agent_secret.clone(),
        });
        if !persisted {
            self.on_warning(
                "Could not save your sign-in securely on this device. \
                 You may need to sign in again after restarting."
                    .into(),
            );
        }
        let store_path = self.settings.store_path.clone();
        let warn_controller = Arc::clone(self);
        self.api.lock().on_tokens_refreshed = Some(Box::new(move |id, refresh| {
            // Preserve the device credential across token rotations - a plain overwrite
            // here would silently drop it and take in-app recovery with it.
            let persisted = TokenStore::new(store_path.clone()).save(&StoredCredentials {
                id_token: id,
                refresh_token: refresh,
                device_id: device_id.clone(),
                agent_secret: agent_secret.clone(),
            });
            if !persisted {
                warn_controller.on_warning(
                    "Could not save your refreshed sign-in securely on this device. \
                     You may need to sign in again after restarting."
                        .into(),
                );
            }
        }));
        self.api.lock().register_agent();

        self.connection_failures.store(0, Ordering::SeqCst);
        self.on_status_changed("Signed in — waiting for timer".into());
        self.start_tracker();
        log::info!("Account linked");
    }

    pub(super) fn start_tracker(self: &Arc<Self>) {
        if let Some(existing) = self.tracker.lock().as_ref() {
            existing.stop();
        }
        let controller = Arc::clone(self);
        let on_status: StatusCallback = Arc::new(move |text| {
            controller.on_status_changed(text);
        });
        let tracker = Arc::new(ActivityTracker::new(
            Arc::clone(&self.api),
            &self.settings,
            Arc::clone(&self.activity),
            Some(on_status),
        ));
        tracker.start();
        *self.tracker.lock() = Some(tracker);
    }

    /// `hint` is an extra `key=value` query pair forwarded to the browser URL (see
    /// `AgentLinkFlow::start`) - e.g.
    pub fn open_sign_in(self: &Arc<Self>, hint: Option<&str>) -> SignInResult {
        if let Some(pending_token) = self.link_flow.pending_link_token() {
            self.resume_link_poll();
            let encoded = urlencoding::encode(&pending_token);
            let valid_hint = hint.filter(|h| is_allowed_link_hint(h));
            if hint.is_some() && valid_hint.is_none() {
                log::warn!("Ignored unrecognized sign-in hint");
            }
            let sign_in_url = build_link_sign_in_url(
                &self.settings.web_url,
                &self.settings.auth_url,
                &encoded,
                valid_hint,
            );
            open_url_in_launcher_or_browser(&sign_in_url, Some(&pending_token), valid_hint);
            self.on_status_changed("Linking account...".into());
            return SignInResult {
                success: true,
                error: None,
            };
        }

        self.link_flow.stop();
        self.flush_and_stop_tracker("re-link");
        self.store.clear();
        {
            let mut api = self.api.lock();
            api.set_tokens("", "");
            // Drop the device credential too - after an explicit sign-out or re-link, this
            // machine must not be able to quietly mint itself a new session.
            api.set_device_credential("", "");
        }
        self.connection_failures.store(0, Ordering::SeqCst);
        self.on_status_changed("Linking account...".into());

        let controller = Arc::clone(self);
        let on_tokens: OnTokens = Arc::new(move |id, refresh| {
            controller.apply_tokens(id, refresh);
        });
        let controller_err = Arc::clone(self);
        let on_error: OnError = Arc::new(move |msg| {
            controller_err.on_warning(msg);
        });

        let ok = self.link_flow.start(hint, on_tokens, Some(on_error));
        if ok {
            SignInResult {
                success: true,
                error: None,
            }
        } else {
            SignInResult {
                success: false,
                error: Some(
                    "Could not reach the server. Check your internet connection and try again."
                        .into(),
                ),
            }
        }
    }

    /// Email + password sign-in, entirely in-app.
    pub fn sign_in_with_password(self: &Arc<Self>, email: &str, password: &str) -> SignInResult {
        let email = email.trim();
        if email.is_empty() || password.is_empty() {
            return SignInResult::failed("Enter your email and password.");
        }

        // A Google/Apple-only account can never succeed here, and Firebase would answer
        // with a generic credential failure.
        if let Some(methods) = self.api.lock().sign_in_methods(email) {
            if !methods.is_empty() && !methods.iter().any(|m| m == "password") {
                return SignInResult::failed(
                    "This account doesn't use a password. Use Link account to sign in with your provider.",
                );
            }
        }

        let tokens = self.api.lock().sign_in_with_password(email, password);
        let (id_token, refresh_token) = match tokens {
            Ok(pair) => pair,
            Err(err) => return SignInResult::failed(err.message()),
        };

        // Persist + claim the device credential before the gate below, so a refusal has
        // something concrete to clear and a success needs no second write.
        self.apply_tokens(id_token, refresh_token);

        // Bound to a `let` on purpose: a temporary lock guard inside a `match` scrutinee
        // lives until the end of the match, and `sign_out()` below takes the same
        let bootstrap = self.api.lock().session_bootstrap();
        match bootstrap {
            Ok(()) => {}
            Err(crate::client::api::ApiError::Rejected(message)) => {
                // The server rejected this account outright; holding tokens for it would
                // leave the agent looking signed in and doing nothing.
                self.sign_out();
                return SignInResult::failed(&message);
            }
            Err(_) => {
                // Network problem, not a verdict.
                log::warn!("Signed in, but could not confirm authorization yet");
            }
        }

        self.on_status_changed("Signed in — waiting for timer".into());
        SignInResult {
            success: true,
            error: None,
        }
    }

    /// In-app account creation, no browser round-trip.
    pub fn sign_up(
        self: &Arc<Self>,
        email: &str,
        password: &str,
        first_name: &str,
        last_name: &str,
        phone: &str,
    ) -> SignInResult {
        let email = email.trim();
        let first_name = first_name.trim();
        let last_name = last_name.trim();
        let phone = phone.trim();
        if email.is_empty() || password.is_empty() {
            return SignInResult::failed("Enter your email and password.");
        }
        if first_name.is_empty() || last_name.is_empty() {
            return SignInResult::failed("First and last name are required.");
        }
        if phone.is_empty() {
            return SignInResult::failed("Phone number is required.");
        }

        let created = self.api.lock().sign_up_with_password(email, password);
        let (id_token, _refresh) = match created {
            Ok(pair) => pair,
            Err(err) => return SignInResult::failed(&err.message()),
        };

        if let Err(msg) = self.api.lock().patch_profile(&id_token, first_name, last_name, phone) {
            // Not fatal - the account exists either way, and the profile page can fill
            // these in later.
            log::warn!("Could not save profile details after sign-up: {msg}");
        }
        self.api.lock().send_email_verification(&id_token);

        SignInResult {
            success: true,
            error: None,
        }
    }

    /// In-app password reset request - sends the email directly through Identity Toolkit,
    /// no browser link needed.
    pub fn request_password_reset(self: &Arc<Self>, email: &str) -> SignInResult {
        let email = email.trim();
        if email.is_empty() {
            return SignInResult::failed("Enter your email address.");
        }
        match self.api.lock().send_password_reset(email) {
            Ok(()) => SignInResult {
                success: true,
                error: None,
            },
            Err(msg) => SignInResult::failed(&msg),
        }
    }

    /// Distinct from open_sign_in/"Re-link account": signs out cleanly (flush + stop the
    /// session, clear tokens) and stops there — no new browser link flow gets started
    pub fn sign_out(self: &Arc<Self>) {
        self.link_flow.stop();
        self.flush_and_stop_tracker("sign-out");
        self.store.clear();
        {
            let mut api = self.api.lock();
            api.set_tokens("", "");
            // Drop the device credential too - after an explicit sign-out or re-link, this
            // machine must not be able to quietly mint itself a new session.
            api.set_device_credential("", "");
        }
        self.connection_failures.store(0, Ordering::SeqCst);
        self.on_status_changed("Not signed in".into());
    }

    pub(super) fn resume_link_poll(self: &Arc<Self>) -> bool {
        let controller = Arc::clone(self);
        let on_tokens: OnTokens = Arc::new(move |id, refresh| {
            controller.apply_tokens(id, refresh);
        });
        // Same reasoning as open_sign_in's on_error: this only ever fires async, after the
        // caller has already gotten its return value back, so on_warning/vt-warning is the
        let controller_err = Arc::clone(self);
        let on_error: OnError = Arc::new(move |msg| {
            controller_err.on_warning(msg);
        });
        self.link_flow
            .ensure_polling(on_tokens, Some(on_error))
    }

    /// True when nothing at all is stored for this machine - no cached token, no device
    /// credential.
    pub(super) fn has_stored_identity(&self) -> bool {
        let stored = self.store.load();
        (stored.id_token.len() >= MIN_TOKEN_LENGTH && looks_like_jwt(&stored.id_token))
            || (!stored.device_id.is_empty() && !stored.agent_secret.is_empty())
    }

    pub fn maybe_auto_sign_in(self: &Arc<Self>) {
        let prefs = self.settings.preferences_store().load();
        if !prefs.auto_sign_in || self.has_stored_identity() {
            return;
        }
        let controller = Arc::clone(self);
        thread::Builder::new()
            .name("vt-auto-signin".into())
            .spawn(move || {
                thread::sleep(Duration::from_secs(2));
                if !controller.has_stored_identity() && !controller.is_link_pending() {
                    let _ = controller.open_sign_in(None);
                }
            })
            .ok();
    }
}
