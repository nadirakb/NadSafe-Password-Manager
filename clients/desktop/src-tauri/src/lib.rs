mod commands;
mod tray;

use tauri::{Emitter, Manager};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Second instance launched — bring existing window to front
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            tray::setup_tray(app)?;
            setup_window_behavior(app);
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

/// Hide to tray on close instead of quitting.
fn setup_window_behavior(app: &mut tauri::App) {
    if let Some(window) = app.get_webview_window("main") {
        let win = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = win.hide();
            }
        });
    }
}

/// Lock vault on OS session lock / screen saver / sleep.
fn setup_auto_lock(app: &mut tauri::App) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let was_locked = Arc::new(AtomicBool::new(false));

    let handle = app.handle().clone();
    let was_locked_clone = was_locked.clone();

    if let Some(window) = handle.get_webview_window("main") {
        let window_clone = window.clone();
        window.on_window_event(move |event| {
            match event {
                tauri::WindowEvent::Focused(false) => {
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
