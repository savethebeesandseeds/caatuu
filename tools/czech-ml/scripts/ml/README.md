# ML scripts

Maintained Python and container entry points for the Caatuu Czech model
workspace live here. Large datasets, model weights, adapters, exports, and
caches remain under `data/` and are intentionally excluded from Git.

Run these scripts through the development/ML container documented in
[`tools/dev-container`](../../../dev-container/) and the owning runbooks. Paths are resolved against
the `tools/czech-ml/data/models` workspace regardless of the current
working directory.

Training and adapter merging use `/opt/caatuu-ml/bin/python`; MLC conversion
uses `caatuu-mlc-python`. Both environments are provisioned by the root
`setup.sh` in the existing `caatuu-dev` container.

From PowerShell, `export-webllm.ps1` accepts `-RunId`, `-Stage`,
`-CompileWebgpu` and `-Cpu`. Its `all` stage merges in the training environment
and then converts in the MLC environment. `export-webllm-docker.ps1 -RunId ...`
retains the older CPU conversion-without-config-generation plus Node finalizer
flow. Its former `-Image` option is retired. Both wrappers require the running
canonical container and never build or create a container.

Dataset generation, saved-benchmark comparison and export finalization use
the maintained Node commands in `tools/czech-ml/package.json`:
`npm run build:dataset`, `npm run compare` and `npm run finalize:webllm`.
