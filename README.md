# Caatuu Workspace

Caatuu is a workspace for language-learning app variants.

## Active Apps

- `apps/caatuu-unified` - the root landing page served at `/`.
- `apps/caatuu-chinese` - Chinese trainer, served at `/zh/`, with the Rust/Axum backend behind `/zh/api/v1/` and `/zh/ws`.
- `apps/caatuu-czech` - Czech browser app, served at `/cz/`. Local WebLLM model exports live under `static/data/models/` but are generated artifacts, not Git payload.

## One Container

From PowerShell on Windows:

```powershell
docker rm -f caatuu 2>$null

docker run -dit `
  --name caatuu `
  --gpus all `
  -p 8765:9172 `
  -v C:\Work\caatuu:/workspace `
  -w /workspace `
  debian:latest `
  bash
```

Install the runtime tools inside the container:

```bash
apt-get update
apt-get install -y ca-certificates curl gpg procps file
```

Install `cloudflared` inside the container:

```bash
mkdir -p /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' > /etc/apt/sources.list.d/cloudflared.list
apt-get update
apt-get install -y cloudflared
```

From PowerShell, build the Rust server without installing Rust in the Debian runtime container:

```powershell
docker run --rm -v C:\Work\caatuu:/workspace -w /workspace/apps/caatuu-chinese -e CARGO_TARGET_DIR=/workspace/apps/caatuu-chinese/target-linux rust:latest cargo build
```

Inside the Debian container, start the unified Rust server:

```bash
bash /workspace/tools/runtime/start-caatuu.sh
```

From PowerShell, start it in the background like this:

```powershell
docker exec -d caatuu bash -lc "bash /workspace/tools/runtime/start-caatuu.sh >/tmp/caatuu-start.log 2>&1"
```

Open locally:

```text
http://127.0.0.1:8765/
http://127.0.0.1:8765/zh/
http://127.0.0.1:8765/cz/
http://127.0.0.1:8765/cz/device-ai.html
```

## Cloudflare Tunnel

The named tunnel should point to the Rust server inside the container:

```text
http://127.0.0.1:9172
```

Run it with a current token:

```bash
export CLOUDFLARED_TOKEN="PASTE_CURRENT_CAATUU_TUNNEL_TOKEN_HERE"
cloudflared tunnel --protocol http2 run --token "$CLOUDFLARED_TOKEN"
```

Public routes after the tunnel is connected:

```text
https://caatuu.waajacu.com/
https://caatuu.waajacu.com/zh/
https://caatuu.waajacu.com/cz/
https://caatuu.waajacu.com/cz/device-ai.html
```

## Development Split

The browser/runtime container does not need Python or nginx. The Rust server
serves the unified landing page, the Chinese app, the Czech app, the Chinese
API, and the Chinese websocket endpoint directly.

Future training/export work can still use the ML workspace:

```text
tools/caatuu-cz-ml
```

That part still depends on Python/PyTorch until we replace the training stack.

## Archive

- `archive/caatuu-tauri-android-deprecated` - older Tauri/Android packaging experiment.
- `archive/caatuu-server-deprecated` - older Rust server/profile-engine experiment.

## Tools

- `tools/runtime` - launch script for the unified Rust server.
- `tools/phone-bench` - native Android/Termux benchmark path for offline Czech
  model testing on phones without browser WebGPU.
- `tools/images-generation` - Stable Diffusion/image generation workspace.
