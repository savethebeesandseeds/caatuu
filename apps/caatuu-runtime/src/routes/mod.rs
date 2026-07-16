//! Router assembly: HTTP endpoints, WebSocket upgrade, static files, and HTTP tracing.

use std::{path::PathBuf, sync::Arc};

use axum::{
    extract::DefaultBodyLimit,
    http::{header::HeaderName, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Redirect},
    routing::{get, post},
    Router,
};
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
    trace::{DefaultMakeSpan, DefaultOnRequest, DefaultOnResponse, TraceLayer},
};
use tracing::Level;

use crate::{config::RuntimeFeatures, state::AppState};

pub mod dictionary;
pub mod http;
pub mod ws;

#[derive(Clone, Copy)]
enum LanguageBackend {
    CzechDictionary,
}

#[derive(Clone, Copy)]
struct LanguageAppSpec {
    id: &'static str,
    route_prefix: &'static str,
    static_dir: &'static str,
    entry_file: &'static str,
    backend: LanguageBackend,
}

const ACTIVE_LANGUAGE_APPS: &[LanguageAppSpec] = &[LanguageAppSpec {
    id: "cz",
    route_prefix: "/cz",
    static_dir: "apps/caatuu-czech/static",
    entry_file: "home.html",
    backend: LanguageBackend::CzechDictionary,
}];

/// Build the unified Caatuu runtime:
/// - `/` serves the Caatuu landing page.
/// - `/demos/` serves isolated development projects outside production assets.
/// - `/archive/chinese/` preserves the older Chinese trainer outside active apps.
/// - active language apps are mounted from `ACTIVE_LANGUAGE_APPS`.
pub fn build_router(state: Arc<AppState>, features: RuntimeFeatures) -> Router {
    let workspace = workspace_root();
    let unified_static = workspace.join("apps/caatuu-unified/static");
    let demos = workspace.join("demos");
    let chinese_static = workspace.join("archive/caatuu-chinese/static");
    let android_apk = workspace.join("artifacts/android/caatuu.apk");
    let android_manifest = workspace.join("artifacts/android/caatuu.json");

    let chinese_static_service = ServeDir::new(chinese_static.clone())
        .append_index_html_on_directories(true)
        .not_found_service(ServeFile::new(chinese_static.join("index.html")));
    let chinese_app = Router::new()
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
        );
    let chinese_app = if features.archived_chinese_api {
        chinese_app
            .route("/ws", get(ws::ws_upgrade))
            .nest("/api/v1", api_router())
    } else {
        chinese_app
            .route("/ws", get(archived_chinese_api_unavailable))
            .nest("/api/v1", disabled_archive_api_router())
    }
    .fallback_service(chinese_static_service);

    let router = Router::new()
        .route_service("/", ServeFile::new(unified_static.join("index.html")))
        .route_service("/app.css", ServeFile::new(unified_static.join("app.css")))
        .route_service(
            "/launcher.js",
            ServeFile::new(unified_static.join("launcher.js")),
        )
        .route_service(
            "/languages.json",
            ServeFile::new(unified_static.join("languages.json")),
        )
        .route("/ws", get(retired_root_chinese_backend))
        .merge(bug_report_router(features.bug_reports))
        .nest("/api/v1", retired_root_api_router())
        .nest_service(
            "/demos",
            ServeDir::new(demos).append_index_html_on_directories(true),
        )
        .nest_service("/assets", ServeDir::new(unified_static.join("assets")))
        .route(
            "/android/releases/status",
            get(|| async { StatusCode::NO_CONTENT }),
        )
        .nest_service(
            "/android/releases",
            ServeDir::new(workspace.join("artifacts/android/releases")),
        )
        .route_service("/android/caatuu.apk", ServeFile::new(android_apk.clone()))
        .route_service(
            "/android/caatuu.json",
            ServeFile::new(android_manifest.clone()),
        )
        .merge(android_debug_router(
            &workspace,
            features.android_debug_downloads,
        ))
        .route(
            "/zh",
            get(|| async { Redirect::permanent("/archive/chinese/") }),
        )
        .route(
            "/zh/",
            get(|| async { Redirect::permanent("/archive/chinese/") }),
        )
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
        );

    let router = ACTIVE_LANGUAGE_APPS.iter().fold(router, |router, spec| {
        let entry_route = format!("{}/", spec.route_prefix);
        let entry_file = workspace.join(spec.static_dir).join(spec.entry_file);
        router
            .route_service(&entry_route, ServeFile::new(entry_file))
            .nest(spec.route_prefix, build_language_app(&workspace, *spec))
    });

    router
        .with_state(state)
        .fallback(not_found_page)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_request(DefaultOnRequest::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-content-type-options"),
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("referrer-policy"),
            HeaderValue::from_static("no-referrer"),
        ))
}

