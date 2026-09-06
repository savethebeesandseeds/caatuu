//! Local, source-backed art studies. Mounted only by the game-preview gate.

use std::{path::Path, sync::Arc};

use axum::{
    extract::OriginalUri,
    http::{header::HeaderName, HeaderValue},
    response::Redirect,
    routing::get,
    Router,
};
use tower_http::{
    services::{ServeDir, ServeFile},
    set_header::SetResponseHeaderLayer,
};

use crate::state::AppState;

const MOTION_ROUTE: &str = "/games/lab/motion";
const LEGACY_MOTION_ROUTE: &str = "/caatuu-game/godot-v1/review/macaw-walk-v1";
const REVIEW_CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self'; style-src-elem 'self' 'unsafe-inline'; style-src-attr 'none'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

pub(super) fn build_router(workspace: &Path) -> Router<Arc<AppState>> {
    let lab = workspace.join("apps/games/lab");
    let motion = workspace.join("apps/games/caatuu-game/character-workshop");
    let hub_entry = lab.join("index.html");
    let motion_entry = motion.join("index.html");
    let scenary = lab.join("scenary");

    let router = Router::new()
        .route_service("/lab", ServeFile::new(hub_entry.clone()))
        .route_service("/lab/", ServeFile::new(hub_entry.clone()))
        .route_service("/lab/index.html", ServeFile::new(hub_entry))
        .nest_service("/lab/assets", ServeDir::new(lab.join("assets")))
        .route_service("/lab/motion", ServeFile::new(motion_entry.clone()))
        .route_service("/lab/motion/", ServeFile::new(motion_entry.clone()))
        .route_service("/lab/motion/index.html", ServeFile::new(motion_entry))
        .merge(motion_assets(&motion, "/lab/motion"))
        .route_service("/lab/scenary", ServeFile::new(scenary.join("index.html")))
        .route_service("/lab/scenary/", ServeFile::new(scenary.join("index.html")))
        .route_service(
            "/lab/scenary/index.html",
            ServeFile::new(scenary.join("index.html")),
        )
        .route_service(
            "/lab/scenary/scene.mjs",
            ServeFile::new(scenary.join("scene.mjs")),
        )
        .route_service(
            "/lab/scenary/navigation.mjs",
            ServeFile::new(scenary.join("navigation.mjs")),
        )
        .merge(motion_assets(&motion, LEGACY_MOTION_ROUTE));
    ["", "/", "/index.html"]
        .into_iter()
        .fold(router, |router, suffix| {
            router.route(
                &format!("{LEGACY_MOTION_ROUTE}{suffix}"),
                get(redirect_legacy_motion),
            )
        })
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("content-security-policy"),
            HeaderValue::from_static(REVIEW_CSP),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("x-robots-tag"),
            HeaderValue::from_static("noindex, nofollow"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            HeaderName::from_static("cache-control"),
            HeaderValue::from_static("no-store, max-age=0"),
        ))
}

fn motion_assets(source: &Path, prefix: &str) -> Router<Arc<AppState>> {
    [
        "review.css",
        "review.js",
        "animation-clock.mjs",
        "manifest.json",
    ]
    .into_iter()
    .fold(Router::new(), |router, name| {
        router.route_service(
            &format!("{prefix}/{name}"),
            ServeFile::new(source.join(name)),
        )
    })
    .nest_service(
        &format!("{prefix}/images"),
        ServeDir::new(source.join("images")),
    )
}

