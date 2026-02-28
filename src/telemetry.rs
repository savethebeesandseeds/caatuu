//! Telemetry initialization (tracing/tracing-subscriber).
//!
//! Behavior:
//! - LOG_LEVEL controls the filter (e.g. "debug" or detailed directives like
//!   "info,challenge=debug,caatuu_backend=debug,tower_http=info,axum=info").
//! - LOG_FORMAT selects "pretty" (default) or "json" structured logs.
//!
//! Notes:
//! - We include targets in the output to disambiguate sources.
//! - Tower HTTP TraceLayer still adds per-request spans; this complements it.

use tracing_subscriber::EnvFilter;

pub fn init_tracing() {
    // Build a single fmt subscriber builder and attach the EnvFilter directly.
    let filter = EnvFilter::try_from_env("LOG_LEVEL").unwrap_or_else(|_| {
        EnvFilter::new("info,challenge=debug,caatuu_backend=debug,tower_http=info,axum=info")
    });

    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_file(true)
        .with_line_number(true);

    // Choose JSON vs pretty; don't try to store different layer types.
    match std::env::var("LOG_FORMAT").as_deref() {
        Ok("json") => {
            builder.json().init();
        }
        _ => {
            builder.init();
        }
    }
}
