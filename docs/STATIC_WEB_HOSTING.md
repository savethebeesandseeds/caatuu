# Static web hosting

Last reviewed: 28 August 2026

Caatuu has a deterministic static profile for GitHub Pages. This removes the
workstation and Docker containers from the public website's availability path
without changing the existing server or Android product. Publication remains a
deliberate manual action; adding the pipeline does not change DNS or the live
site.

## What the static site contains

The `web-static-core` bundle contains the launcher, Czech interface, ordinary
local progress and stats, the 865-record curated web dictionary, all four
browser learning games, the reviewed Standard Word World corpus, its compact
form-lookup supplement, and all 647 reviewed visual assets. The supplement
retains every Standard-game surface resolved by the pinned full dictionary
(1,195 of 1,277); the remaining 82 source-dictionary misses keep the existing
local gap behavior. Its source and CC BY-SA attribution are recorded in the
bundle. The root service worker precaches the compact application shell and
caches the visual catalog on demand.

The bundle does not contain Chat, language models, embedding models or vector
databases, SQL/WASM model runtimes, the server-backed full dictionary, Android
packages, Godot previews, archives, or dynamic API routes. Those sources and
artifacts remain in their existing repository and product locations; the
static exporter merely omits them from its generated output. Model-backed
Skill Compass mapping is hidden in this profile. Game picture hints use the
existing keymaps when semantic search is absent.

## Build and inspect locally

Use the maintained container and ignored output directory:

```powershell
docker exec -w /workspace caatuu-dev node apps/launcher/tooling/build-static-site.mjs --output artifacts/web/github-pages
```

The successful command prints the profile, exact file count, total bytes, and
required first-setup bytes. It also writes
`artifacts/web/github-pages/caatuu-web-bundle.json`, whose sorted inventory
binds every other file by byte count and SHA-256.

Before publication, inspect `/`, `/cz/`, Dictionary, Backpack, and each game
from the generated directory through an approved local review route. Confirm
that setup completes, image hints appear, saved progress survives reload, and
the browser makes no `/api/`, `/android/`, model, or embedding request.

## One-time GitHub Pages configuration

The repository owner performs these control-plane steps in GitHub. They are not
done by the workflow:

1. Confirm that `main` is still the only local and remote branch.
2. In repository **Settings → Pages**, select **GitHub Actions** as the source.
3. Add the custom domain `caatuu.waajacu.com` and complete GitHub's domain
   verification. Keep the current DNS route in place while local validation is
   still underway.
4. Leave HTTPS enforcement enabled once GitHub reports the certificate and DNS
   as ready.

The first artifact may need to be deployed before GitHub can provision the
custom-domain certificate. For that deployment only, manually enable the
workflow's `allow_http_certificate_bootstrap` input. It accepts the exact HTTP
custom origin while keeping the hostname and root-path checks intact. Leave the
input off after DNS points to Pages; the default path requires the exact HTTPS
origin.

GitHub's current instructions for these controls are [configuring a publishing
source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
and [managing a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).

The manual `Deploy static Caatuu to GitHub Pages` workflow fails closed unless:

- it is dispatched from `main`;
- `main` is the only local and remote branch;
- GitHub Pages reports the exact origin `https://caatuu.waajacu.com` with an
  empty base path, except for the explicit default-off certificate-bootstrap
  input described above; and
- the static builder and complete payload validator pass.

It uploads a Pages artifact and uses GitHub's Pages deployment API. There is no
`gh-pages` branch and no push trigger.

## DNS cutover

DNS is the final availability switch, not a build step. Change it only after the
generated site has passed local visual and interaction review and the Pages
deployment is ready. For this subdomain, follow GitHub's displayed DNS target
and verification values; do not copy an unverified value from old notes.

After DNS resolves, check the public origin in a fresh browser profile and on a
phone. Verify `/`, `/cz/`, all four games, setup, refresh/navigation behavior,
the web app manifest, and HTTPS. Keep the former tunnel configuration available
during this observation window.

## Rollback

If public validation fails, restore the previous DNS record. The static build
does not delete or rewrite the server, containers, Android artifacts, model
files, browser progress, or the prior tunnel configuration. Pause further Pages
deployments until the generated bundle is corrected and reviewed again.
