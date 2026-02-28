//! Router assembly: HTTP endpoints, WebSocket upgrade, static files, CORS, and HTTP tracing.

use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};
use tower_http::{
    cors::{Any, CorsLayer},
    services::{ServeDir, ServeFile},
    trace::{DefaultMakeSpan, DefaultOnRequest, DefaultOnResponse, TraceLayer},
};
use tracing::Level;

use crate::state::AppState;

pub mod http;
pub mod ws;

/// Build the application router with:
/// - WebSocket at `/ws`
/// - REST-ish API under `/api/v1/...`
/// - Static SPA from `./static` with index fallback
/// - CORS (allow any origin/method/headers) – adjust for production if needed
/// - HTTP trace layer (per-request spans w/ method, path, status, latency)
pub fn build_router(state: Arc<AppState>) -> Router {
    // Static files with SPA fallback
    let static_service = ServeDir::new("./static")
        .append_index_html_on_directories(true)
        .not_found_service(ServeFile::new("./static/index.html"));

    Router::new()
        // WebSocket
        .route("/ws", get(ws::ws_upgrade))
        // HTTP API
        .route("/api/v1/health", get(http::http_health))
        .route("/api/v1/challenge", get(http::http_get_challenge))
        .route("/api/v1/answer", post(http::http_post_answer))
        .route("/api/v1/hint", get(http::http_get_hint))
        .route("/api/v1/translate", post(http::http_post_translate))
        .route("/api/v1/pinyin", post(http::http_post_pinyin))
        .route("/api/v1/grammar", post(http::http_post_grammar)) // NEW
        .route("/api/v1/next_char", post(http::http_post_next_char))
        .route("/api/v1/agent/message", post(http::http_post_agent_message))
        // State + CORS + HTTP tracing
        .with_state(state)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_request(DefaultOnRequest::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
        // Frontend fallback
        .fallback_service(static_service)
}