fn build_language_app(workspace: &std::path::Path, spec: LanguageAppSpec) -> Router<Arc<AppState>> {
    let static_dir = workspace.join(spec.static_dir);
    let static_service = ServeDir::new(static_dir.clone()).append_index_html_on_directories(true);
    let router = Router::new().route_service("/", ServeFile::new(static_dir.join(spec.entry_file)));

    let router = match spec.backend {
        LanguageBackend::CzechDictionary => router
            .route("/api/dictionary/status", get(dictionary::status))
            .route("/api/dictionary/search", get(dictionary::search))
            .route(
                "/data/models/phone-bench/caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf",
                get(|| async { StatusCode::NOT_FOUND }),
            )
            .route(
                "/data/models/phone-bench/caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf.sha256",
                get(|| async { StatusCode::NOT_FOUND }),
            )
            .route(
                "/data/models/phone-bench/qwen3-lora-003-hard.manifest.json",
                get(|| async { StatusCode::NOT_FOUND }),
            )
            .route(
                "/data/models/phone-bench/caatuu-czech-cstinyllama-1.2b-planet-wordnet-002-copy-q4_k_m.gguf",
                get(|| async { StatusCode::NOT_FOUND }),
            )
            .route(
                "/data/models/phone-bench/caatuu-czech-cstinyllama-1.2b-planet-wordnet-002-copy-q4_k_m.gguf.sha256",
                get(|| async { StatusCode::NOT_FOUND }),
            )
            .route(
                "/data/models/phone-bench/cstinyllama-1.2b-planet-wordnet-002-copy.manifest.json",
                get(|| async { StatusCode::NOT_FOUND }),
            )
            .route(
                "/data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard",
                get(|| async { StatusCode::NOT_FOUND }),
            )
            .route(
                "/data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard/*path",
                get(|| async { StatusCode::NOT_FOUND }),
            ),
    };

    tracing::debug!(
        language = spec.id,
        route = spec.route_prefix,
        "mounted language app"
    );
    router.fallback_service(static_service)
}

fn android_debug_router(
    workspace: &std::path::Path,
    debug_downloads_enabled: bool,
) -> Router<Arc<AppState>> {
    if !debug_downloads_enabled {
        return Router::new();
    }

    Router::new()
        .route(
            "/android/debug-releases/status",
            get(|| async { StatusCode::NO_CONTENT }),
        )
        .nest_service(
            "/android/debug-releases",
            ServeDir::new(workspace.join("artifacts/android/debug-releases")),
        )
        .route_service(
            "/android/caatuu-debug.apk",
            ServeFile::new(workspace.join("artifacts/android/caatuu-debug.apk")),
        )
        .route_service(
            "/android/caatuu-debug.json",
            ServeFile::new(workspace.join("artifacts/android/caatuu-debug.json")),
        )
        .route_service(
            "/android/termux-install-debug.sh",
            ServeFile::new(workspace.join("tools/android-build/termux-install-debug.sh")),
        )
}

fn bug_report_router(enabled: bool) -> Router<Arc<AppState>> {
    if enabled {
        return Router::new().route(
            "/api/bug-report",
            post(http::http_post_bug_report).layer(DefaultBodyLimit::max(16 * 1024)),
        );
    }

    Router::new().route("/api/bug-report", post(bug_reports_unavailable))
}

