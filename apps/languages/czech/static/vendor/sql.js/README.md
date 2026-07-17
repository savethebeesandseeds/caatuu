# sql.js Runtime

Vendored from `sql.js` `1.13.0`:

- `sql-wasm.js`
- `sql-wasm.wasm`
- `LICENSE`

The Czech browser app uses these files to open the downloaded local SQLite
vector database offline. Keep this runtime separate from
`static/data/embeddings/`, which is reserved for generated vector artifacts.
