//! Router assembly: HTTP endpoints, WebSocket upgrade, static files, and HTTP tracing.

use std::{path::PathBuf, sync::Arc};

use axum::{
    extract::{DefaultBodyLimit, OriginalUri},
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

use crate::{
    config::RuntimeFeatures,
    language_catalog::{load_mounted_language_apps, LanguageAppSpec, LanguageBackend},
    state::AppState,
};

pub mod dictionary;
pub mod dictionary_gaps;
pub mod http;
pub mod ws;

#[derive(Clone, Copy)]
struct WebGameSpec {
    id: &'static str,
    route_prefix: &'static str,
    artifact_dir: &'static str,
}

const ACTIVE_WEB_GAMES: &[WebGameSpec] = &[WebGameSpec {
    id: "caatuu-game",
    route_prefix: "/caatuu-game/godot-v1",
    artifact_dir: "artifacts/games/caatuu-game/web/godot-v1",
}];
const ANDROID_IMMUTABLE_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";
const ANDROID_MUTABLE_CACHE_CONTROL: &str = "no-store, no-cache, must-revalidate, max-age=0";

/// Build the Caatuu runtime:
/// - `/` serves the Caatuu landing page.
/// - `/games/` serves language-independent generated game artifacts.
/// - `/zh` serves the canonical Mandarin course from the shared application.
/// - `/zh-hans` remains a redirect-only compatibility alias.
/// - archived application sources remain repository-only and are never routed.
/// - browser-enabled language apps are mounted from the authoritative course catalog.
pub fn build_router(state: Arc<AppState>, features: RuntimeFeatures) -> Router {
    let workspace = workspace_root();
    let mounted_language_apps = load_mounted_language_apps(&workspace)
        .unwrap_or_else(|error| panic!("invalid language catalog: {error}"));
    let launcher_static = workspace.join("apps/launcher/static");
    let language_runtime_root = workspace.join("apps/language-runtime");
    let shared_transformers_runtime = language_runtime_root.join("vendor/transformers");
    let shared_minilm_runtime =
        language_runtime_root.join("models/all-minilm-l6-v2-qint8-v0.1/runtime");
    let shared_assets = launcher_static.join("assets");
    let android_apk = workspace.join("artifacts/android/caatuu.apk");
    let android_manifest = workspace.join("artifacts/android/caatuu.json");

    let launcher = Router::new()
        .route_service("/", ServeFile::new(launcher_static.join("index.html")))
        .route_service("/app.css", ServeFile::new(launcher_static.join("app.css")))
        .route_service(
            "/launcher.js",
            ServeFile::new(launcher_static.join("launcher.js")),
        )
        .route_service(
            "/languages.json",
            ServeFile::new(launcher_static.join("languages.json")),
        )
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cache-control"),
            HeaderValue::from_static("no-store, max-age=0"),
        ));
    let shared_language_runtime = Router::new()
        .route_service(
            "/contract.mjs",
            ServeFile::new(language_runtime_root.join("contract.mjs")),
        )
        .route_service(
            "/embedding-runtimes.json",
            ServeFile::new(language_runtime_root.join("embedding-runtimes.json")),
        )
        .nest_service(
            "/static",
            ServeDir::new(language_runtime_root.join("static")),
        )
        .route_service(
            "/vendor/transformers/transformers.min.js",
            ServeFile::new(shared_transformers_runtime.join("transformers.min.js")),
        )
        .route_service(
            "/vendor/transformers/LICENSE",
            ServeFile::new(shared_transformers_runtime.join("LICENSE")),
        )
        .nest_service(
            "/models/all-minilm-l6-v2-qint8-v0.1/runtime",
            ServeDir::new(shared_minilm_runtime),
        )
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cache-control"),
            HeaderValue::from_static("no-cache, max-age=0"),
        ));
    let stable_android_releases = Router::new()
        .nest_service(
            "/android/releases",
            ServeDir::new(workspace.join("artifacts/android/releases")),
        )
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cache-control"),
            HeaderValue::from_static(ANDROID_IMMUTABLE_CACHE_CONTROL),
        ));
    let stable_android_mutable = Router::new()
        .route(
            "/android/releases/status",
            get(|| async { StatusCode::NO_CONTENT }),
        )
        .route_service("/android/caatuu.apk", ServeFile::new(android_apk.clone()))
        .route_service(
            "/android/caatuu.json",
            ServeFile::new(android_manifest.clone()),
        )
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cache-control"),
            HeaderValue::from_static(ANDROID_MUTABLE_CACHE_CONTROL),
        ));

    let router = Router::new()
        .merge(launcher)
        .nest("/language-runtime", shared_language_runtime)
        .route("/ws", get(retired_root_chinese_backend))
        .merge(bug_report_router(features.bug_reports))
        .nest("/api/v1", retired_root_api_router())
        // These three URL names predate the repository naming cleanup. Keep
        // them stable for installed clients while the source folders use
        // descriptive, kebab-case names.
        .nest_service(
            "/assets/aliens",
            ServeDir::new(shared_assets.join("language-mascots")),
        )
        .nest_service(
            "/assets/loading_animation",
            ServeDir::new(shared_assets.join("loading-animation")),
        )
        .nest_service(
            "/assets/miscellaneous",
            ServeDir::new(shared_assets.join("visual-vocabulary")),
        )
        .nest_service("/assets", ServeDir::new(shared_assets))
        .merge(stable_android_releases)
        .merge(stable_android_mutable)
        .merge(android_debug_router(
            &workspace,
            features.android_debug_downloads,
        ))
        .route("/zh-hans", get(redirect_legacy_mandarin_route))
        .route("/zh-hans/", get(redirect_legacy_mandarin_route))
        .route("/zh-hans/*path", get(redirect_legacy_mandarin_route));

    let router = if features.caatuu_game_preview {
        router.nest("/games", build_web_games(&workspace))
    } else {
        router
    };

    let router = mounted_language_apps.iter().fold(router, |router, spec| {
        let entry_route = format!("{}/", spec.route_prefix);
        let index_route = format!("{}/index.html", spec.route_prefix);
        let language_router = Router::new()
            .route_service(&entry_route, ServeFile::new(spec.app_entry.clone()))
            .route_service(&index_route, ServeFile::new(spec.app_entry.clone()))
            .nest(&spec.route_prefix, build_language_app(spec));
        let language_router = if spec.status == "development" {
            language_router.layer(SetResponseHeaderLayer::overriding(
                HeaderName::from_static("x-robots-tag"),
                HeaderValue::from_static("noindex, nofollow"),
            ))
        } else {
            language_router
        };
        router.merge(language_router)
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

async fn redirect_legacy_mandarin_route(OriginalUri(uri): OriginalUri) -> Redirect {
    let suffix = uri.path().strip_prefix("/zh-hans").unwrap_or_default();
    let mut target = if suffix.is_empty() || suffix == "/" {
        "/zh/".to_string()
    } else {
        format!("/zh{suffix}")
    };
    if let Some(query) = uri.query() {
        target.push('?');
        target.push_str(query);
    }
    Redirect::permanent(&target)
}

fn build_language_app(spec: &LanguageAppSpec) -> Router<Arc<AppState>> {
    let static_dir = spec.static_dir.clone();
    let static_service = ServeDir::new(static_dir.clone()).append_index_html_on_directories(true);
    let router = Router::new();

    let router = match spec.backend {
        LanguageBackend::Static => router,
        LanguageBackend::CzechDictionary => router
            .route("/api/dictionary/status", get(dictionary::status))
            .route("/api/dictionary/search", get(dictionary::search))
            .route(
                "/api/dictionary/gaps",
                post(dictionary_gaps::submit).layer(DefaultBodyLimit::max(2 * 1024)),
            )
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

fn build_web_games(workspace: &std::path::Path) -> Router<Arc<AppState>> {
    ACTIVE_WEB_GAMES
        .iter()
        .fold(
            Router::new()
                .route(
                    "/caatuu-game",
                    get(|| async { Redirect::temporary("/games/caatuu-game/godot-v1/") }),
                )
                .route(
                    "/caatuu-game/",
                    get(|| async { Redirect::temporary("/games/caatuu-game/godot-v1/") }),
                ),
            |router, spec| {
                tracing::debug!(
                    game = spec.id,
                    route = spec.route_prefix,
                    artifact = spec.artifact_dir,
                    "mounted generated Web game",
                );
                router.nest_service(
                    spec.route_prefix,
                    ServeDir::new(workspace.join(spec.artifact_dir))
                        .append_index_html_on_directories(true),
                )
            },
        )
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cache-control"),
            HeaderValue::from_static("no-cache, max-age=0"),
        ))
}

fn android_debug_router(
    workspace: &std::path::Path,
    debug_downloads_enabled: bool,
) -> Router<Arc<AppState>> {
    if !debug_downloads_enabled {
        return Router::new();
    }

    let immutable_releases = Router::new()
        .nest_service(
            "/android/debug-releases",
            ServeDir::new(workspace.join("artifacts/android/debug-releases")),
        )
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cache-control"),
            HeaderValue::from_static(ANDROID_IMMUTABLE_CACHE_CONTROL),
        ));
    let mutable_downloads = Router::new()
        .route(
            "/android/debug-releases/status",
            get(|| async { StatusCode::NO_CONTENT }),
        )
        .route_service(
            "/android/caatuu-debug.apk",
            ServeFile::new(workspace.join("artifacts/android/caatuu-debug.apk")),
        )
        .route_service(
            "/android/caatuu-debug.json",
            ServeFile::new(workspace.join("artifacts/android/caatuu-debug.json")),
        )
        // User-facing aliases for the gated development channel. Installed
        // debug-lineage clients keep using the legacy names above, while the
        // public launcher can describe the same bytes honestly as a preview.
        .route_service(
            "/android/caatuu-preview.apk",
            ServeFile::new(workspace.join("artifacts/android/caatuu-debug.apk")),
        )
        .route_service(
            "/android/caatuu-preview.json",
            ServeFile::new(workspace.join("artifacts/android/caatuu-debug.json")),
        )
        .route_service(
            "/android/termux-install-debug.sh",
            ServeFile::new(workspace.join("apps/android/tooling/termux-install-debug.sh")),
        )
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cache-control"),
            HeaderValue::from_static(ANDROID_MUTABLE_CACHE_CONTROL),
        ));

    immutable_releases.merge(mutable_downloads)
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
    let path = workspace_root().join("apps/launcher/static/not-found.html");
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
        "The retired Chinese trainer backend is unavailable.",
    )
}

