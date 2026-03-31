# CLAUDE.md — turtleshell-offgrid

This file provides guidance to Claude Code when working in the turtleshell-offgrid repository.

## Project

**turtleshell-offgrid** — The off-grid TurtleShell server. A Node.js Express application that serves the TurtleShell UI, fleet health dashboard, and reverse proxies to the Olympus-616 god services. Runs entirely on-premises with no cloud dependency.

## Tech Stack

- **Node.js** + **Express** server (`status/server.js`)
- **React** SPA for the main application UI
- **HTTPS** via self-signed certificates
- **Docker** for containerized deployment
- Listens on **port 717**

## Routes

| Route | Purpose |
|-------|---------|
| `/nodestatus` | Fleet health monitoring dashboard. Shows status of all god containers. |
| `/app/*` | React SPA. The main TurtleShell UI for off-grid mode. |
| `/v1/*` | Reverse proxy to Ares (API gateway). All API calls route through here. |

## HTTPS / Certificates

Self-signed TLS certificates are stored at `~/.turtleshell/certs/`. The server uses these for HTTPS on port 717. Clients (iOS, web) must trust these certs when connecting to off-grid instances over private IPs or Tailscale.

## Features

- **Fleet health monitoring**: Dashboard at `/nodestatus` showing all running god containers
- **Ed25519 key management**: Generate and rotate Ed25519 keypairs for cosmos-logos sealed envelope authentication
- **Auto-update system**: Pulls latest images and restarts containers
- **QR code connect**: Generates QR codes for mobile clients to discover and connect to this off-grid instance

## Docker

### Off-Grid Server Image (Public)

```
ghcr.io/cosmos-logos/turtleshell-offgrid:latest
```

Multi-architecture: `linux/amd64` + `linux/arm64`

### Fleet God Images (Private)

```
ghcr.io/olympus-616/ares:latest
ghcr.io/olympus-616/athena:latest
ghcr.io/olympus-616/hermes:latest
ghcr.io/olympus-616/apollo:latest
ghcr.io/olympus-616/poseidon:latest
# ... etc
```

Private registry. Requires authentication via registry token.

### Docker Compose

The full off-grid fleet is managed by `docker-compose`. All services run behind the TurtleShell server on port 717.

## CI/CD

Merge to `brain/1.7.x.x` triggers:

1. Docker build (multi-arch `amd64` + `arm64`)
2. Push to `ghcr.io/cosmos-logos/turtleshell-offgrid`
3. Sign macOS `.pkg` installer
4. Publish to GitHub Release

## Mac Mini Test Harness

- **Tailscale IP**: 100.121.163.5
- **URL**: https://100.121.163.5:717
- Fleet managed by docker-compose
- Used for end-to-end validation of the off-grid experience

## Build Commands

```bash
# Development
cd status && node server.js              # Start the Express server
cd app && npm install && npm run build   # Build the React SPA

# Docker
docker build -t turtleshell-offgrid .    # Build the image locally
docker-compose up -d                      # Start the full fleet
docker-compose logs -f                    # Follow fleet logs
```

## Port 717 Fleet Architecture

All services run behind a single reverse proxy on port 717:

```
Client -> :717 (TurtleShell offgrid server)
  /app/*        -> React SPA (static)
  /nodestatus   -> Fleet dashboard
  /v1/*         -> Ares (security) -> Hermes (routing) -> Athena (LLM)
```

## Git Workflow

```bash
git newthought    # Create a new feature branch from brain/1.7.x.x
git savethought   # Stage and commit current work
git mainbrain     # Merge current branch back to brain/1.7.x.x
git cleanthoughts # Clean up merged branches
```

## Rules

- **NEVER** commit directly to `brain/1.7.x.x`. Always use feature branches.
- **NEVER** add `Co-Authored-By` lines to commits.
- **NEVER** run git add, git commit, or git push. Only Gregory does staging, commits, and pushes. Edit files locally and report what changed.

## License

GNU AGPL v3. All network-facing code must disclose source.
