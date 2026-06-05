mod commands;
mod tray;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            tray::setup_tray(app)?;
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
