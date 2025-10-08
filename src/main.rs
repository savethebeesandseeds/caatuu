//! Caatuu · Chinese Trainer Backend
//!
//! - Axum HTTP + WebSocket API
//! - Optional OpenAI integration (via environment variables)
//! - Static SPA fallback (./static/index.html)
//!
//! Important env variables:
//!   PORT          : u16 (default 3000)
//!   OPENAI_API_KEY    : enables OpenAI integration if present
//!   OPENAI_BASE_URL    : default "https://api.openai.com/v1"
//!   OPENAI_FAST_MODEL  : default "gpt-4o-mini"
//!   OPENAI_STRONG_MODEL   : default "gpt-4o"
//!   AGENT_CONFIG_PATH  : path to TOML config (prompts + optional challenge bank)
//!   LOG_LEVEL    : tracing filter, e.g. "debug" or full directives
//!   LOG_FORMAT      : "pretty" (default) or "json"

mod telemetry;
mod util;
mod domain;
mod config;
mod seeds;
mod state;
mod protocol;
mod logic;
mod openai;
mod routes;
mod pinyin;

use std::{net::SocketAddr, sync::Arc};
use tokio::net::TcpListener;
use tracing::{info, instrument};

use crate::routes::build_router;
use crate::state::AppState;

#[instrument(level = "info", skip_all)]
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
  telemetry::init_tracing();

  // Build shared application state (in-memory stores, OpenAI client, prompts).
  let state = Arc::new(AppState::new());

  // Build the HTTP router with routes, CORS and tracing layers.
  let app = build_router(state.clone());

  // Read port from env or default to 3000.
  let addr: SocketAddr = std::env::var("PORT")
    .ok()
    .and_then(|p| p.parse::<u16>().ok())
    .map(|port| SocketAddr::from(([0, 0, 0, 0], port)))
    .unwrap_or_else(|| SocketAddr::from(([0, 0, 0, 0], 3000)));

  let listener = TcpListener::bind(addr).await?;
  info!(target: "caatuu_backend", %addr, "HTTP server listening");
  axum::serve(listener, app).await?;
  Ok(())
}
