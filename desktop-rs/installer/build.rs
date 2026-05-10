fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").unwrap() == "windows" {
        let mut res = winres::WindowsResource::new();
        res.set_icon("assets/icon.png"); // winres can sometimes convert if it finds a tool, or we might need an .ico
        res.set("ProductName", "girl-agent installer");
        res.set("FileDescription", "girl-agent installer");
        res.set("LegalCopyright", "Copyright (c) 2026 TheSashaDev");
        if let Err(e) = res.compile() {
            eprintln!("failed to compile winres: {}", e);
        }
    }
}
