//! The Tauri command surface, grouped by what each command is for.
//!
//! These used to sit in lib.rs alongside the tray, the logging setup and
//! the app builder - 52 commands in a file that was mostly about
//! something else. lib.rs now holds the wiring and nothing else.

pub mod auth;
pub mod shell;
pub mod app_info;
pub mod inbox;
pub mod work;
pub mod insights;
