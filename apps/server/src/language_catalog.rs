use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
};

use serde::Deserialize;

pub(crate) const CANONICAL_BROWSER_APP_ENTRY_PATH: &str =
    "apps/language-runtime/static/app/index.html";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum LanguageBackend {
    Static,
    DictionaryApiV1,
}

#[derive(Clone, Copy)]
struct DictionaryBackendRegistration {
    course_id: &'static str,
    provider_id: &'static str,
    backend: LanguageBackend,
}

// This registry binds a browser provider declaration to the server handler
// that actually serves it. Add a new exact course/provider tuple only when a
// matching server implementation exists; sharing a protocol name alone must
// never mount another language's dictionary.
const DICTIONARY_BACKEND_REGISTRY: &[DictionaryBackendRegistration] =
    &[DictionaryBackendRegistration {
        course_id: "cz",
        provider_id: "czech-full-dictionary-v1",
        backend: LanguageBackend::DictionaryApiV1,
    }];

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LanguageAppSpec {
    pub(crate) id: String,
    pub(crate) status: String,
    pub(crate) route_prefix: String,
    pub(crate) static_dir: PathBuf,
    pub(crate) app_entry: PathBuf,
    pub(crate) backend: LanguageBackend,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CourseCatalog {
    schema_version: u64,
    default_course_id: String,
    reserved_route_prefixes: Vec<String>,
    courses: Vec<CourseCatalogEntry>,
}

#[derive(Debug, Deserialize)]
struct CourseCatalogEntry {
    id: String,
    manifest: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CourseManifest {
    schema_version: u64,
    id: String,
    directory_name: String,
    status: String,
    route_prefix: String,
    entry_path: String,
    capabilities: CourseCapabilities,
    platforms: CoursePlatforms,
    resources: HashMap<String, CourseResource>,
}

#[derive(Debug, Deserialize)]
struct CourseCapabilities {
    dictionary: bool,
}

#[derive(Debug, Deserialize)]
struct CoursePlatforms {
    browser: BrowserPlatform,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserPlatform {
    enabled: bool,
    entry_path: String,
    backend: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CourseResource {
    kind: String,
    path: String,
    scope: String,
    state: String,
    provider_id: Option<String>,
    revision: Option<String>,
}

pub(crate) fn load_mounted_language_apps(workspace: &Path) -> Result<Vec<LanguageAppSpec>, String> {
    let workspace_root = workspace.canonicalize().map_err(|error| {
        format!(
            "could not resolve workspace {}: {error}",
            workspace.display()
        )
    })?;
    let expected_catalog_path = workspace_root.join("apps/languages/catalog.json");
    let catalog_path = expected_catalog_path.canonicalize().map_err(|error| {
        format!(
            "could not resolve language catalog {}: {error}",
            expected_catalog_path.display()
        )
    })?;
    if catalog_path != expected_catalog_path {
        return Err(
            "language catalog resolves outside its canonical workspace location".to_string(),
        );
    }
    let catalog: CourseCatalog = read_json(&catalog_path, "language catalog")?;
    if catalog.schema_version != 1 {
        return Err(format!(
            "{} uses unsupported schemaVersion {}",
            catalog_path.display(),
            catalog.schema_version
        ));
    }

    let catalog_ids: HashSet<&str> = catalog
        .courses
        .iter()
        .map(|entry| entry.id.as_str())
        .collect();
    if catalog_ids.len() != catalog.courses.len() {
        return Err(format!(
            "{} contains duplicate course IDs",
            catalog_path.display()
        ));
    }
    if !catalog_ids.contains(catalog.default_course_id.as_str()) {
        return Err(format!(
            "{} defaultCourseId {:?} does not name a catalog course",
            catalog_path.display(),
            catalog.default_course_id
        ));
    }
    for reserved in &catalog.reserved_route_prefixes {
        validate_route_prefix(reserved, "reserved route")?;
    }

    let mut route_prefixes = HashSet::new();
    let mut mounted = Vec::new();

    for entry in catalog.courses {
        let manifest_path = resolve_present_path(
            &workspace_root,
            &entry.manifest,
            "catalog manifest",
            ExpectedKind::File,
        )?;
        let manifest: CourseManifest = read_json(&manifest_path, "course manifest")?;
        if manifest.schema_version != 1 {
            return Err(format!(
                "{} uses unsupported schemaVersion {}",
                manifest_path.display(),
                manifest.schema_version
            ));
        }
        if entry.id != manifest.id {
            return Err(format!(
                "catalog course {:?} points to manifest for {:?}",
                entry.id, manifest.id
            ));
        }
        validate_course_id(&manifest.id, "id")?;
        validate_course_id(&manifest.directory_name, "directoryName")?;
        validate_course_status(&manifest.id, &manifest.status)?;
        let expected_manifest = format!("apps/languages/{}/course.json", manifest.directory_name);
        if entry.manifest != expected_manifest {
            return Err(format!(
                "catalog course {} manifest {:?} must be {:?}",
                manifest.id, entry.manifest, expected_manifest
            ));
        }
        let expected_course_root = workspace_root
            .join("apps/languages")
            .join(&manifest.directory_name);
        let course_root = expected_course_root.canonicalize().map_err(|error| {
            format!(
                "could not resolve course {} directory: {error}",
                manifest.id
            )
        })?;
        if course_root != expected_course_root
            || !course_root.starts_with(workspace_root.join("apps/languages"))
            || manifest_path != expected_course_root.join("course.json")
        {
            return Err(format!(
                "course {} manifest is outside its declaring course directory",
                manifest.id
            ));
        }
        validate_route_prefix(&manifest.route_prefix, &manifest.id)?;
        if catalog
            .reserved_route_prefixes
            .iter()
            .any(|reserved| routes_collide(&manifest.route_prefix, reserved))
        {
            return Err(format!(
                "course {} route {} overlaps a reserved server route",
                manifest.id, manifest.route_prefix
            ));
        }
        if !route_prefixes.insert(manifest.route_prefix.clone()) {
            return Err(format!(
                "course route {} is declared more than once",
                manifest.route_prefix
            ));
        }
        if manifest.platforms.browser.entry_path != manifest.entry_path {
            return Err(format!(
                "course {} browser entryPath does not match its top-level entryPath",
                manifest.id
            ));
        }
        validate_entry_path(&manifest.entry_path, &manifest.route_prefix, &manifest.id)?;
        if !manifest
            .entry_path
            .starts_with(&format!("{}/", manifest.route_prefix))
        {
            return Err(format!(
                "course {} entryPath {} is outside route {}",
                manifest.id, manifest.entry_path, manifest.route_prefix
            ));
        }

        if !manifest.platforms.browser.enabled {
            continue;
        }
        if manifest.status == "retired" {
            return Err(format!(
                "retired course {} cannot enable its browser platform",
                manifest.id
            ));
        }

        let static_resource = required_present_resource(&manifest, "staticRoot", "directory")?;
        let app_entry_resource = required_present_resource(&manifest, "appEntry", "file")?;
        validate_course_resource_declarations(&manifest, static_resource, app_entry_resource)?;
        let static_dir = resolve_present_path(
            &workspace_root,
            &static_resource.path,
            "course staticRoot",
            ExpectedKind::Directory,
        )?;
        let app_entry = resolve_present_path(
            &workspace_root,
            &app_entry_resource.path,
            "shared appEntry",
            ExpectedKind::File,
        )?;
        if static_dir != course_root.join("static") {
            return Err(format!(
                "course {} staticRoot resolves outside its course directory",
                manifest.id
            ));
        }
        if app_entry != workspace_root.join(CANONICAL_BROWSER_APP_ENTRY_PATH) {
            return Err(format!(
                "course {} appEntry resolves outside its canonical shared application path",
                manifest.id
            ));
        }
        let dictionary_provider = manifest.resources.get("dictionaryProvider");
        if manifest.platforms.browser.backend == "dictionary-api-v1" {
            let provider = required_present_resource(&manifest, "dictionaryProvider", "file")?;
            validate_dictionary_provider_declaration(&manifest, provider)?;
            let provider_path = resolve_present_path(
                &workspace_root,
                &provider.path,
                "course dictionaryProvider",
                ExpectedKind::File,
            )?;
            if provider_path != workspace_root.join(&provider.path)
                || !provider_path.starts_with(&static_dir)
            {
                return Err(format!(
                    "course {} dictionaryProvider resolves outside its canonical course static path",
                    manifest.id
                ));
            }
        }
        let backend = parse_backend(
            &manifest.platforms.browser.backend,
            manifest.capabilities.dictionary,
            dictionary_provider,
            &manifest.id,
        )?;
        mounted.push(LanguageAppSpec {
            id: manifest.id,
            status: manifest.status,
            route_prefix: manifest.route_prefix,
            static_dir,
            app_entry,
            backend,
        });
    }

    Ok(mounted)
}

fn required_present_resource<'a>(
    manifest: &'a CourseManifest,
    name: &str,
    expected_kind: &str,
) -> Result<&'a CourseResource, String> {
    let resource = manifest.resources.get(name).ok_or_else(|| {
        format!(
            "browser-enabled course {} has no {name} resource",
            manifest.id
        )
    })?;
    if resource.state != "present" {
        return Err(format!(
            "browser-enabled course {} resource {name} is not present",
            manifest.id
        ));
    }
    if resource.kind != expected_kind {
        return Err(format!(
            "course {} resource {name} must be a {expected_kind}",
            manifest.id
        ));
    }
    Ok(resource)
}

fn parse_backend(
    value: &str,
    dictionary_enabled: bool,
    dictionary_provider: Option<&CourseResource>,
    course_id: &str,
) -> Result<LanguageBackend, String> {
    match value {
        "static" if dictionary_enabled => Err(format!(
            "course {course_id} enables dictionary capability but selects the static backend"
        )),
        "static" if dictionary_provider.is_some() => Err(format!(
            "course {course_id} selects the static backend but declares a dictionaryProvider resource"
        )),
        "static" => Ok(LanguageBackend::Static),
        "dictionary-api-v1" if !dictionary_enabled => Err(format!(
            "course {course_id} selects dictionary-api-v1 but disables dictionary capability"
        )),
        "dictionary-api-v1" => {
            let provider_id = dictionary_provider
                .and_then(|provider| provider.provider_id.as_deref())
                .ok_or_else(|| {
                    format!(
                        "course {course_id} selects dictionary-api-v1 without a dictionary provider ID"
                    )
                })?;
            registered_dictionary_backend(course_id, provider_id).ok_or_else(|| {
                format!(
                    "course {course_id} selects dictionary-api-v1 with unsupported provider {provider_id:?}"
                )
            })
        }
        other => Err(format!(
            "course {course_id} selects unsupported browser backend {other:?}"
        )),
    }
}

fn registered_dictionary_backend(course_id: &str, provider_id: &str) -> Option<LanguageBackend> {
    DICTIONARY_BACKEND_REGISTRY
        .iter()
        .find(|registration| {
            registration.course_id == course_id && registration.provider_id == provider_id
        })
        .map(|registration| registration.backend)
}

fn validate_course_id(value: &str, label: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.split('-').all(|component| {
            !component.is_empty()
                && component
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        });
    if valid {
        Ok(())
    } else {
        Err(format!("invalid course {label} {value:?}"))
    }
}

fn validate_course_status(course_id: &str, status: &str) -> Result<(), String> {
    if matches!(status, "active" | "development" | "retired") {
        Ok(())
    } else {
        Err(format!(
            "course {course_id} has unsupported status {status:?}"
        ))
    }
}

fn validate_course_resource_declarations(
    manifest: &CourseManifest,
    static_resource: &CourseResource,
    app_entry_resource: &CourseResource,
) -> Result<(), String> {
    let expected_static_path = format!("apps/languages/{}/static", manifest.directory_name);
    if static_resource.scope != "course" || static_resource.path != expected_static_path {
        return Err(format!(
            "course {} staticRoot must be the course-scoped path {:?}",
            manifest.id, expected_static_path
        ));
    }
    if app_entry_resource.scope != "shared"
        || app_entry_resource.path != CANONICAL_BROWSER_APP_ENTRY_PATH
    {
        return Err(format!(
            "course {} appEntry must be the shared canonical path {:?}",
            manifest.id, CANONICAL_BROWSER_APP_ENTRY_PATH
        ));
    }
    Ok(())
}

fn validate_dictionary_provider_declaration(
    manifest: &CourseManifest,
    provider: &CourseResource,
) -> Result<(), String> {
    let expected_prefix = format!("apps/languages/{}/static/source/", manifest.directory_name);
    if provider.kind != "file"
        || provider.state != "present"
        || provider.scope != "course"
        || !provider.path.starts_with(&expected_prefix)
        || !provider.path.ends_with(".js")
        || provider
            .path
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(format!(
            "course {} dictionaryProvider must be a present course-scoped JavaScript file beneath {:?}",
            manifest.id, expected_prefix
        ));
    }
    if provider.revision.as_deref().map_or(true, str::is_empty) {
        return Err(format!(
            "course {} dictionaryProvider requires a cache revision",
            manifest.id
        ));
    }
    if provider.provider_id.as_deref().map_or(true, str::is_empty) {
        return Err(format!(
            "course {} dictionaryProvider requires a provider ID",
            manifest.id
        ));
    }
    Ok(())
}

fn validate_route_prefix(route: &str, course_id: &str) -> Result<(), String> {
    let valid = route.strip_prefix('/').is_some_and(|suffix| {
        !suffix.is_empty()
            && suffix.split('-').all(|component| {
                !component.is_empty()
                    && component
                        .bytes()
                        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
            })
    });
    if !valid {
        return Err(format!(
            "course {course_id} has invalid routePrefix {route:?}"
        ));
    }
    Ok(())
}

fn validate_entry_path(entry: &str, route: &str, course_id: &str) -> Result<(), String> {
    let expected_prefix = format!("{route}/");
    let suffix = entry.strip_prefix(&expected_prefix).ok_or_else(|| {
        format!("course {course_id} entryPath {entry:?} is outside route {route:?}")
    })?;
    let valid = !suffix.is_empty()
        && !suffix.contains('\\')
        && !suffix.contains('?')
        && !suffix.contains('#')
        && suffix
            .split('/')
            .all(|component| !component.is_empty() && component != "." && component != "..");
    if !valid {
        return Err(format!(
            "course {course_id} has invalid entryPath {entry:?}"
        ));
    }
    Ok(())
}

fn routes_collide(left: &str, right: &str) -> bool {
    left == right
        || left
            .strip_prefix(right)
            .is_some_and(|suffix| suffix.starts_with('/'))
        || right
            .strip_prefix(left)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

#[derive(Clone, Copy)]
enum ExpectedKind {
    File,
    Directory,
}

fn resolve_present_path(
    workspace_root: &Path,
    relative: &str,
    label: &str,
    expected_kind: ExpectedKind,
) -> Result<PathBuf, String> {
    if relative.contains('\\') {
        return Err(format!(
            "{label} path must use forward slashes: {relative:?}"
        ));
    }
    let candidate = Path::new(relative);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!(
            "{label} path must be repository-relative without traversal: {relative:?}"
        ));
    }
    let resolved = workspace_root
        .join(candidate)
        .canonicalize()
        .map_err(|error| {
            format!(
                "could not resolve present {label} {}: {error}",
                workspace_root.join(candidate).display()
            )
        })?;
    if !resolved.starts_with(workspace_root) {
        return Err(format!("{label} escapes the workspace: {relative:?}"));
    }
    let kind_matches = match expected_kind {
        ExpectedKind::File => resolved.is_file(),
        ExpectedKind::Directory => resolved.is_dir(),
    };
    if !kind_matches {
        let expected = match expected_kind {
            ExpectedKind::File => "file",
            ExpectedKind::Directory => "directory",
        };
        return Err(format!(
            "{label} is not a {expected}: {}",
            resolved.display()
        ));
    }
    Ok(resolved)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path, label: &str) -> Result<T, String> {
    let source = fs::read_to_string(path)
        .map_err(|error| format!("could not read {label} {}: {error}", path.display()))?;
    serde_json::from_str(&source)
        .map_err(|error| format!("could not parse {label} {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_manifest() -> CourseManifest {
        CourseManifest {
            schema_version: 1,
            id: "zh".to_string(),
            directory_name: "mandarin-simplified".to_string(),
            status: "development".to_string(),
            route_prefix: "/zh".to_string(),
            entry_path: "/zh/index.html".to_string(),
            capabilities: CourseCapabilities { dictionary: false },
            platforms: CoursePlatforms {
                browser: BrowserPlatform {
                    enabled: true,
                    entry_path: "/zh/index.html".to_string(),
                    backend: "static".to_string(),
                },
            },
            resources: HashMap::new(),
        }
    }

    fn fixture_resource(kind: &str, path: &str, scope: &str) -> CourseResource {
        CourseResource {
            kind: kind.to_string(),
            path: path.to_string(),
            scope: scope.to_string(),
            state: "present".to_string(),
            provider_id: None,
            revision: None,
        }
    }

    fn fixture_dictionary_provider(provider_id: Option<&str>) -> CourseResource {
        CourseResource {
            kind: "file".to_string(),
            path: "apps/languages/czech/static/source/features/dictionary/dictionary-full.js"
                .to_string(),
            scope: "course".to_string(),
            state: "present".to_string(),
            provider_id: provider_id.map(str::to_string),
            revision: Some("provider-1".to_string()),
        }
    }

    #[test]
    fn route_prefixes_are_narrow_and_stable() {
        for route in ["/cz", "/zh", "/zh-hans", "/pt-br2"] {
            validate_route_prefix(route, "fixture").expect(route);
        }
        for route in [
            "/",
            "cz",
            "/zh/",
            "/ZH",
            "/zh_hans",
            "/zh hans",
            "/-zh",
            "/zh-",
            "/zh--hans",
        ] {
            assert!(validate_route_prefix(route, "fixture").is_err(), "{route}");
        }
    }

    #[test]
    fn route_boundaries_distinguish_canonical_zh_from_its_zh_hans_alias() {
        assert!(!routes_collide("/zh-hans", "/zh"));
        assert!(routes_collide("/zh", "/zh"));
        assert!(routes_collide("/archive/chinese", "/archive"));
    }

    #[test]
    fn entry_paths_are_confined_to_their_course_route() {
        validate_entry_path("/zh/index.html", "/zh", "fixture").unwrap();
        for entry in [
            "/zh-hans/index.html",
            "/zh/../archive.html",
            "/zh/",
            "/zh/index.html?draft=1",
        ] {
            assert!(
                validate_entry_path(entry, "/zh", "fixture").is_err(),
                "{entry}"
            );
        }
    }

    #[test]
    fn backend_capability_contract_is_explicit() {
        assert_eq!(
            parse_backend("static", false, None, "fixture").unwrap(),
            LanguageBackend::Static
        );
        let czech_provider = fixture_dictionary_provider(Some("czech-full-dictionary-v1"));
        assert_eq!(
            parse_backend("dictionary-api-v1", true, Some(&czech_provider), "cz").unwrap(),
            LanguageBackend::DictionaryApiV1
        );
        assert!(parse_backend("dictionary-api-v1", false, None, "fixture").is_err());
        assert!(parse_backend("dictionary-api-v1", true, None, "fixture").is_err());
        assert!(
            parse_backend("dictionary-api-v1", true, Some(&czech_provider), "fixture").is_err()
        );
        let other_provider = fixture_dictionary_provider(Some("other-provider-v1"));
        assert!(parse_backend("dictionary-api-v1", true, Some(&other_provider), "cz").is_err());
        assert!(parse_backend("static", false, Some(&czech_provider), "fixture").is_err());
        assert!(parse_backend("static", true, Some(&czech_provider), "fixture").is_err());
        assert!(parse_backend("inferred", true, None, "fixture").is_err());
    }

    #[test]
    fn dictionary_backend_requires_an_exact_present_course_provider_declaration() {
        let manifest = fixture_manifest();
        let valid = CourseResource {
            kind: "file".to_string(),
            path: "apps/languages/mandarin-simplified/static/source/dictionary/provider.js"
                .to_string(),
            scope: "course".to_string(),
            state: "present".to_string(),
            provider_id: Some("fixture-provider-v1".to_string()),
            revision: Some("provider-1".to_string()),
        };
        validate_dictionary_provider_declaration(&manifest, &valid).unwrap();

        let mut invalid = Vec::new();
        let mut planned = valid.clone();
        planned.state = "planned".to_string();
        invalid.push(planned);
        let mut directory = valid.clone();
        directory.kind = "directory".to_string();
        invalid.push(directory);
        let mut shared = valid.clone();
        shared.scope = "shared".to_string();
        invalid.push(shared);
        let mut crossing = valid.clone();
        crossing.path = "apps/languages/czech/static/source/provider.js".to_string();
        invalid.push(crossing);
        let mut missing_revision = valid.clone();
        missing_revision.revision = None;
        invalid.push(missing_revision);
        let mut missing_id = valid;
        missing_id.provider_id = None;
        invalid.push(missing_id);

        for provider in invalid {
            assert!(validate_dictionary_provider_declaration(&manifest, &provider).is_err());
        }
    }

    #[test]
    fn course_status_values_are_fail_closed() {
        for status in ["active", "development", "retired"] {
            validate_course_status("fixture", status).expect(status);
        }
        for status in ["preview", "enabled", "", "Development"] {
            assert!(
                validate_course_status("fixture", status).is_err(),
                "{status}"
            );
        }
    }

    #[test]
    fn browser_resources_keep_course_content_separate_and_share_the_app_entry() {
        let manifest = fixture_manifest();
        let valid_static = fixture_resource(
            "directory",
            "apps/languages/mandarin-simplified/static",
            "course",
        );
        let valid_app_entry = fixture_resource("file", CANONICAL_BROWSER_APP_ENTRY_PATH, "shared");
        validate_course_resource_declarations(&manifest, &valid_static, &valid_app_entry).unwrap();

        for path in [
            "apps/languages/czech/static",
            "archive/caatuu-chinese/static",
            "apps/launcher/static",
        ] {
            let crossing = fixture_resource("directory", path, "course");
            assert!(
                validate_course_resource_declarations(&manifest, &crossing, &valid_app_entry)
                    .is_err(),
                "{path}"
            );
        }

        let shared = fixture_resource(
            "directory",
            "apps/languages/mandarin-simplified/static",
            "shared",
        );
        assert!(
            validate_course_resource_declarations(&manifest, &shared, &valid_app_entry).is_err()
        );

        let course_owned_app = fixture_resource("file", CANONICAL_BROWSER_APP_ENTRY_PATH, "course");
        assert!(
            validate_course_resource_declarations(&manifest, &valid_static, &course_owned_app)
                .is_err()
        );

        let alternate_shared_app = fixture_resource(
            "file",
            "apps/language-runtime/static/source/course-shell.mjs",
            "shared",
        );
        assert!(validate_course_resource_declarations(
            &manifest,
            &valid_static,
            &alternate_shared_app,
        )
        .is_err());
    }
}
