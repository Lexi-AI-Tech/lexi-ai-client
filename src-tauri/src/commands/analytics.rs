//! Analytics Commands
//!
//! Tauri commands for fetching analytics data.

use crate::commands::auth::get_auth_token_async;
use crate::utils;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct StatsResponse {
    pub words_typed_this_week: i32,
    pub time_saved_minutes: i32,
    pub current_streak: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChartDataResponse {
    pub labels: Vec<String>,
    pub data: Vec<i32>,
    pub total_transcriptions: i32,
}

/// Get user statistics
#[tauri::command]
pub async fn get_analytics_stats(app: AppHandle) -> Result<StatsResponse, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Some(token) => token,
        None => {
            crate::commands::auth::handle_auth_expired(&app);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!("{}/api/v1/analytics/stats", crate::config::api_base_url());

    utils::log_api_request("Get user statistics", "GET", &url);

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

    // Handle both direct response and wrapped response if needed (similar to transcripts)
    // Assuming backend returns direct JSON matching the struct based on implementation
    serde_json::from_value(data).map_err(|e| format!("Failed to deserialize response: {}", e))
}

/// Get chart data for a specific period
#[tauri::command]
pub async fn get_analytics_chart(
    app: AppHandle,
    period: String,
) -> Result<ChartDataResponse, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Some(token) => token,
        None => {
            crate::commands::auth::handle_auth_expired(&app);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!(
        "{}/api/v1/analytics/chart?period={}",
        crate::config::api_base_url(),
        period
    );

    utils::log_api_request("Get chart data for specific period", "GET", &url);

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
