# Czech application source

This directory contains the authored JavaScript, CSS, and browser modules for
the Czech application. Public HTML entrypoints remain one level above so their
URLs stay stable.

- `shared/` contains the course profile, runtime, semantic state, shared Chrome,
  maintenance UI, and browser data helpers used across screens.
- `games/` contains source owned by each learning game.
- `features/` contains supporting screens and focused feature modules.

Runtime datasets stay under `../data/`, third-party browser code stays under
`../vendor/`, and PWA entrypoints such as `../sw.js` and
`../manifest.webmanifest` remain at the public root.