async fn redirect_legacy_motion(OriginalUri(uri): OriginalUri) -> Redirect {
    let target = match uri.query() {
        Some(query) => format!("{MOTION_ROUTE}?{query}"),
        None => MOTION_ROUTE.to_string(),
    };
    // No fragment in Location: browsers retain a fragment from the old URL.
    Redirect::temporary(&target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::{Request, StatusCode},
    };
    use std::{fs, path::PathBuf};
    use tower::ServiceExt;

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            let root =
                std::env::temp_dir().join(format!("caatuu-lab-routes-{}", uuid::Uuid::new_v4()));
            for (path, contents) in [
                ("apps/games/lab/index.html", "lab hub"),
                ("apps/games/lab/assets/lab.css", "lab style"),
                ("apps/games/lab/scenary/index.html", "scenary study"),
                ("apps/games/lab/scenary/scene.mjs", "scenary script"),
                (
                    "apps/games/lab/scenary/navigation.mjs",
                    "scenary navigation",
                ),
                (
                    "apps/games/caatuu-game/character-workshop/index.html",
                    "motion study",
                ),
                (
                    "apps/games/caatuu-game/character-workshop/review.js",
                    "motion script",
                ),
                (
                    "apps/games/caatuu-game/character-workshop/animation-clock.mjs",
                    "motion clock",
                ),
                (
                    "apps/games/caatuu-game/character-workshop/manifest.json",
                    "curated manifest",
                ),
                (
                    "apps/games/caatuu-game/character-workshop/images/s-run-01-sheet-v1.png",
                    "curated frame",
                ),
                (
                    "apps/games/caatuu-game/character-workshop/provenance.json",
                    "private provenance",
                ),
            ] {
                let target = root.join(path);
                fs::create_dir_all(target.parent().unwrap()).unwrap();
                fs::write(target, contents).unwrap();
            }
            Self(root)
        }

        fn router(&self) -> Router {
            let state = Arc::new(AppState::new().expect("test state should initialize"));
            Router::new()
                .nest("/games", build_router(&self.0))
                .with_state(state)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).expect("remove this test's temporary fixture");
        }
    }

    #[tokio::test]
    async fn lab_entrypoints_and_assets_serve_canonical_sources_with_review_headers() {
        let fixture = Fixture::new();
        let app = fixture.router();
        for (path, expected) in [
            ("/games/lab", "lab hub"),
            ("/games/lab/", "lab hub"),
            ("/games/lab/index.html", "lab hub"),
            ("/games/lab/assets/lab.css", "lab style"),
            ("/games/lab/motion", "motion study"),
            ("/games/lab/motion/", "motion study"),
            ("/games/lab/motion/index.html", "motion study"),
            ("/games/lab/motion/review.js", "motion script"),
            ("/games/lab/motion/animation-clock.mjs", "motion clock"),
            ("/games/lab/motion/manifest.json", "curated manifest"),
            (
                "/games/lab/motion/images/s-run-01-sheet-v1.png",
                "curated frame",
            ),
            ("/games/lab/scenary", "scenary study"),
            ("/games/lab/scenary/", "scenary study"),
            ("/games/lab/scenary/index.html", "scenary study"),
            ("/games/lab/scenary/scene.mjs", "scenary script"),
            ("/games/lab/scenary/navigation.mjs", "scenary navigation"),
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            assert_eq!(
                response.headers()["content-security-policy"],
                REVIEW_CSP,
                "{path}"
            );
            assert_eq!(
                response.headers()["x-robots-tag"],
                "noindex, nofollow",
                "{path}"
            );
            assert_eq!(
                response.headers()["cache-control"],
                "no-store, max-age=0",
                "{path}"
            );
            assert_eq!(
                to_bytes(response.into_body(), usize::MAX)
                    .await
                    .unwrap()
                    .as_ref(),
                expected.as_bytes(),
                "{path}"
            );
        }
    }

    #[tokio::test]
    async fn old_workshop_entries_redirect_but_assets_remain_compatible() {
        let fixture = Fixture::new();
        let app = fixture.router();
        for suffix in ["", "/", "/index.html"] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/games{LEGACY_MOTION_ROUTE}{suffix}?direction=NE"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
            assert_eq!(
                response.headers()["location"],
                "/games/lab/motion?direction=NE"
            );
        }
        for (suffix, expected) in [
            ("manifest.json", "curated manifest"),
            ("images/s-run-01-sheet-v1.png", "curated frame"),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/games{LEGACY_MOTION_ROUTE}/{suffix}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                to_bytes(response.into_body(), usize::MAX)
                    .await
                    .unwrap()
                    .as_ref(),
                expected.as_bytes()
            );
        }
    }

    #[tokio::test]
    async fn lab_routes_do_not_expose_provenance_or_escape_their_asset_roots() {
        let fixture = Fixture::new();
        let app = fixture.router();
        for path in [
            "/games/lab/motion/provenance.json",
            "/games/lab/motion/images/../provenance.json",
            "/games/lab/motion/images/%2e%2e/provenance.json",
            "/games/lab/scenary/../index.html",
            "/games/lab/scenary/%2e%2e/index.html",
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        }
    }
}
