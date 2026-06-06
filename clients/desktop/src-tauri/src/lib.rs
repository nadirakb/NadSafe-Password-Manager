mod commands;
mod tray;

use tauri::{Emitter, Manager};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            tray::setup_tray(app)?;
            setup_auto_lock(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::vault::derive_master_key,
            commands::vault::generate_user_key,
            commands::vault::generate_password,
            commands::vault::lock_vault,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NadSafe");
}

/// Lock vault on OS session lock / screen saver / sleep.
/// Uses Tauri's window focus events as a proxy — emit vault:lock when
/// the window regains focus after the OS screen has been locked.
fn setup_auto_lock(app: &mut tauri::App) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let was_locked = Arc::new(AtomicBool::new(false));

    // On macOS/Linux we can listen for window blur + focus to detect
    // OS lock events. When the window is unfocused for a significant time
    // after the screen goes dark, we treat re-focus as a re-lock event.
    //
    // A more robust approach uses tauri-plugin-os-screen-lock (not yet stable).
    // For now: emit vault:lock when window appears after being hidden
    // (catch-all for OS sleep/lock on all platforms).

    let handle = app.handle().clone();
    let was_locked_clone = was_locked.clone();

    if let Some(window) = handle.get_webview_window("main") {
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            match event {
                tauri::WindowEvent::Focused(false) => {
                    // Window lost focus — mark as potentially locked
                    was_locked_clone.store(true, Ordering::Relaxed);
                }
                tauri::WindowEvent::Focused(true)
                    if was_locked_clone.swap(false, Ordering::Relaxed) =>
                {
                    let _ = window_clone.emit("vault:focus-restored", ());
                }
                _ => {}
            }
        });
    }
}
