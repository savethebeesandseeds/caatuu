//! Router assembly: HTTP endpoints, WebSocket upgrade, static files, CORS, and HTTP tracing.

use std::{path::PathBuf, sync::Arc};

use axum::{
    http::StatusCode,
    response::{Html, IntoResponse, Redirect},
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
/// - `/archive/chinese/` preserves the older Chinese trainer outside active apps.
/// - `/cz/` serves the Czech PWA and browser-side WebLLM assets.
pub fn build_router(state: Arc<AppState>) -> Router {
    let workspace = workspace_root();
    let unified_static = workspace.join("apps/caatuu-unified/static");
    let chinese_static = workspace.join("archive/caatuu-chinese/static");
    let czech_static = workspace.join("apps/caatuu-czech/static");
    let android_apk = workspace.join("artifacts/android/caatuu.apk");
    let android_manifest = workspace.join("artifacts/android/caatuu.json");
    let android_termux_install = workspace.join("tools/android-build/termux-install-debug.sh");

    let chinese_static_service = ServeDir::new(chinese_static.clone())
        .append_index_html_on_directories(true)
        .not_found_service(ServeFile::new(chinese_static.join("index.html")));
    let czech_static_service =
        ServeDir::new(czech_static.clone()).append_index_html_on_directories(true);

    let czech_app = Router::new()
        .route_service("/", ServeFile::new(czech_static.join("home.html")))
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
        .route_service("/", ServeFile::new(unified_static.join("index.html")))
        .route_service("/app.css", ServeFile::new(unified_static.join("app.css")))
        .route("/ws", get(retired_root_chinese_backend))
        .nest("/api/v1", retired_root_api_router())
        .nest_service("/assets", ServeDir::new(unified_static.join("assets")))
        .route_service("/android/caatuu.apk", ServeFile::new(android_apk.clone()))
        .route_service("/android/caatuu.json", ServeFile::new(android_manifest.clone()))
        // Compatibility for installed builds that still check the old debug-named URLs.
        .route_service("/android/caatuu-debug.apk", ServeFile::new(android_apk))
        .route_service("/android/caatuu-debug.json", ServeFile::new(android_manifest))
        .route_service(
            "/android/termux-install-debug.sh",
            ServeFile::new(android_termux_install),
        )
        .route_service("/cz/", ServeFile::new(czech_static.join("home.html")))
        .route("/zh", get(|| async { Redirect::permanent("/archive/chinese/") }))
        .route("/zh/", get(|| async { Redirect::permanent("/archive/chinese/") }))
        .route(
            "/zh/challenge",
            get(|| async { Redirect::permanent("/archive/chinese/challenge") }),
        )
        .route(
            "/zh/challenge/",
            get(|| async { Redirect::permanent("/archive/chinese/challenge") }),
        )
        .route(
            "/zh/secuence",
            get(|| async { Redirect::permanent("/archive/chinese/secuence") }),
        )
        .route(
            "/zh/secuence/",
            get(|| async { Redirect::permanent("/archive/chinese/secuence") }),
        )
        .route(
            "/zh/writing",
            get(|| async { Redirect::permanent("/archive/chinese/writing") }),
        )
        .route(
            "/zh/writing/",
            get(|| async { Redirect::permanent("/archive/chinese/writing") }),
        )
        .route_service(
            "/archive/chinese/",
            ServeFile::new(chinese_static.join("index.html")),
        )
        .nest("/cz", czech_app)
        .nest("/archive/chinese", chinese_app)
        // Compatibility for old Chinese URLs.
        .route(
            "/challenge",
            get(|| async { Redirect::permanent("/archive/chinese/challenge") }),
        )
        .route(
            "/challenge/",
            get(|| async { Redirect::permanent("/archive/chinese/challenge") }),
        )
        .route(
            "/secuence",
            get(|| async { Redirect::permanent("/archive/chinese/secuence") }),
        )
        .route(
            "/secuence/",
            get(|| async { Redirect::permanent("/archive/chinese/secuence") }),
        )
        .route(
            "/writing",
            get(|| async { Redirect::permanent("/archive/chinese/writing") }),
        )
        .route(
            "/writing/",
            get(|| async { Redirect::permanent("/archive/chinese/writing") }),
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
        .fallback(not_found_page)
}

async fn not_found_page() -> impl IntoResponse {
    let path = workspace_root().join("apps/caatuu-unified/static/not-found.html");
    let html = tokio::fs::read_to_string(path).await.unwrap_or_else(|_| {
        "<!doctype html><title>Page Not Found - Caatuu</title><h1>Page Not Found</h1>".to_string()
    });

    (StatusCode::NOT_FOUND, Html(html))
}

fn retired_root_api_router() -> Router<Arc<AppState>> {
    Router::new().fallback(retired_root_chinese_backend)
}

async fn retired_root_chinese_backend() -> (StatusCode, &'static str) {
    (
        StatusCode::GONE,
        "Chinese trainer backend moved to /archive/chinese/.",
    )
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
        .is_some_and(|name| name == "caatuu-runtime")
    {
        return current
            .parent()
            .and_then(|apps| apps.parent())
            .map(PathBuf::from)
            .unwrap_or(current);
    }

    current
}
