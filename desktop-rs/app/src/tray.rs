//! Optional system tray integration.
//!
//! The `tray-icon` crate is loaded on Windows + macOS only — on Linux it
//! requires `libayatana-appindicator3`, which we don't want to make a hard
//! build-time dep. The Linux build still compiles and runs, just without a
//! tray icon (the user can rely on the OS taskbar in that case).

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub mod imp {
    use std::sync::Arc;

    use tray_icon::menu::{Menu, MenuEvent, MenuItem};
    use tray_icon::{Icon, TrayIcon, TrayIconBuilder};

    pub struct AppTray {
        _icon: TrayIcon,
        pub menu_show_id: tray_icon::menu::MenuId,
        pub menu_pause_id: tray_icon::menu::MenuId,
        pub menu_web_id: tray_icon::menu::MenuId,
        pub menu_quit_id: tray_icon::menu::MenuId,
    }

    pub fn build() -> anyhow::Result<Arc<AppTray>> {
        let icon = make_icon()?;
        let menu = Menu::new();
        let show = MenuItem::new("Show", true, None);
        let pause = MenuItem::new("Pause / Resume", true, None);
        let web = MenuItem::new("Open Web UI", true, None);
        let sep = tray_icon::menu::PredefinedMenuItem::separator();
        let quit = MenuItem::new("Quit", true, None);
        menu.append(&show)?;
        menu.append(&pause)?;
        menu.append(&web)?;
        menu.append(&sep)?;
        menu.append(&quit)?;

        let tray = TrayIconBuilder::new()
            .with_tooltip("girl-agent")
            .with_menu(Box::new(menu))
            .with_icon(icon)
            .build()?;

        Ok(Arc::new(AppTray {
            _icon: tray,
            menu_show_id: show.id().clone(),
            menu_pause_id: pause.id().clone(),
            menu_web_id: web.id().clone(),
            menu_quit_id: quit.id().clone(),
        }))
    }

    pub fn poll_event() -> Option<tray_icon::menu::MenuId> {
        MenuEvent::receiver().try_recv().ok().map(|e| e.id().clone())
    }

    fn make_icon() -> anyhow::Result<Icon> {
        // 32x32 RGBA filled with the brand accent — good enough for an MVP.
        const SIZE: u32 = 32;
        let mut buf = Vec::with_capacity((SIZE * SIZE * 4) as usize);
        let (r, g, b) = (0xE8, 0x41, 0x2A);
        for _ in 0..(SIZE * SIZE) {
            buf.extend_from_slice(&[r, g, b, 0xFF]);
        }
        Icon::from_rgba(buf, SIZE, SIZE).map_err(Into::into)
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
pub mod imp {
    use std::sync::Arc;

    pub struct AppTray;

    pub fn build() -> anyhow::Result<Arc<AppTray>> {
        Ok(Arc::new(AppTray))
    }

    pub fn poll_event() -> Option<()> {
        None
    }
}

