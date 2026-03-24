//! Billing usage (current period) from Lexi server.

use crate::commands::auth::get_auth_token_async;
use crate::utils;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct FeatureUsageEntry {
    pub feature_key: String,
    pub enabled: bool,
    pub used: i64,
    pub limit_value: Option<i64>,
    pub limit_reset: String,
    pub metered: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BillingUsageResponse {
    pub plan_type: String,
    pub period_start: String,
    pub period_end: String,
    pub limit_reset: String,
    pub features: Vec<FeatureUsageEntry>,
}

/// GET /api/v1/billing/usage — current weekly window and per-feature usage.
#[tauri::command]
pub async fn get_billing_usage(app: AppHandle) -> Result<BillingUsageResponse, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Ok(token) => token,
        Err(_) => {
            crate::commands::auth::handle_auth_expired(&app);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!("{}/api/v1/billing/usage", crate::config::api_base_url());

    utils::log_api_request("Get billing usage (current period)", "GET", &url);

    let client = crate::utils::create_http_client();
    let response = client
        .get(&url)
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

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    serde_json::from_value(data).map_err(|e| format!("Failed to deserialize response: {}", e))
}
