//! Cache warmup commands
//!
//! Keeps server-side caches warm (user + app_config) for low-latency real-time features.

use crate::commands::auth::get_auth_token_async;
use crate::secure_storage;
use crate::utils;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct CacheWarmupResponse {
    pub success: bool,
    #[serde(default)]
    pub timestamp: Option<String>,
}

/// Warm server-side caches for the current user (best-effort).
#[tauri::command]
pub async fn user_cache_warmup(app: AppHandle) -> Result<CacheWarmupResponse, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Ok(token) => token,
        Err(_) => {
            crate::commands::auth::handle_auth_expired(&app);
            return Err("Authentication required".to_string());
        }
    };

    let url = crate::api_endpoints::cache::warmup_url(utils::get_system_type(), utils::get_device_type());
    utils::log_api_request("POST", &url);

    let client = crate::utils::create_http_client();
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(format!("Server error ({}): {}", status, error_text));
    }

    response
        .json::<CacheWarmupResponse>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))
}

fn unix_now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn is_token_valid(auth: &secure_storage::AuthData) -> bool {
    let Some(expires_at) = auth.expires_at else {
        return false;
    };
    expires_at > unix_now_secs()
}

/// Background scheduler (Rust-side) so warmup runs even when UI timers are throttled.
///
/// Runs forever while the Tauri process is alive.
pub async fn start_user_cache_warmup_scheduler(app: AppHandle) {
    use tokio::time::{interval, Duration};

    // How often the scheduler wakes up to *check* whether warmup should run.
    // We keep this relatively infrequent to avoid background churn.
    const CHECK_EVERY_SECS: u64 = 15 * 60; // 15 minutes

    // Minimum interval between warmup runs (enforced via `last_warmup_at`).
    const WARMUP_EVERY_SECS: u64 = 60 * 60; // 1 hour

    let mut tick = interval(Duration::from_secs(CHECK_EVERY_SECS));
    let mut last_warmup_at: u64 = 0;

    // Best-effort: attempt an immediate warmup on app startup so we don't wait
    // for the first interval tick.
    if let Ok(Some(auth)) = secure_storage::get_auth_data(&app) {
        if is_token_valid(&auth) {
            let now = unix_now_secs();
            let _ = get_auth_token_async(&app).await;
            let _ = user_cache_warmup(app.clone()).await;
            last_warmup_at = now;
        }
    }

    loop {
        tick.tick().await;

        let now = unix_now_secs();
        if last_warmup_at != 0 && now.saturating_sub(last_warmup_at) < WARMUP_EVERY_SECS {
            continue;
        }

        let auth = match secure_storage::get_auth_data(&app) {
            Ok(Some(a)) => a,
            _ => continue,
        };

        if !is_token_valid(&auth) {
            continue;
        }

        // Best-effort warmup. Do not emit auth-expired or block app lifecycle.
        let _ = get_auth_token_async(&app).await;
        let _ = user_cache_warmup(app.clone()).await;
        last_warmup_at = now;
    }
}

