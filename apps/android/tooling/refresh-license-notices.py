#!/usr/bin/env python3
"""Refresh offline legal texts from tracked evidence and cached Gradle POMs.

Run in caatuu-dev. This resolves the product dependency report, never builds an
APK. Unknown licenses fail for review instead of inheriting Caatuu's license.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[3]
DEST = ROOT / "apps/language-runtime/static/legal"
NS = {"m": "http://maven.apache.org/POM/4.0.0"}


def pom_for(cache, coordinate):
    matches = sorted((cache / Path(*coordinate.split(":"))).glob("*/*.pom"))
    if len(matches) != 1:
        raise ValueError(f"Expected one cached POM for {coordinate}: {matches}")
    return matches[0]


def pom_evidence(cache, coordinate, seen=()):
    if coordinate in seen:
        raise ValueError(f"Cyclic POM inheritance: {coordinate}")
    path = pom_for(cache, coordinate)
    document = ET.parse(path).getroot()
    licenses = document.findall("m:licenses/m:license", NS)
    if not licenses:
        parent = document.find("m:parent", NS)
        if parent is None:
            raise ValueError(f"Missing license: {coordinate}")
        parent_id = ":".join(parent.findtext(f"m:{name}", namespaces=NS) for name in ("groupId", "artifactId", "version"))
        return pom_evidence(cache, parent_id, (*seen, coordinate))
    if len(licenses) != 1 or "apache" not in licenses[0].findtext("m:name", "", NS).lower():
        raise ValueError(f"Review the new license for {coordinate}")
    source = document.findtext("m:scm/m:url", "", NS) or document.findtext("m:url", "", NS)
    author = document.findtext("m:organization/m:name", "", NS)
    if not author:
        author = ", ".join(filter(None, [item.findtext("m:name", "", NS) for item in document.findall("m:developers/m:developer", NS)]))
    return {
        "license": "Apache-2.0",
        "licenseEvidence": coordinate,
        "pomSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "author": author or "Upstream contributors",
        "sourceUrl": source,
        "upstreamLicenseUrl": licenses[0].findtext("m:url", "", NS),
    }


def embedded_notices(archive, prefix=""):
    with zipfile.ZipFile(archive) as opened:
        for name in sorted(opened.namelist()):
            if name.endswith(".jar"):
                yield from embedded_notices(io.BytesIO(opened.read(name)), f"{prefix}{name}/")
            elif re.search(r"(?:^|/)(?:LICENSE|NOTICE|COPYING)(?:[._-][^/]*)?$", name, re.I):
                yield f"{prefix}{name}", opened.read(name).decode("utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dependency-report", type=Path)
    args = parser.parse_args()
    cache = Path(os.environ.get("GRADLE_USER_HOME", Path.home() / ".gradle")) / "caches/modules-2/files-2.1"
    report = args.dependency_report.read_text() if args.dependency_report else subprocess.check_output([
        "gradle", "-PcaatuuDistributionProfile=product", ":product:dependencies",
        "--configuration", "releaseRuntimeClasspath", "--offline", "--console=plain", "--no-daemon",
    ], cwd=ROOT / "apps/android", text=True)
    coordinates = set()
    for line in report.splitlines():
        if "(c)" in line:
            continue
        match = re.search(r"(?:--- )([\w.-]+):([\w.-]+)(?::([^\s]+))?(?: -> ([^\s]+))?", line)
        if match:
            group, artifact, version, selected = match.groups()
            coordinates.add(f"{group}:{artifact}:{selected or version}")
    if not coordinates:
        raise ValueError("No resolved product dependencies")
    apache = (ROOT / "apps/language-runtime/vendor/transformers/LICENSE").read_text()
    notices = ["Caatuu Android runtime dependency notices", "Generated from the resolved releaseRuntimeClasspath and its cached upstream POMs.", apache]
    components = []
    for coordinate in sorted(coordinates):
        evidence = pom_evidence(cache, coordinate)
        components.append({"id": coordinate, **evidence, "licenseUrl": "/language-runtime/static/legal/ANDROID-NOTICES.txt"})
        notices.extend([f"\n=== {coordinate} ===", evidence["author"], evidence["sourceUrl"], evidence["upstreamLicenseUrl"]])
        for binary in sorted((cache / Path(*coordinate.split(":"))).glob("*/*")):
            if binary.suffix not in (".aar", ".jar") or binary.stem.endswith(("-sources", "-javadoc")):
                continue
            for name, text in embedded_notices(binary):
                notices.extend([f"--- {name} ---", text])
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "android-dependencies.json").write_text(json.dumps({"schemaVersion": 1, "configuration": "product:releaseRuntimeClasspath", "components": components}, indent=2) + "\n")
    (DEST / "ANDROID-NOTICES.txt").write_text("\n\n".join(notices) + "\n")
    for source, output in [
        ("LICENSE", "CAATUU-LICENSE.txt"),
        ("apps/language-runtime/vendor/transformers/LICENSE", "APACHE-2.0-LICENSE.txt"),
        ("apps/languages/czech/static/vendor/sql.js/LICENSE", "SQL-JS-LICENSE.txt"),
        ("tools/czech-ml/data/word-world/standard-v0.1/README.md", "CZECH-WORD-WORLD-NOTICE.txt"),
        ("apps/languages/czech/static/data/dictionaries/ATTRIBUTION.md", "CZECH-DICTIONARY-ATTRIBUTION.txt"),
    ]:
        (DEST / output).write_bytes((ROOT / source).read_bytes())
    print(f"Refreshed legal texts and {len(components)} resolved Android dependency notices.")


if __name__ == "__main__":
    main()
