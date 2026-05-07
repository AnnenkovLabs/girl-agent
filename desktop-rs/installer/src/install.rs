//! Native install: extract bundled portable Node + cli.js + node_modules
//! into `<APPDATA>/girl-agent/runtime/`, write `<APPDATA>/girl-agent/data/<slug>/config.json`,
//! and persist the slug as the last-used profile.
//!
//! No `npm`, no `npx`, no shell — everything ships inside the installer binary
//! (xz-compressed) and is extracted with pure-Rust code.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;

use anyhow::{anyhow, Context, Result};
use girl_agent_shared::paths;
use serde_json::{json, Value};

use crate::config::{UserbotAuthSource, WizardData};

#[cfg(feature = "embed-runtime")]
const NODE_EXE_XZ: &[u8] = include_bytes!("../runtime/node.exe.xz");
#[cfg(not(feature = "embed-runtime"))]
const NODE_EXE_XZ: &[u8] = &[];

#[cfg(feature = "embed-runtime")]
const RUNTIME_TAR_XZ: &[u8] = include_bytes!("../runtime/runtime.tar.xz");
#[cfg(not(feature = "embed-runtime"))]
const RUNTIME_TAR_XZ: &[u8] = &[];

#[derive(Debug, Clone)]
pub struct InstallProgress {
    pub stage: InstallStage,
    pub fraction: f32,
    pub note: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallStage {
    Start,
    UnpackNode,
    UnpackRuntime,
    WriteConfig,
    Done,
}

#[derive(Debug, Clone)]
pub struct InstallReport {
    pub config_path: PathBuf,
    pub runtime_dir: PathBuf,
    pub node_path: PathBuf,
    pub cli_path: PathBuf,
    pub data_root: PathBuf,
    pub log: String,
}

pub fn run(data: &WizardData, progress: Sender<InstallProgress>) -> Result<InstallReport> {
    let mut log = String::new();
    let runtime_dir = paths::runtime_dir();
    let data_root = paths::data_dir();
    fs::create_dir_all(&runtime_dir).with_context(|| format!("create {}", runtime_dir.display()))?;

    let _ = progress.send(InstallProgress {
        stage: InstallStage::Start,
        fraction: 0.02,
        note: "подготовка…".into(),
    });

    log.push_str(&format!("runtime dir: {}\n", runtime_dir.display()));
    log.push_str(&format!("data dir:    {}\n", data_root.display()));

    let node_name = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
    let node_path = runtime_dir.join(node_name);
    let cli_path = runtime_dir.join("cli.js");

    if NODE_EXE_XZ.is_empty() {
        log.push_str("[skip] embed-runtime feature off — runtime not extracted\n");
    } else {
        let _ = progress.send(InstallProgress {
            stage: InstallStage::UnpackNode,
            fraction: 0.10,
            note: "распаковка node.exe…".into(),
        });
        let bytes = decompress_xz(NODE_EXE_XZ)?;
        log.push_str(&format!("decompressed node.exe: {} MB\n", bytes.len() / 1_000_000));
        fs::write(&node_path, &bytes)
            .with_context(|| format!("write {}", node_path.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut p = fs::metadata(&node_path)?.permissions();
            p.set_mode(0o755);
            fs::set_permissions(&node_path, p)?;
        }

        let _ = progress.send(InstallProgress {
            stage: InstallStage::UnpackRuntime,
            fraction: 0.55,
            note: "распаковка cli.js + зависимостей…".into(),
        });
        let tar_bytes = decompress_xz(RUNTIME_TAR_XZ)?;
        log.push_str(&format!("decompressed runtime.tar: {} MB\n", tar_bytes.len() / 1_000_000));
        let cursor = io::Cursor::new(tar_bytes);
        let mut archive = tar::Archive::new(cursor);
        archive.set_overwrite(true);
        archive
            .unpack(&runtime_dir)
            .with_context(|| format!("unpack runtime tar to {}", runtime_dir.display()))?;
    }

    let _ = progress.send(InstallProgress {
        stage: InstallStage::WriteConfig,
        fraction: 0.78,
        note: "создаю папку профиля…".into(),
    });

    let cfg = build_config_json(data);
    if data.slug.is_empty() {
        return Err(anyhow!("слаг профиля пустой — повтори ввод имени"));
    }
    let profile_dir = data_root.join(&data.slug);
    fs::create_dir_all(&profile_dir)
        .with_context(|| format!("create {}", profile_dir.display()))?;
    log.push_str(&format!("created profile dir: {}\n", profile_dir.display()));

    let _ = progress.send(InstallProgress {
        stage: InstallStage::WriteConfig,
        fraction: 0.86,
        note: "пишу персону…".into(),
    });

    let config_path = profile_dir.join("config.json");
    fs::write(&config_path, serde_json::to_string_pretty(&cfg)?)?;
    log.push_str(&format!("wrote {}\n", config_path.display()));

    // Sanity-check: make sure `list_profiles()` will pick this up. If the slug
    // is corrupt or the file unreadable we want to fail hard here, not later.
    let read_back = std::fs::read_to_string(&config_path)
        .with_context(|| format!("read back {}", config_path.display()))?;
    let _: serde_json::Value = serde_json::from_str(&read_back)
        .with_context(|| "config.json round-trip failed")?;
    log.push_str("verified config.json round-trip\n");

    let _ = progress.send(InstallProgress {
        stage: InstallStage::WriteConfig,
        fraction: 0.95,
        note: "сохраняю выбор профиля…".into(),
    });

    let mut s = girl_agent_shared::settings::Settings::load();
    s.last_profile = Some(data.slug.clone());
    s.save().with_context(|| "save settings.json")?;
    log.push_str(&format!("saved last_profile = {}\n", data.slug));

    let _ = progress.send(InstallProgress {
        stage: InstallStage::Done,
        fraction: 1.0,
        note: "готово".into(),
    });

    Ok(InstallReport {
        config_path,
        runtime_dir,
        node_path,
        cli_path,
        data_root,
        log,
    })
}

fn decompress_xz(input: &[u8]) -> Result<Vec<u8>> {
    if input.is_empty() {
        return Err(anyhow!("embedded runtime archive is empty"));
    }
    let mut reader = io::Cursor::new(input);
    let mut out = Vec::with_capacity(input.len() * 4);
    lzma_rs::xz_decompress(&mut reader, &mut out)
        .map_err(|e| anyhow!("xz decompress failed: {e}"))?;
    out.flush().ok();
    Ok(out)
}

fn build_config_json(d: &WizardData) -> Value {
    let now = chrono::Utc::now().to_rfc3339();

    let telegram = if d.mode == "bot" {
        json!({ "botToken": d.tg_token })
    } else {
        let api_id_str = if d.tg_resolved_api_id.is_empty() { d.tg_api_id.as_str() } else { d.tg_resolved_api_id.as_str() };
        let api_id_num: Option<i64> = api_id_str.trim().parse().ok();
        let api_hash = if d.tg_resolved_api_hash.is_empty() { d.tg_api_hash.as_str() } else { d.tg_resolved_api_hash.as_str() };
        let mut obj = serde_json::Map::new();
        if let Some(n) = api_id_num {
            obj.insert("apiId".into(), Value::from(n));
        }
        obj.insert("apiHash".into(), Value::from(api_hash.to_string()));
        obj.insert("phone".into(), Value::from(d.tg_phone.clone()));
        if !d.tg_session_string.is_empty() {
            obj.insert("sessionString".into(), Value::from(d.tg_session_string.clone()));
        }
        obj.insert(
            "ownedByProxy".into(),
            Value::from(matches!(d.userbot_source, UserbotAuthSource::Owner)),
        );
        Value::Object(obj)
    };

    let llm = json!({
        "presetId": d.llm_preset,
        "proto": d.current_llm_proto(),
        "baseURL": if d.llm_base_url.is_empty() { Value::Null } else { Value::from(d.llm_base_url.clone()) },
        "apiKey": d.llm_api_key,
        "model": d.llm_model,
    });

    let sleep_custom = if d.sleep_preset == "custom" {
        Some(json!({
            "fromHour": d.sleep_custom_from,
            "toHour": d.sleep_custom_to,
            "wakeChance": (d.sleep_custom_wake_chance as f64) / 100.0,
        }))
    } else {
        None
    };

    let mut profile = json!({
        "slug": d.slug,
        "name": d.name,
        "age": d.age,
        "nationality": d.nationality,
        "tz": d.tz,
        "mode": d.mode,
        "stage": d.stage,
        "communicationPreset": d.communication,
        "sleepPreset": d.sleep_preset,
        "privacy": d.privacy,
        "personaNotes": d.persona_notes,
        "createdAt": now,
        "llm": llm,
        "telegram": telegram,
        "vibe": "warm",
        "notifications": "normal",
    });
    if let Some(custom) = sleep_custom {
        if let Some(obj) = profile.as_object_mut() {
            obj.insert("sleepCustom".into(), custom);
        }
    }
    profile
}

#[allow(dead_code)]
pub fn runtime_archives_present() -> bool {
    let dir = installer_runtime_dir();
    dir.join("node.exe.xz").exists() && dir.join("runtime.tar.xz").exists()
}

#[allow(dead_code)]
fn installer_runtime_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            return dir.join("runtime");
        }
    }
    Path::new("runtime").to_path_buf()
}
