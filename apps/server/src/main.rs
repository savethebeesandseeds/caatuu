//! Caatuu server
//!
//! - Axum HTTP runtime
//! - Root browser launcher and catalog-driven language course routes
//! - Repository-only archives are not mounted or activatable
//!
//! Important env variables:
//!   BIND_ADDR    : listener IP (default 127.0.0.1; Compose sets 0.0.0.0 inside the container)
//!   PORT          : u16 (default 9172)
//!   RUST_LOG     : tracing filter, e.g. "debug" or full directives
//!   LOG_FORMAT      : "pretty" (default) or "json"

mod config;
mod coreplus;
mod domain;
mod language_catalog;
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

    // Build shared application state. Archived backend integrations are not initialized.
    let features = RuntimeFeatures::from_env();
    let state = Arc::new(AppState::new()?);

    // Build the HTTP router with active static routes and tracing.
    let app = build_router(state.clone(), features);

    let listener = TcpListener::bind(addr).await?;
    info!(target: "caatuu_runtime", %addr, "HTTP server listening");
    axum::serve(listener, app).await?;
    Ok(())
}
