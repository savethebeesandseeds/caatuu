const PROVIDER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9][0-9]*$/u;
const PROVIDER_MODULE_PATTERN =
  /^source\/[A-Za-z0-9._/-]+\.js\?v=[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const validatedProviders = new WeakSet();

export function declaredDictionaryProvider(course, { origin, routeBase }) {
  const providerModule = String(course?.dictionaryContent?.providerModule || "").trim();
  const providerId = String(course?.dictionaryContent?.providerId || "").trim();
  const resolved = providerModule ? new URL(providerModule, `${origin}${routeBase}`) : null;
  if (
    !PROVIDER_MODULE_PATTERN.test(providerModule)
    || providerModule.split("?", 1)[0].split("/").some(
      (segment) => !segment || segment === "." || segment === ".."
    )
    || resolved?.origin !== origin
    || !resolved.pathname.startsWith(routeBase)
  ) {
    throw new Error("Dictionary capability requires a confined, versioned dictionaryContent.providerModule.");
  }
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    throw new Error("Dictionary capability requires an exact versioned dictionaryContent.providerId.");
  }
  return Object.freeze({ providerId, providerModule });
}

export async function loadAndValidateDeclaredDictionaryProvider({
  course,
  globalScope = globalThis,
  loadScript,
  origin,
  routeBase
}) {
  if (typeof loadScript !== "function") {
    throw new TypeError("loadScript must load the declared course provider module.");
  }
  if (globalScope.CaatuuDictionaryProvider) {
    throw new Error("Dictionary provider registration must be empty before the course provider loads.");
  }
  const declared = declaredDictionaryProvider(course, { origin, routeBase });
  await loadScript(declared.providerModule);
  const provider = globalScope.CaatuuDictionaryProvider;
  if (
    !provider
    || provider.schemaVersion !== 1
    || provider.id !== declared.providerId
    || typeof provider.mountDictionaryProvider !== "function"
  ) {
    throw new Error(
      `The declared dictionary provider ${declared.providerId} did not register the exact v1 mount contract.`
    );
  }
  const validated = Object.freeze({ course, declared, globalScope, provider });
  validatedProviders.add(validated);
  return validated;
}

export async function mountValidatedDictionaryProvider(validated) {
  if (!validatedProviders.has(validated)) {
    throw new Error("Dictionary provider mount requires a fresh validated registration.");
  }
  validatedProviders.delete(validated);
  const { course, declared, globalScope, provider } = validated;
  if (globalScope.CaatuuDictionaryProvider !== provider) {
    throw new Error(`The validated dictionary provider ${declared.providerId} was replaced before mount.`);
  }
  const mounted = await provider.mountDictionaryProvider({
    course,
    dictionaryContent: Object.freeze({ ...course.dictionaryContent })
  });
  if (mounted?.mounted !== true || mounted?.providerId !== declared.providerId) {
    throw new Error(
      `The declared dictionary provider ${declared.providerId} did not confirm a successful mount.`
    );
  }
  return Object.freeze({ ...mounted });
}

export async function loadDeclaredDictionaryProvider(options) {
  const validated = await loadAndValidateDeclaredDictionaryProvider(options);
  return mountValidatedDictionaryProvider(validated);
}

export async function initializeWorkspaceAfterDictionaryProvider({
  course,
  initializeWorkspace,
  ...providerOptions
}) {
  if (typeof initializeWorkspace !== "function") {
    throw new TypeError("initializeWorkspace must initialize the shared application workspace.");
  }
  if (course?.capabilities?.dictionary === true) {
    const validated = await loadAndValidateDeclaredDictionaryProvider({
      ...providerOptions,
      course
    });
    await mountValidatedDictionaryProvider(validated);
  }
  return initializeWorkspace();
}
