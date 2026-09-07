# Caatuu Launcher

This app is the static browser landing page for the workspace. It is served at
`/` by the Rust server in `apps/server`.

The launcher discovers all supported courses from `static/languages.json`.
Czech is the default active course; Mandarin, Spanish for English speakers,
and English for Spanish speakers retain their development-preview labels.
All four courses are enabled for the browser, Pages, and Android. The
`browserSetup` projection, launcher registry, and course selectors preserve
development status without hiding those courses. Only courses with
`platforms.browser.pagesEnabled` enter Pages routes and generated views.
Availability changes reach the published website and installed Android app
through their respective release workflows. Earlier Chinese work is preserved
under `archive/caatuu-chinese` for historical reference.

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
