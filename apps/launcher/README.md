# Caatuu Launcher

This app is the static browser landing page for the workspace. It is served at
`/` by the Rust server in `apps/server`.

The launcher discovers courses from `static/languages.json`; Czech is the
current default and only release-active entry. The separate `browserSetup`
projection contains browser-enabled Mandarin and Spanish development courses
without promoting either to active status. Browser and Android delivery remain
distinct: Mandarin is in the current Android bundle, while Spanish declares
Android disabled. Pages publication is narrower again; only courses with
`platforms.browser.pagesEnabled` may enter its generated registry, selectors,
and routes. Mandarin is currently deployed as an unlisted preview, while
Spanish remains local-only until its release-license gate clears. Chinese is
preserved under `archive/caatuu-chinese` for historical reference.

The files live under:

```text
apps/launcher/static
```

It does not run its own server. Use the workspace README to start the Caatuu
Docker runtime and open:

```text
http://127.0.0.1:8765/
```

Inactive interactive experiments do not belong in this app's `static/assets`
catalog or the live runtime. Reviewed historical implementations live under
`archive/`, while ignored raw research remains under `artifacts/research/`.

Production shared asset catalogs, including reusable scenery, do belong under
`static/assets/`. That path is Caatuu's common catalog and delivery location;
it does not imply that the launcher component owns those assets.