async fn bug_reports_unavailable() -> (StatusCode, &'static str) {
    (
        StatusCode::NOT_FOUND,
        "Remote diagnostic reporting is disabled on this server.",
    )
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

fn disabled_archive_api_router() -> Router<Arc<AppState>> {
    Router::new().fallback(archived_chinese_api_unavailable)
}

async fn archived_chinese_api_unavailable() -> (StatusCode, &'static str) {
    (
        StatusCode::NOT_FOUND,
        "Archived Chinese API is disabled on this server.",
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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    fn disabled_router() -> Router {
        let features = RuntimeFeatures::default();
        let state = Arc::new(AppState::new(features).expect("test state should initialize"));
        build_router(state, features)
    }

    fn reporting_router() -> Router {
        let features = RuntimeFeatures {
            bug_reports: true,
            ..RuntimeFeatures::default()
        };
        let state = Arc::new(AppState::new(features).expect("test state should initialize"));
        build_router(state, features)
    }

    #[tokio::test]
    async fn archived_and_debug_endpoints_are_fail_closed_by_default() {
        let app = disabled_router();
        for path in [
            "/archive/chinese/api/v1/health",
            "/archive/chinese/ws",
            "/android/caatuu-debug.json",
            "/android/caatuu-debug.apk",
            "/android/debug-releases/status",
            "/android/debug-releases/1/caatuu-debug.apk",
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        }
    }

    #[tokio::test]
    async fn bug_reports_are_fail_closed_by_default() {
        let response = disabled_router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/bug-report")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"message":"private"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn runtime_does_not_emit_permissive_cors_headers() {
        let response = reporting_router()
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/api/bug-report")
                    .header("origin", "https://untrusted.example")
                    .header("access-control-request-method", "POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert!(response
            .headers()
            .get("access-control-allow-origin")
            .is_none());
    }

    #[tokio::test]
    async fn runtime_emits_security_headers_on_routes_and_fallbacks() {
        let app = disabled_router();
        for path in ["/api/v1/retired", "/definitely-not-a-route"] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();

            assert_eq!(
                response.headers().get("x-content-type-options").unwrap(),
                "nosniff",
                "{path}",
            );
            assert_eq!(
                response.headers().get("referrer-policy").unwrap(),
                "no-referrer",
                "{path}",
            );
        }
    }

    #[tokio::test]
    async fn active_language_registry_mounts_its_entry_page() {
        let app = disabled_router();
        for spec in ACTIVE_LANGUAGE_APPS {
            let path = format!("{}/", spec.route_prefix);
            let response = app
                .clone()
                .oneshot(Request::builder().uri(&path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{} at {path}", spec.id);
        }
    }

    #[tokio::test]
    async fn legacy_models_under_rights_review_are_not_distributed() {
        let app = disabled_router();
        for path in [
            "/cz/data/models/phone-bench/caatuu-czech-qwen3-1.7b-003-hard-q4_k_m.gguf",
            "/cz/data/models/phone-bench/qwen3-lora-003-hard.manifest.json",
            "/cz/data/models/phone-bench/caatuu-czech-cstinyllama-1.2b-planet-wordnet-002-copy-q4_k_m.gguf",
            "/cz/data/models/phone-bench/cstinyllama-1.2b-planet-wordnet-002-copy.manifest.json",
            "/cz/data/models/czech-finetuned/exports/qwen3-1.7b-lora-003-hard/export-manifest.json",
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        }
    }

    #[tokio::test]
    async fn bug_report_route_rejects_oversized_bodies() {
        let body = format!(r#"{{"message":"{}"}}"#, "x".repeat(MAX_REPORT_TEST_BYTES));
        let response = reporting_router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/bug-report")
                    .header("content-type", "application/json")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    const MAX_REPORT_TEST_BYTES: usize = 17 * 1024;
}
