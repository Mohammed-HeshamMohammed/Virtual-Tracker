//! Desktop notifications, the same call in both builds.
//!
//! The normal build uses the notification plugin (Windows 10/11 toasts, macOS and
//! Linux notifications). Those toasts are WinRT, which Windows 7, 8 and 8.1 do not
//! have, and the legacy build may not even import it, so there the notification is a
//! small window the app draws itself (`win7-notifications`, the same crate the plugin
//! uses for its own Windows 7 mode). The frontend reaches both through one command,
//! `show_notification`, instead of the plugin's JS API.

use tauri::AppHandle;

/// Best effort: a notification that cannot be shown is dropped, never reported as if
/// whatever triggered it had failed.
pub fn show(app: &AppHandle, title: &str, body: &str) {
    #[cfg(feature = "modern")]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = app.notification().builder().title(title).body(body).show();
    }

    #[cfg(all(not(feature = "modern"), feature = "legacy-windows", windows))]
    {
        let (title, body) = (title.to_string(), body.to_string());
        let icon = app.default_window_icon().map(|icon| (icon.rgba().to_vec(), icon.width(), icon.height()));
        // It is a window, so it has to be made on the main thread.
        let _ = app.run_on_main_thread(move || {
            let mut notification = win7_notifications::Notification::new();
            notification.summary(&title).body(&body);
            if let Some((rgba, width, height)) = icon {
                notification.icon(rgba, width, height);
            }
            let _ = notification.show();
        });
    }

    #[cfg(not(any(feature = "modern", all(feature = "legacy-windows", windows))))]
    let _ = (app, title, body);
}

#[tauri::command]
pub fn show_notification(app: AppHandle, title: String, body: String) {
    show(&app, &title, &body);
}
