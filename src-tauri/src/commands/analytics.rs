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

#[derive(Debug, Serialize, Deserialize)]
pub struct BreakdownResponse {
    pub labels: Vec<String>,
    pub transcripts: Vec<i32>,
    pub meetings: Vec<i32>,
    pub actions: Vec<i32>,
    pub docs: Vec<i32>,
    pub notes: Vec<i32>,
    pub meetings_by_platform: std::collections::HashMap<String, i32>,
    pub actions_by_app: std::collections::HashMap<String, i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct InsightsResponse {
    pub headline: String,
    pub highlights: Vec<String>,
    pub generated_at: String,
    #[serde(default)]
    pub nudge: Option<String>,
    #[serde(default)]
    pub nudge_cta: Option<String>,
    #[serde(default)]
    pub nudge_page: Option<String>,
}

/// Get user statistics
#[tauri::command]
pub async fn get_analytics_stats(app: AppHandle) -> Result<StatsResponse, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Ok(token) => token,
        Err(e) => {
            crate::commands::auth::handle_auth_error(&app, &e);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!("{}/api/v1/analytics/stats", crate::config::api_base_url());

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
        Ok(token) => token,
        Err(e) => {
            crate::commands::auth::handle_auth_error(&app, &e);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!(
        "{}/api/v1/analytics/chart?period={}",
        crate::config::api_base_url(),
        period
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

/// Get activity breakdown (transcripts/meetings/actions/docs/notes) for a specific period
#[tauri::command]
pub async fn get_analytics_breakdown(
    app: AppHandle,
    period: String,
) -> Result<BreakdownResponse, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Ok(token) => token,
        Err(e) => {
            crate::commands::auth::handle_auth_error(&app, &e);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!(
        "{}/api/v1/analytics/breakdown?period={}",
        crate::config::api_base_url(),
        period
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

/// Get an inferred summary of problems/tasks Lexi has recently helped with, based on the
/// most recent activity (not scoped to a fixed period)
#[tauri::command]
pub async fn get_analytics_insights(app: AppHandle) -> Result<InsightsResponse, String> {
    let auth_token = match get_auth_token_async(&app).await {
        Ok(token) => token,
        Err(e) => {
            crate::commands::auth::handle_auth_error(&app, &e);
            return Err("Authentication required".to_string());
        }
    };

    let url = format!(
        "{}/api/v1/analytics/insights",
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
