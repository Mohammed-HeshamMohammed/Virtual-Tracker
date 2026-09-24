//! Wire types, grouped by what they describe.
//!
//! Everything is re-exported here, so `crate::types::X` resolves exactly as it did
//! when this was one 800-line file.

mod capture;
mod auth;
mod work;
mod workspace;
mod notifications;

/// serde default for fields that are true unless the server says otherwise.
pub(crate) fn default_true() -> bool {
    true
}

pub use capture::*;
pub use auth::*;
pub use work::*;
pub use workspace::*;
pub use notifications::*;

#[cfg(test)]
mod tests {
    // Guards CF-0.3: "No keystroke *content* logging... it must never capture the
    // actual characters typed (that's keylogging, a categorically higher legal risk)."
    // ActivityEvent is the wire format for everything the agent sends the backend - if
    // a future change ever adds a field meant to carry typed text, it has to touch this
    // enum, and this test is what catches it before it ships.
    #[test]
    fn activity_event_carries_no_classification_verdict() {
        // The agent caches the server's classification data locally (see
        // capture/classification_cache.rs).
        let source = include_str!("capture.rs");
        let start = source.find("pub enum ActivityEvent").expect("ActivityEvent enum must exist");
        let end = start + source[start..].find("
}").expect("ActivityEvent enum must close") + 2;
        let enum_source = &source[start..end];

        for forbidden in ["category", "classification", "productive", "verdict"] {
            assert!(
                !enum_source.contains(&format!("{forbidden}:")),
                "ActivityEvent must never carry a '{forbidden}' field - the server resolves                  categories at read time, and an agent-supplied verdict would make the local                  classification cache authoritative and worth tampering with"
            );
        }
    }

    #[test]
    fn activity_event_carries_no_keystroke_content_field() {
        let source = include_str!("capture.rs");
        let start = source.find("pub enum ActivityEvent").expect("ActivityEvent enum must exist");
        // "\n}" rather than "\n}\n" so this doesn't depend on LF vs CRLF line endings.
        let end = start + source[start..].find("\n}").expect("ActivityEvent enum must close") + 2;
        let enum_source = &source[start..end];

        for forbidden in ["keys", "keystrokes", "text", "characters", "content", "typed"] {
            assert!(
                !enum_source.contains(&format!("{forbidden}:")),
                "ActivityEvent must never carry a '{forbidden}' field - that's keylogging, not activity metering"
            );
        }
    }
}

#[cfg(test)]
mod queue_compat_tests {
    use super::*;

    /// An agent that queued events before `url` existed must still be able to read its own
    /// backlog after auto-updating.
    #[test]
    fn a_pre_url_screenshot_event_still_deserializes() {
        let old = r#"{"type":"screenshot","imageData":"data:image/jpeg;base64,AAA",
            "appName":"Google Chrome","pageTitle":"x","activityLevel":42,
            "keystrokeCount":1,"distinctKeyCount":1,"mouseDistancePx":0,
            "injectedEventCount":0,"activeSecondsInWindow":15}"#;
        let parsed: Result<ActivityEvent, _> = serde_json::from_str(old);
        assert!(parsed.is_ok(), "old queued event must still parse: {parsed:?}");
    }

    /// The other direction: a manual downgrade leaves a new-format backlog for an older
    /// binary.
    #[test]
    fn an_unknown_future_field_is_ignored_not_rejected() {
        let future = r#"{"type":"screenshot","imageData":"d","appName":"a","pageTitle":"p",
            "activityLevel":1,"url":"https://example.com","somethingAddedLater":true,
            "keystrokeCount":0,"distinctKeyCount":0,"mouseDistancePx":0,
            "injectedEventCount":0,"activeSecondsInWindow":0}"#;
        let parsed: Result<ActivityEvent, _> = serde_json::from_str(future);
        assert!(parsed.is_ok(), "unknown fields must be ignored: {parsed:?}");
    }

    /// A round trip through the exact shape queue.rs writes.
    #[test]
    fn a_screenshot_with_a_url_round_trips() {
        let event = ActivityEvent::Screenshot {
            image_data: "d".into(),
            app_name: "Google Chrome".into(),
            page_title: "p".into(),
            activity_level: 50,
            url: Some("https://github.com/x".into()),
            signal: ActivitySignal::default(),
        };
        let json = serde_json::to_string(&event).expect("serialize");
        assert!(json.contains("\"url\""), "url must survive serialization: {json}");
        let back: ActivityEvent = serde_json::from_str(&json).expect("deserialize");
        match back {
            ActivityEvent::Screenshot { url, .. } => {
                assert_eq!(url.as_deref(), Some("https://github.com/x"));
            }
            _ => panic!("wrong variant"),
        }
    }
}
