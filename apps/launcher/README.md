# Caatuu Launcher

This app is the static browser landing page for the workspace. It is served at
`/` by the Rust server in `apps/server`.

The launcher discovers active courses from `static/languages.json`; Czech is the
current default and only active entry. Browser and Android entry points belong
to each registry item, so future languages can expose the platforms they
actually support. Chinese is preserved under `archive/caatuu-chinese` for later
historical reference. The fresh `zh` course is a separate, unlisted
development preview and is intentionally absent from this public active-only
registry until native review and licensing gates clear.

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
