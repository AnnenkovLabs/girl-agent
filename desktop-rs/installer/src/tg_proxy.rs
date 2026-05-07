//! HTTP client for `tgproxy.girl-agent.com` — userbot login without
//! the user having to register their own api_id/api_hash.
//!
//! Endpoints (mirror of `src/telegram/remote-auth.ts`):
//! - `POST /send-code   { phone }                   -> { loginToken }`
//! - `POST /verify-code { loginToken, code }        -> { sessionString, apiId, apiHash } | { needs2fa: true, loginToken }`
//! - `POST /verify-password { loginToken, password } -> { sessionString, apiId, apiHash }`

use anyhow::{anyhow, Result};
use serde::Deserialize;
use serde_json::json;

const DEFAULT_PROXY: &str = "https://tgproxy.girl-agent.com";

fn proxy_url() -> String {
    std::env::var("GIRL_AGENT_AUTH_PROXY").unwrap_or_else(|_| DEFAULT_PROXY.to_string())
}

#[derive(Debug, Clone, Deserialize)]
pub struct SendCodeResult {
    #[serde(rename = "loginToken")]
    pub login_token: String,
}

#[derive(Debug, Clone)]
pub enum VerifyCodeResult {
    Success(AuthSuccess),
    Needs2Fa { login_token: String },
}

#[derive(Debug, Clone, Deserialize)]
pub struct AuthSuccess {
    #[serde(rename = "sessionString")]
    pub session_string: String,
    #[serde(rename = "apiId")]
    pub api_id: i64,
    #[serde(rename = "apiHash")]
    pub api_hash: String,
}

pub fn send_code(phone: &str) -> Result<SendCodeResult> {
    let url = format!("{}/send-code", proxy_url());
    let resp: serde_json::Value = ureq::post(&url)
        .set("Content-Type", "application/json")
        .send_json(json!({ "phone": phone }))
        .map_err(|e| anyhow!("/send-code: {e}"))?
        .into_json()
        .map_err(|e| anyhow!("/send-code parse: {e}"))?;
    if let Some(err) = resp.get("error").and_then(|v| v.as_str()) {
        return Err(anyhow!("прокси: {err}"));
    }
    let token = resp
        .get("loginToken")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("прокси не вернул loginToken"))?;
    Ok(SendCodeResult {
        login_token: token.to_string(),
    })
}

pub fn verify_code(login_token: &str, code: &str) -> Result<VerifyCodeResult> {
    let url = format!("{}/verify-code", proxy_url());
    let resp: serde_json::Value = ureq::post(&url)
        .set("Content-Type", "application/json")
        .send_json(json!({ "loginToken": login_token, "code": code }))
        .map_err(|e| anyhow!("/verify-code: {e}"))?
        .into_json()
        .map_err(|e| anyhow!("/verify-code parse: {e}"))?;
    if let Some(err) = resp.get("error").and_then(|v| v.as_str()) {
        return Err(anyhow!("прокси: {err}"));
    }
    if resp.get("needs2fa").and_then(|v| v.as_bool()).unwrap_or(false) {
        let lt = resp
            .get("loginToken")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("прокси не вернул loginToken для 2FA"))?
            .to_string();
        return Ok(VerifyCodeResult::Needs2Fa { login_token: lt });
    }
    let success: AuthSuccess = serde_json::from_value(resp).map_err(|e| anyhow!("разбор ответа: {e}"))?;
    Ok(VerifyCodeResult::Success(success))
}

pub fn verify_password(login_token: &str, password: &str) -> Result<AuthSuccess> {
    let url = format!("{}/verify-password", proxy_url());
    let resp: serde_json::Value = ureq::post(&url)
        .set("Content-Type", "application/json")
        .send_json(json!({ "loginToken": login_token, "password": password }))
        .map_err(|e| anyhow!("/verify-password: {e}"))?
        .into_json()
        .map_err(|e| anyhow!("/verify-password parse: {e}"))?;
    if let Some(err) = resp.get("error").and_then(|v| v.as_str()) {
        return Err(anyhow!("прокси: {err}"));
    }
    let success: AuthSuccess = serde_json::from_value(resp).map_err(|e| anyhow!("разбор ответа: {e}"))?;
    Ok(success)
}
