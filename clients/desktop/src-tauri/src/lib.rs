mod commands;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::vault::derive_master_key,
            commands::vault::generate_user_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NadSafe");
}
