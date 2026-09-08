const sourceRoot = "https://github.com/savethebeesandseeds/caatuu";
export const CAATUU_LICENSE_URL = "/language-runtime/static/legal/CAATUU-LICENSE.txt";

export function firstPartyLicenseArtifacts() {
  return [{
    key: "caatuu-software",
    label: "Caatuu",
    sourceLabel: "Caatuu contributors · corresponding source",
    sourceUrl: sourceRoot,
    license: "AGPL-3.0-only",
    licenseUrl: CAATUU_LICENSE_URL,
    intendedUse: "Copyright © 2025–2026 Caatuu contributors. First-party software and developer documentation; provided without warranty. Curriculum, artwork, music, brands and third-party components have separate terms.",
    artifactKind: "first-party-software"
  }, {
    key: "caatuu-artwork-and-branding",
    label: "Caatuu artwork and branding",
    sourceLabel: "Separate terms and provenance",
    sourceUrl: `${sourceRoot}/blob/main/docs/LEGAL_INVENTORY.md`,
    license: "Separate terms; asset provenance review remains incomplete",
    intendedUse: "Character illustrations, image hints, animation, icons and brand identities. The software license does not grant rights to these materials. See the recorded asset-specific evidence.",
    artifactKind: "visual-assets"
  }];
}

export function embeddingRuntimeLicenseArtifacts(notices) {
  if (!Array.isArray(notices?.components) || !notices.components.length) {
    throw new Error("Embedding runtime license notices are missing.");
  }
  return notices.components.map((component) => {
    const licenseUrl = component.name === "onnxruntime-web"
      ? "/language-runtime/static/legal/ONNX-RUNTIME-LICENSE.txt"
      : component.packaged_license_file?.endsWith("/LICENSE")
      ? "/language-runtime/static/legal/APACHE-2.0-LICENSE.txt"
      : component.packaged_license_file
      || (component.license_file && `/language-runtime/models/all-minilm-l6-v2-qint8-v0.1/runtime/${component.license_file}`);
    if (!component.name || !component.license || !licenseUrl?.startsWith("/language-runtime/")) {
      throw new Error(`Missing offline license text for ${component.name || "embedding component"}.`);
    }
    return {
      key: `runtime:${component.name}`,
      label: [component.name, component.version].filter(Boolean).join(" "),
      sourceLabel: component.revision || "Upstream source",
      sourceUrl: String(component.source_url || "").replace(/^git\+/u, "").replace(/\.git$/u, ""),
      license: component.license,
      licenseUrl,
      intendedUse: "Used by local English-text embedding inference. Loaded on demand; lexical matching remains available if inference cannot start.",
      artifactKind: "embedding-runtime-dependency"
    };
  });
}

export function wordWorldLicenseArtifact(manifest, { courseId, sourceUrl }) {
  if (!manifest || !Number.isInteger(manifest.recordCount) || manifest.recordCount < 0) {
    throw new Error(`Word World license metadata requires the current ${courseId} manifest.`);
  }
  // This historical Czech corpus has an explicit, scoped MIT grant in its
  // source README. Never extend that grant to another course's curriculum.
  const czechStandard = courseId === "cz" && manifest.corpusVersion === "standard-v0.1";
  const license = manifest.license?.spdxExpression || (czechStandard ? "MIT" : "License review pending");
  return {
    key: `${courseId}:word-world-corpus`,
    label: "Word World course content",
    sourceLabel: "Course manifest",
    sourceUrl,
    license,
    licenseUrl: license === "AGPL-3.0-only" ? CAATUU_LICENSE_URL
      : czechStandard ? "/language-runtime/static/legal/CZECH-WORD-WORLD-NOTICE.txt" : "",
    intendedUse: `Course ${courseId} · ${manifest.corpusVersion}. ${manifest.license?.status || (czechStandard ? "Historical MIT corpus grant" : "License review pending")}. Content review: ${manifest.review?.status || manifest.reviewStatus || "not recorded"}.`,
    artifactKind: "guided-learning-corpus",
    entryCount: manifest.recordCount
  };
}

export function nativeLicenseArtifacts(catalog) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.components) || !catalog.components.length) {
    throw new Error("Android dependency license inventory is missing.");
  }
  return catalog.components.map((component) => ({
    key: `android:${component.id}`,
    label: component.id,
    sourceLabel: component.author,
    sourceUrl: component.sourceUrl,
    license: component.license,
    licenseUrl: component.licenseUrl,
    intendedUse: "Included in the Android product application's runtime dependency graph.",
    artifactKind: "android-dependency"
  }));
}

export function conceptLicenseArtifact(catalog, sourceUrl) {
  if (!catalog?.id || !Array.isArray(catalog.concepts)) {
    throw new Error("English concept attribution requires the current catalog.");
  }
  return {
    key: `concepts:${catalog.id}`, label: "English learning concepts",
    sourceLabel: "Authored concept catalog", sourceUrl,
    license: catalog.license?.spdxExpression || "License review pending",
    licenseUrl: catalog.license?.spdxExpression === "AGPL-3.0-only" ? CAATUU_LICENSE_URL : "",
    intendedUse: `English descriptions used for learning content and embedding retrieval. ${catalog.license?.status || "License review pending"}.`,
    entryCount: catalog.concepts.length, artifactKind: "learning-content"
  };
}
