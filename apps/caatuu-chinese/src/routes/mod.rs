//! Router assembly: HTTP endpoints, WebSocket upgrade, static files, CORS, and HTTP tracing.

use std::{path::PathBuf, sync::Arc};

use axum::{
    response::Redirect,
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

/// Build the unified Caatuu runtime:
/// - `/` serves the Caatuu landing page.
/// - `/zh/` serves the Chinese trainer and the Rust API/WebSocket backend.
/// - `/cz/` serves the Czech PWA and browser-side WebLLM assets.
pub fn build_router(state: Arc<AppState>) -> Router {
    let workspace = workspace_root();
    let unified_static = workspace.join("apps/caatuu-unified/static");
    let chinese_static = workspace.join("apps/caatuu-chinese/static");
    let czech_static = workspace.join("apps/caatuu-czech/static");

    let chinese_static_service = ServeDir::new(chinese_static.clone())
        .append_index_html_on_directories(true)
        .not_found_service(ServeFile::new(chinese_static.join("index.html")));
    let czech_static_service = ServeDir::new(czech_static.clone())
        .append_index_html_on_directories(true)
        .not_found_service(ServeFile::new(czech_static.join("index.html")));

    let czech_app = Router::new()
        .route_service("/", ServeFile::new(czech_static.join("index.html")))
        .fallback_service(czech_static_service);

    let chinese_app = Router::new()
        .route("/ws", get(ws::ws_upgrade))
        .nest("/api/v1", api_router())
        .route_service("/", ServeFile::new(chinese_static.join("index.html")))
        .route_service(
            "/challenge",
            ServeFile::new(chinese_static.join("challenge.html")),
        )
        .route_service(
            "/challenge/",
            ServeFile::new(chinese_static.join("challenge.html")),
        )
        .route_service(
            "/secuence",
            ServeFile::new(chinese_static.join("secuence.html")),
        )
        .route_service(
            "/secuence/",
            ServeFile::new(chinese_static.join("secuence.html")),
        )
        .route_service(
            "/writing",
            ServeFile::new(chinese_static.join("writing.html")),
        )
        .route_service(
            "/writing/",
            ServeFile::new(chinese_static.join("writing.html")),
        )
        .fallback_service(chinese_static_service);

    Router::new()
        .route("/ws", get(ws::ws_upgrade))
        .nest("/api/v1", api_router())
        .route_service("/", ServeFile::new(unified_static.join("index.html")))
        .route_service("/app.css", ServeFile::new(unified_static.join("app.css")))
        .route_service("/cz/", ServeFile::new(czech_static.join("index.html")))
        .route_service("/zh/", ServeFile::new(chinese_static.join("index.html")))
        .nest("/cz", czech_app)
        .nest("/zh", chinese_app)
        // Compatibility for old Chinese URLs.
        .route(
            "/challenge",
            get(|| async { Redirect::permanent("/zh/challenge") }),
        )
        .route(
            "/challenge/",
            get(|| async { Redirect::permanent("/zh/challenge") }),
        )
        .route(
            "/secuence",
            get(|| async { Redirect::permanent("/zh/secuence") }),
        )
        .route(
            "/secuence/",
            get(|| async { Redirect::permanent("/zh/secuence") }),
        )
        .route(
            "/writing",
            get(|| async { Redirect::permanent("/zh/writing") }),
        )
        .route(
            "/writing/",
            get(|| async { Redirect::permanent("/zh/writing") }),
        )
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
        .fallback_service(ServeFile::new(unified_static.join("index.html")))
}

fn api_router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/health", get(http::http_health))
        .route("/challenge", get(http::http_get_challenge))
        .route("/answer", post(http::http_post_answer))
        .route("/hint", get(http::http_get_hint))
        .route("/translate", post(http::http_post_translate))
        .route("/pinyin", post(http::http_post_pinyin))
        .route("/grammar", post(http::http_post_grammar))
        .route("/next_char", post(http::http_post_next_char))
        .route("/agent/message", post(http::http_post_agent_message))
        .route("/secuence/words", post(http::http_post_secuence_words))
        .route(
            "/secuence/evaluate",
            post(http::http_post_secuence_evaluate),
        )
}

fn workspace_root() -> PathBuf {
    if let Ok(path) = std::env::var("CAATUU_WORKSPACE_ROOT") {
        return PathBuf::from(path);
    }

    let current = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if current
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name == "caatuu-chinese")
    {
        return current
            .parent()
            .and_then(|apps| apps.parent())
            .map(PathBuf::from)
            .unwrap_or(current);
    }

    current
}
