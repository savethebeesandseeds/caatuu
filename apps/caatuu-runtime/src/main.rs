//! Caatuu runtime server
//!
//! - Axum HTTP + WebSocket API
//! - Root browser launcher, Czech app routes, archived Chinese routes
//! - Optional OpenAI integration for the archived Chinese trainer
//!
//! Important env variables:
//!   BIND_ADDR    : listener IP (default 127.0.0.1; Compose sets 0.0.0.0 inside the container)
//!   PORT          : u16 (default 9172)
//!   OPENAI_API_KEY    : enables OpenAI integration if present
//!   OPENAI_BASE_URL    : default "https://api.openai.com/v1"
//!   OPENAI_FAST_MODEL  : default "gpt-4o-mini"
//!   OPENAI_WRITING_MODEL : default "gpt-4o-mini" (writing-mode translation/hints/agent/grammar)
//!   OPENAI_STRONG_MODEL   : default "gpt-4o"
//!   OPENAI_SEQUENCE_MODEL : default "gpt-4o-mini"
//!   OPENAI_TRANSCRIBE_MODEL : default "gpt-4o-transcribe"
//!   AGENT_CONFIG_PATH  : path to TOML config (prompts + optional challenge bank)
//!   RUST_LOG     : tracing filter, e.g. "debug" or full directives
//!   LOG_FORMAT      : "pretty" (default) or "json"

mod config;
mod coreplus;
mod domain;
mod logic;
mod openai;
mod pinyin;
mod protocol;
mod routes;
mod seeds;
mod state;
mod telemetry;
mod util;
mod vector_db;

use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
};
use tokio::net::TcpListener;
use tracing::{info, instrument};

use crate::config::RuntimeFeatures;
use crate::routes::build_router;
use crate::state::AppState;

#[instrument(level = "info", skip_all)]
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    telemetry::init_tracing();

    // Direct launches are local-only by default. Compose explicitly listens on
    // all container interfaces and publishes that port on the host loopback.
    // Validate the listener before initializing application state so malformed
    // startup configuration fails without doing model or data setup work.
    let bind_ip = std::env::var("BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1".to_string())
        .parse::<IpAddr>()?;
    let port = match std::env::var("PORT") {
        Ok(value) => value.parse::<u16>().map_err(|error| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!("PORT must be an integer from 0 to 65535, got {value:?}: {error}"),
            )
        })?,
        Err(std::env::VarError::NotPresent) => 9172,
        Err(std::env::VarError::NotUnicode(_)) => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "PORT is not valid Unicode.",
            )
            .into())
        }
    };
    let addr = SocketAddr::new(bind_ip, port);

    // Build shared application state (in-memory stores, OpenAI client, prompts).
    let features = RuntimeFeatures::from_env();
    let state = Arc::new(AppState::new(features)?);

    // Build the HTTP router with static routes, optional archived APIs, and tracing.
    let app = build_router(state.clone(), features);

    let listener = TcpListener::bind(addr).await?;
    info!(target: "caatuu_runtime", %addr, "HTTP server listening");
    axum::serve(listener, app).await?;
    Ok(())
}
