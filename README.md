# CAATUU

Chinese learning Web App

![App Demo](static/assets/demo.png)


# Replication instructions

### Start the container
```cmd
docker run --name caatuu --gpus all -it -p 9000:9000 -v $PWD//:/src debian:latest
```

### Instlal everything
```bash
apt-get update
apt-get install -y --no-install-recommends curl
apt-get install -y --no-install-recommends ca-certificates
apt-get install -y --no-install-recommends git
apt-get install -y --no-install-recommends unzip
apt-get install -y --no-install-recommends wget
apt-get install -y --no-install-recommends pkg-config
apt-get install -y --no-install-recommends libssl-dev
apt-get install -y --no-install-recommends build-essential
apt-get install -y --no-install-recommends clang
apt-get install -y --no-install-recommends locales
```

### Install rust
```bash
curl https://sh.rustup.rs -sSf | sh -s -- -y --default-toolchain stable
source $HOME/.cargo/env
rustc --version
cargo --version
```

### Install ngrok

```bash
# 2) Add ngrok’s signing key (once)
curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
echo "deb https://ngrok-agent.s3.amazonaws.com bookworm main" > /etc/apt/sources.list.d/ngrok.list
apt-get update
apt-get install -y --no-install-recommends ngrok
ngrok http 9000 --host-header=rewrite
```
