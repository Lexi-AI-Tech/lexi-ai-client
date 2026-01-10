//! Utility Commands
//!
//! This module provides Tauri commands for utility functions that can be called from the frontend.

use crate::utils;

/// Get the current system type as a string
///
/// Returns "mac" for macOS, "windows" for Windows.
/// This uses compile-time platform detection, which is more reliable than user agent parsing.
///
#[tauri::command]
pub fn get_system_type() -> &'static str {
    utils::get_system_type()
}

/// Get the device type as a string
///
#[tauri::command]
pub fn get_device_type() -> &'static str {
    utils::get_device_type()
}

/// Format a date string as a relative time (e.g., "Just now", "5 minutes ago", "2 hours ago")
///
/// This provides human-readable relative time formatting similar to social media platforms.
/// For dates older than 7 days, returns a formatted date string.
///
/// # Arguments
/// * `date_string` - ISO 8601 date string (e.g., "2024-01-10T14:30:00Z")
///
/// # Returns
/// * `String` - Formatted relative time string
#[tauri::command]
pub fn format_date_relative(date_string: String) -> Result<String, String> {
    let date_utc = chrono::DateTime::parse_from_rfc3339(&date_string)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .or_else(|_| {
            // Try parsing as ISO 8601 without timezone
            chrono::NaiveDateTime::parse_from_str(&date_string, "%Y-%m-%dT%H:%M:%S")
                .map(|dt| dt.and_utc())
        })
        .or_else(|_| {
            // Try parsing as simple date
            chrono::NaiveDate::parse_from_str(&date_string, "%Y-%m-%d")
                .map(|d| d.and_hms_opt(0, 0, 0).unwrap().and_utc())
        })
        .map_err(|e| format!("Failed to parse date: {}", e))?;

    let now = chrono::Utc::now();
    let diff = now - date_utc;

    let diff_mins = diff.num_minutes();
    let diff_hours = diff.num_hours();
    let diff_days = diff.num_days();

    if diff_mins < 1 {
        Ok("Just now".to_string())
    } else if diff_mins < 60 {
        let mins = diff_mins as i64;
        Ok(format!("{} minute{} ago", mins, if mins > 1 { "s" } else { "" }))
    } else if diff_hours < 24 {
        let hours = diff_hours as i64;
        Ok(format!("{} hour{} ago", hours, if hours > 1 { "s" } else { "" }))
    } else if diff_days < 7 {
        let days = diff_days as i64;
        Ok(format!("{} day{} ago", days, if days > 1 { "s" } else { "" }))
    } else {
        // Format as date for older items
        Ok(date_utc.format("%b %d, %Y").to_string())
    }
}

/// Format a date string as a locale-aware date and time string
///
/// This provides a standard date and time format suitable for displaying timestamps.
///
/// # Arguments
/// * `date_string` - ISO 8601 date string (e.g., "2024-01-10T14:30:00Z")
///
/// # Returns
/// * `String` - Formatted date and time string
#[tauri::command]
pub fn format_date_time(date_string: String) -> Result<String, String> {
    let date_utc = chrono::DateTime::parse_from_rfc3339(&date_string)
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .or_else(|_| {
            // Try parsing as ISO 8601 without timezone
            chrono::NaiveDateTime::parse_from_str(&date_string, "%Y-%m-%dT%H:%M:%S")
                .map(|dt| dt.and_utc())
        })
        .or_else(|_| {
            // Try parsing as simple date
            chrono::NaiveDate::parse_from_str(&date_string, "%Y-%m-%d")
                .map(|d| d.and_hms_opt(0, 0, 0).unwrap().and_utc())
        })
        .map_err(|e| format!("Failed to parse date: {}", e))?;

    Ok(date_utc.format("%b %d, %Y at %I:%M %p").to_string())
}