fn workspace_root() -> PathBuf {
    std::env::var_os("CAATUU_WORKSPACE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            manifest_dir
                .parent()
                .and_then(|apps| apps.parent())
                .map(PathBuf::from)
                .unwrap_or(manifest_dir)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::language_catalog::CANONICAL_BROWSER_APP_ENTRY_PATH;
    use axum::{
        body::{to_bytes, Body},
        http::Request,
    };
    use tower::ServiceExt;

    fn disabled_router() -> Router {
        let features = RuntimeFeatures::default();
        let state = Arc::new(AppState::new().expect("test state should initialize"));
        build_router(state, features)
    }

    fn reporting_router() -> Router {
        let features = RuntimeFeatures {
            bug_reports: true,
            ..RuntimeFeatures::default()
        };
        let state = Arc::new(AppState::new().expect("test state should initialize"));
        build_router(state, features)
    }

    fn game_preview_router() -> Router {
        let features = RuntimeFeatures {
            caatuu_game_preview: true,
            ..RuntimeFeatures::default()
        };
        let state = Arc::new(AppState::new().expect("test state should initialize"));
        build_router(state, features)
    }

    #[tokio::test]
    async fn deprecated_chinese_ui_and_debug_endpoints_are_fail_closed_by_default() {
        let app = disabled_router();
        for path in [
            "/archive/chinese",
            "/archive/chinese/",
            "/archive/chinese/index.html",
            "/archive/chinese/app.css",
            "/archive/chinese/assets/nested/dead.js",
            "/archive/chinese/challenge",
            "/archive/chinese/api/v1/health",
            "/archive/chinese/ws",
            "/zh/challenge",
            "/zh/challenge/",
            "/zh/secuence",
            "/zh/secuence/",
            "/zh/writing",
            "/zh/writing/",
            "/challenge",
            "/challenge/",
            "/secuence",
            "/secuence/",
            "/writing",
            "/writing/",
            "/android/caatuu-debug.json",
            "/android/caatuu-debug.apk",
            "/android/caatuu-preview.json",
            "/android/caatuu-preview.apk",
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
    async fn legacy_zh_hans_aliases_redirect_only_to_the_canonical_mandarin_course() {
        let app = disabled_router();
        for (path, location) in [
            ("/zh-hans", "/zh/"),
            ("/zh-hans/", "/zh/"),
            (
                "/zh-hans/index.html?game=word-net",
                "/zh/index.html?game=word-net",
            ),
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();

            assert_eq!(response.status(), StatusCode::PERMANENT_REDIRECT, "{path}");
            assert_eq!(
                response
                    .headers()
                    .get(axum::http::header::LOCATION)
                    .unwrap(),
                location,
                "{path}",
            );
        }
    }

    #[tokio::test]
    async fn canonical_mandarin_route_serves_the_shared_application() {
        let app = disabled_router();
        for path in ["/zh/", "/zh/index.html"] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{path}");
        }
    }

    #[tokio::test]
    async fn standalone_game_preview_is_fail_closed_by_default() {
        for path in ["/games/caatuu-game/", "/games/caatuu-game/godot-v1/"] {
            let response = disabled_router()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        }
    }

    #[tokio::test]
    async fn standalone_game_preview_has_one_stable_entrypoint_when_enabled() {
        let response = game_preview_router()
            .oneshot(
                Request::builder()
                    .uri("/games/caatuu-game/")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(
            response
                .headers()
                .get(axum::http::header::LOCATION)
                .unwrap(),
            "/games/caatuu-game/godot-v1/",
        );
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
    async fn every_language_route_mounts_the_same_canonical_application_entry() {
        let app = disabled_router();
        let canonical = tokio::fs::read(workspace_root().join(CANONICAL_BROWSER_APP_ENTRY_PATH))
            .await
            .expect("canonical browser app entry should be readable");
        for spec in load_mounted_language_apps(&workspace_root())
            .expect("language catalog should load in tests")
        {
            for path in [
                format!("{}/", spec.route_prefix),
                format!("{}/index.html", spec.route_prefix),
            ] {
                let response = app
                    .clone()
                    .oneshot(Request::builder().uri(&path).body(Body::empty()).unwrap())
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::OK, "{} at {path}", spec.id);
                if spec.status == "development" {
                    assert_eq!(
                        response.headers().get("x-robots-tag").unwrap(),
                        "noindex, nofollow",
                        "{} at {path}",
                        spec.id,
                    );
                } else {
                    assert!(
                        response.headers().get("x-robots-tag").is_none(),
                        "{} at {path}",
                        spec.id,
                    );
                }
                let body = to_bytes(response.into_body(), canonical.len() + 1)
                    .await
                    .expect("language application response should be readable");
                assert_eq!(body.as_ref(), canonical.as_slice(), "{} at {path}", spec.id);
            }
        }
    }

    #[tokio::test]
    async fn shared_language_runtime_exposes_contract_but_not_repository_docs_or_tests() {
        let app = disabled_router();
        let contract = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/language-runtime/contract.mjs")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(contract.status(), StatusCode::OK);

        for path in [
            "/language-runtime/embedding-runtimes.json",
            "/language-runtime/vendor/transformers/transformers.min.js",
            "/language-runtime/vendor/transformers/LICENSE",
            "/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/config.json",
            "/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/LICENSE-APACHE-2.0.txt",
            "/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/THIRD_PARTY_NOTICES.json",
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{path}");
        }

        for path in [
            "/language-runtime/README.md",
            "/language-runtime/tests/adapter.test.mjs",
            "/language-runtime/vendor/transformers/README.md",
            "/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/caatuu-cz-curriculum.sqlite",
            "/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/manifest.json",
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

    #[tokio::test]
    async fn dictionary_gap_route_rejects_expansive_and_oversized_bodies() {
        let expansive = disabled_router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/cz/api/dictionary/gaps")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        r#"{"schema":"caatuu.dictionary-gap-report.v1","targetWord":"Řekněme","normalizedWord":"řekněme","dictionaryKey":"kaikki-cs-en-2026-07-09","dictionaryDirection":"cs-en","lookupOutcome":"no_results","lookupReturned":0,"sentence":"must stay local"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(expansive.status().is_client_error());

        let oversized_body = format!(
            r#"{{"schema":"caatuu.dictionary-gap-report.v1","targetWord":"{}"}}"#,
            "x".repeat(MAX_DICTIONARY_GAP_TEST_BYTES)
        );
        let oversized = disabled_router()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/cz/api/dictionary/gaps")
                    .header("content-type", "application/json")
                    .body(Body::from(oversized_body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(oversized.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    const MAX_REPORT_TEST_BYTES: usize = 17 * 1024;
    const MAX_DICTIONARY_GAP_TEST_BYTES: usize = 3 * 1024;
}
