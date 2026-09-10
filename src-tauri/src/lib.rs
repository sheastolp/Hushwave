#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebView2 (and Electron/Chromium apps generally) render through GPU compositing by
    // default, which OBS's older "Window Capture" method (BitBlt) often can't see at all —
    // resulting in a black or missing capture even though the window is clearly visible on
    // screen. Disabling GPU compositing for the WebView trades a little rendering performance
    // for compatibility with that capture method. This has no effect unless something (like
    // OBS) is specifically trying to capture the window via BitBlt.
    #[cfg(target_os = "windows")]
    unsafe {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "--disable-gpu-compositing",
        );
    }

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Hushwave");
}
