fn main() {
    // Tauri's default manifest has no `supportedOS` entry (see windows-app-manifest.xml), so this
    // is that default plus one. The invisible window over the maximize button must be layered.
    let windows = tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app-manifest.xml"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows)).expect("failed to run tauri-build");
}
