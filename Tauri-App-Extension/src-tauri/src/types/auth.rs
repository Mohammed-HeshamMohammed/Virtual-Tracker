//! Who is signed in, whether the device is linked, and the state of the
//! connection to the backend.

use serde::{Deserialize, Serialize};

#[allow(unused_imports)]
use super::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInfo {
    pub signed_in: bool,
    #[serde(default)]
    pub link_pending: bool,
    pub name: String,
    #[serde(default)]
    pub email: String,
    pub avatar_url: String,
    pub server_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatus {
    pub connected: bool,
    pub server_label: String,
    pub status: String,
}

/// Answer to "can an update install here without an administrator?" - see
/// update_install_readiness in lib.rs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallReadiness {
    /// The install directory is writable by this user, so the installer can run unattended.
    pub writable: bool,
    /// Shown to the user when it is not, so they can tell their admin where.
    pub install_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignInResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl SignInResult {
    pub fn failed(error: &str) -> Self {
        Self {
            success: false,
            error: Some(error.to_string()),
        }
    }
}

/// Whether the agent can actually reach the backend, as distinct from merely holding a
/// token.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    Connected,
    Disconnected,
    SignedOut,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectResult {
    pub success: bool,
    /// True only when recovery genuinely needs a browser link again.
    pub needs_relink: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// The disclosure notice as shown to the UI, composed server-side from the live
/// monitoring_policy row - the agent never hardcodes or composes this text itself.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringNoticeView {
    pub version: String,
    pub text: String,
    pub requires_acknowledgement: bool,
}

/// The viewer's own People-page member record (GET /api/members/current) - the same data
/// the web dashboard's Members table shows for this person, not just what's in their
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemberProfile {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub avatar_url: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub date_added: String,
    #[serde(default)]
    pub phone: String,
    #[serde(default)]
    pub teams: u32,
    /// The member's own IANA zone (`members.timezone`) - the calendar every day-boundary
    /// decision for this person is resolved in, and the fallback a project's own zone
    #[serde(default)]
    pub timezone: String,
}
