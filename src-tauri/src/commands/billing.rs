//! Billing API (feature usage period, checkout, subscription).

use crate::commands::auth::get_auth_token_async;
use crate::commands::feature_usage_store;
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
pub struct FeatureUsageResponse {
    pub plan_type: String,
    pub period_start: String,
    pub period_end: String,
    pub limit_reset: String,
    pub features: Vec<FeatureUsageEntry>,
    #[serde(default)]
    pub feature_usage: Option<String>,
}

async fn fetch_feature_usage_period(app: &AppHandle) -> Result<FeatureUsageResponse, String> {
    let auth_token = match get_auth_token_async(app).await {
        Ok(token) => token,
        Err(_) => {
            crate::commands::auth::handle_auth_expired(app);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!("{}/api/v1/billing/usage", crate::config::api_base_url());

    utils::log_api_request("GET", &url);

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

fn persist_feature_usage_from_response(app: &AppHandle, usage: &FeatureUsageResponse) {
    if let Some(ref jwt) = usage.feature_usage {
        if !jwt.is_empty() {
            if let Err(e) = feature_usage_store::save_feature_usage(app, jwt) {
                eprintln!("⚠️  Failed to save feature usage JWT: {}", e);
            }
        }
    }
}

/// Fetch feature usage from cloud and persist the signed JWT locally.
pub(crate) async fn hydrate_feature_usage_from_cloud(app: &AppHandle) -> Result<(), String> {
    let usage = fetch_feature_usage_period(app).await?;
    persist_feature_usage_from_response(app, &usage);
    Ok(())
}

/// GET /api/v1/billing/usage — current period window and per-feature usage.
#[tauri::command]
pub async fn get_feature_usage(app: AppHandle) -> Result<FeatureUsageResponse, String> {
    let usage = fetch_feature_usage_period(&app).await?;
    persist_feature_usage_from_response(&app, &usage);
    Ok(usage)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CheckoutResponse {
    pub session_id: String,
    pub checkout_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CancelSubscriptionResponse {
    pub status: String,
    pub subscription_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CurrentSubscriptionResponse {
    pub plan_type: String,
    pub subscription_status: Option<String>,
    pub cancel_at_period_end: bool,
    pub next_billing_date: Option<String>,
}

#[tauri::command]
pub async fn create_billing_checkout(
    app: AppHandle,
    plan_type: String,
) -> Result<CheckoutResponse, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Ok(token) => token,
        Err(_) => {
            crate::commands::auth::handle_auth_expired(&app);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!("{}/api/v1/billing/checkout", crate::config::api_base_url());

    utils::log_api_request("POST", &url);

    let client = crate::utils::create_http_client();
    let body = serde_json::json!({
        "plan_type": plan_type
    });

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", auth_token))
        .json(&body)
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

/// POST /api/v1/billing/cancel-subscription — cancel subscription at period end.
#[tauri::command]
pub async fn cancel_billing_subscription(
    app: AppHandle,
) -> Result<CancelSubscriptionResponse, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Ok(token) => token,
        Err(_) => {
            crate::commands::auth::handle_auth_expired(&app);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!(
        "{}/api/v1/billing/cancel-subscription",
        crate::config::api_base_url()
    );

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

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    serde_json::from_value(data).map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// GET /api/v1/billing/subscription — current plan + subscription status.
#[tauri::command]
pub async fn get_current_subscription(
    app: AppHandle,
) -> Result<CurrentSubscriptionResponse, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Ok(token) => token,
        Err(_) => {
            crate::commands::auth::handle_auth_expired(&app);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!(
        "{}/api/v1/billing/subscription",
        crate::config::api_base_url()
    );

    utils::log_api_request("GET", &url);

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
