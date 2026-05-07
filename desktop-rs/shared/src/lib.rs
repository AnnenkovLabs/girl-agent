//! Shared building blocks for the girl-agent desktop app + installer.
//!
//! This crate is intentionally small and free of GUI logic: it owns the brand
//! palette, the embedded font assets, the Node.js child-process driver and the
//! types we exchange with the running bot.

pub mod config;
pub mod fonts;
pub mod paths;
pub mod runtime_client;
pub mod settings;
pub mod theme;
pub mod types;

pub use types::*;
