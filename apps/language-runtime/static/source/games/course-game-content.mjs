const CONTENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const COURSE_ROUTE_PATTERN = /^\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function gameContentError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeId(value, label) {
  const id = String(value || "").trim();
  if (!CONTENT_ID_PATTERN.test(id)) {
    throw gameContentError(
      "COURSE_GAME_CONTENT_ID_INVALID",
      `${label} must be a lowercase, hyphen-separated identifier.`
    );
  }
  return id;
}

/**
 * Read the immutable course authority owned by the shared application shell.
 * A game may also be opened in a course document directly, which keeps tests
 * and future in-place hosts possible without weakening the origin boundary.
 */
export function readEmbeddedCourseProfile(scope = globalThis) {
  const runtimeHref = String(scope?.location?.href || "");
  if (!runtimeHref) {
    throw gameContentError(
      "COURSE_GAME_CONTENT_RUNTIME_REQUIRED",
      "The game runtime needs a document URL."
    );
  }
  const ownOrigin = new URL(runtimeHref).origin;
  let authority = scope;
  if (scope.parent && scope.parent !== scope) {
    try {
      if (scope.parent.location.origin !== ownOrigin) {
        throw gameContentError(
          "COURSE_GAME_CONTENT_PARENT_ORIGIN_INVALID",
          "The game can read course authority only from its same-origin application shell."
        );
      }
      authority = scope.parent;
    } catch (error) {
      if (error?.code === "COURSE_GAME_CONTENT_PARENT_ORIGIN_INVALID") throw error;
      throw gameContentError(
        "COURSE_GAME_CONTENT_PARENT_ORIGIN_INVALID",
        "The game cannot read course authority from a cross-origin parent."
      );
    }
  }
  const course = authority.CaatuuCourse;
  if (!isRecord(course)) {
    throw gameContentError(
      "COURSE_GAME_CONTENT_COURSE_REQUIRED",
      "The application shell did not provide a course profile."
    );
  }
  safeId(course.id, "course.id");
  const routePrefix = String(course.routePrefix || "").trim();
  if (!COURSE_ROUTE_PATTERN.test(routePrefix)) {
    throw gameContentError(
      "COURSE_GAME_CONTENT_ROUTE_INVALID",
      "The course route prefix is not a confined language route."
    );
  }
  return course;
}

export function declaredCourseGameResource(course, gameId, resourceName) {
  if (!isRecord(course)) {
    throw gameContentError(
      "COURSE_GAME_CONTENT_COURSE_REQUIRED",
      "A course profile is required to resolve game content."
    );
  }
  const normalizedGameId = safeId(gameId, "gameId");
  const normalizedResourceName = String(resourceName || "").trim();
  if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(normalizedResourceName)) {
    throw gameContentError(
      "COURSE_GAME_CONTENT_RESOURCE_NAME_INVALID",
      "resourceName must be a declared camel-case course resource name."
    );
  }
  const declaration = course.gameContent?.[normalizedGameId]?.[normalizedResourceName];
  if (typeof declaration !== "string" || !declaration.trim()) {
    throw gameContentError(
      "COURSE_GAME_CONTENT_RESOURCE_REQUIRED",
      `The course does not declare ${normalizedGameId}.${normalizedResourceName}.`
    );
  }
  return declaration.trim();
}

/**
 * Resolve one generator-projected game resource. The declaration must be a
 * relative course-static JSON path and may never escape its own game folder.
 */
export function resolveDeclaredCourseGameResourceUrl(course, {
  gameId,
  resourceName,
  runtimeHref = globalThis.location?.href
} = {}) {
  const normalizedGameId = safeId(gameId, "gameId");
  const routePrefix = String(course?.routePrefix || "").trim();
  if (!COURSE_ROUTE_PATTERN.test(routePrefix)) {
    throw gameContentError(
      "COURSE_GAME_CONTENT_ROUTE_INVALID",
      "The course route prefix is not a confined language route."
    );
  }
  const resourcePath = declaredCourseGameResource(
    course,
    normalizedGameId,
    resourceName
  );
  const queryIndex = resourcePath.indexOf("?");
  const pathPart = queryIndex >= 0 ? resourcePath.slice(0, queryIndex) : resourcePath;
  const queryPart = queryIndex >= 0 ? resourcePath.slice(queryIndex + 1) : "";
  const pathSegments = pathPart.split("/");
  if (
    resourcePath.startsWith("/")
    || resourcePath.includes("\\")
    || resourcePath.includes("#")
    || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(resourcePath)
    || !/^[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/u.test(pathPart)
    || pathSegments.some((segment) => !segment || segment === "." || segment === "..")
    || (queryIndex >= 0 && (
      !queryPart
      || resourcePath.indexOf("?", queryIndex + 1) >= 0
      || !/^[A-Za-z0-9._~=&%-]+$/u.test(queryPart)
      || /%(?:2f|5c|00)/iu.test(queryPart)
    ))
  ) {
    throw gameContentError(
      "COURSE_GAME_CONTENT_RESOURCE_UNSAFE",
      "A game content resource must be a relative course-static path."
    );
  }

  const runtimeUrl = new URL(runtimeHref);
  const courseBase = new URL(`${routePrefix.replace(/\/$/u, "")}/`, runtimeUrl.origin);
  const gameDirectory = new URL(`data/games/${normalizedGameId}/`, courseBase);
  const resourceUrl = new URL(resourcePath, courseBase);
  if (
    resourceUrl.origin !== runtimeUrl.origin
    || !resourceUrl.pathname.startsWith(gameDirectory.pathname)
    || !resourceUrl.pathname.endsWith(".json")
    || resourceUrl.username
    || resourceUrl.password
  ) {
    throw gameContentError(
      "COURSE_GAME_CONTENT_RESOURCE_UNSAFE",
      `The declared ${normalizedGameId} resource must remain inside ${gameDirectory.pathname}.`
    );
  }
  return resourceUrl.href;
}

export async function fetchDeclaredCourseGameJson(course, {
  gameId,
  resourceName,
  runtimeHref = globalThis.location?.href,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw gameContentError(
      "COURSE_GAME_CONTENT_FETCH_UNAVAILABLE",
      "The game runtime cannot fetch its declared content."
    );
  }
  const url = resolveDeclaredCourseGameResourceUrl(course, {
    gameId,
    resourceName,
    runtimeHref
  });
  const response = await fetchImpl(url, {
    cache: "reload",
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });
  if (!response?.ok) {
    throw gameContentError(
      "COURSE_GAME_CONTENT_FETCH_FAILED",
      `Could not load the declared ${gameId} content (${response?.status || "network error"}).`
    );
  }
  return Object.freeze({
    url,
    document: await response.json()
  });
}
