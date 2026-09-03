# Caatuu Launcher

This app is the static browser landing page for the workspace. It is served at
`/` by the Rust server in `apps/server`.

The launcher discovers courses from `static/languages.json`; Czech is the
current default and only release-active entry. The registry's separate browser
setup projection also advertises the browser-enabled Mandarin development
preview without promoting it to active status. Browser and Android entry points
remain distinct, so the generic browser action opens the language form while
the Android action continues to follow the active Czech release channels.
Chinese is preserved under `archive/caatuu-chinese` for later historical
reference. Native Mandarin review is still required before the fresh `zh`
course can become active; that activation rule does not prevent the disclosed
development course from being bundled in a published APK.

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
