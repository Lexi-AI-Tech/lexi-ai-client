//! Background refresh of access JWT and feature-usage token (non-blocking).

use std::sync::atomic::{AtomicU64, Ordering};

use tauri::AppHandle;
use tokio::time::{interval, Duration};

use crate::commands::auth::refresh_auth_token;
use crate::commands::billing::hydrate_feature_usage_from_cloud_quiet;
use crate::secure_storage;

static LAST_REFRESH_UNIX: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug)]
pub enum SessionRefreshReason {
    Startup,
    Foreground,
    Periodic,
}

impl SessionRefreshReason {
    fn label(self) -> &'static str {
        match self {
            Self::Startup => "startup",
            Self::Foreground => "foreground",
            Self::Periodic => "periodic",
        }
    }

    /// Minimum seconds since the last refresh before this reason runs again.
    fn min_interval_secs(self) -> u64 {
        match self {
            Self::Startup => 0,
            Self::Foreground => 120,
            Self::Periodic => 0,
        }
    }
}

fn unix_now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn has_refreshable_session(app: &AppHandle) -> bool {
    match secure_storage::get_auth_data(app) {
        Ok(Some(auth)) => auth.refresh_token.as_ref().is_some_and(|t| !t.is_empty()),
        _ => false,
    }
}

fn should_skip(reason: SessionRefreshReason) -> bool {
    let min_secs = reason.min_interval_secs();
    if min_secs == 0 {
        return false;
    }
    let last = LAST_REFRESH_UNIX.load(Ordering::Relaxed);
    unix_now_secs().saturating_sub(last) < min_secs
}

async fn run_session_refresh(app: &AppHandle, reason: SessionRefreshReason) {
    if !has_refreshable_session(app) {
        return;
    }
    if should_skip(reason) {
        return;
    }

    LAST_REFRESH_UNIX.store(unix_now_secs(), Ordering::Relaxed);
    let label = reason.label();

    match refresh_auth_token(app.clone()).await {
        Ok(true) => println!("✅ Session refresh ({label}): access token"),
        Ok(false) => println!("ℹ️  Session refresh ({label}): access token unchanged"),
        Err(e) => eprintln!("⚠️  Session refresh ({label}): access token failed: {e}"),
    }

    match hydrate_feature_usage_from_cloud_quiet(app).await {
        Ok(()) => println!("✅ Session refresh ({label}): feature usage"),
        Err(e) => eprintln!("⚠️  Session refresh ({label}): feature usage failed: {e}"),
    }
}

/// Spawn a one-shot refresh (does not block the UI).
pub fn spawn_session_refresh(app: AppHandle, reason: SessionRefreshReason) {
    tauri::async_runtime::spawn(async move {
        run_session_refresh(&app, reason).await;
    });
}

/// Periodic refresh while the Tauri process is alive (works when the app is backgrounded).
pub async fn start_session_refresh_scheduler(app: AppHandle) {
    const PERIODIC_EVERY_SECS: u64 = 30 * 60;

    spawn_session_refresh(app.clone(), SessionRefreshReason::Startup);

    let mut tick = interval(Duration::from_secs(PERIODIC_EVERY_SECS));
    tick.tick().await;

    loop {
        tick.tick().await;
        run_session_refresh(&app, SessionRefreshReason::Periodic).await;
    }
}
