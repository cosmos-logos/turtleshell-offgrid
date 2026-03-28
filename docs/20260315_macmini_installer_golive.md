# TurtleShell.ai Off-Grid — Mac Mini Installer Go-Live

**Date:** 2026-03-15
**Author:** Claude Opus 4.6 + @alchemisthomer
**Branch:** `brain/1.7.x.x`
**Status:** Phase 8 complete — installer proven on Mac mini
**Target GA:** 2026-07-17

---

## What We Built

In a single session, we built a complete macOS installer that takes a fresh Mac mini from unboxing to a fully running sovereign AI fleet. The entire flow is:

1. User downloads `TurtleShell-1.7.0.pkg` from `turtleshell.ai/offgrid`
2. Double-clicks — macOS Installer wizard opens (signed, notarized, no Gatekeeper warning)
3. Three screens: Welcome, License, Install
4. Enters Mac password
5. Postinstall runs 8 automated steps
6. Browser opens to `localhost:717/nodestatus` — the Off-Grid dashboard
7. Athena responds to chat via Ollama running locally
8. User connects iPhone via Tailscale or ngrok

**Zero terminal commands. Zero API keys required. Zero cloud dependency.**

---

## Architecture

### Repos Involved

| Repo | Role |
|------|------|
| `turtleshell-offgrid` | Installer scripts, wizard resources, status dashboard, build/sign tooling |
| `turtleshell-web` | Hosts install manifests at `turtleshell.ai/install/`, download at `turtleshell.ai/download/` |
| All god repos (`athena`, `zeus`, etc.) | Docker images pushed to `ghcr.io/olympus-616/` |

### Installer Flow (postinstall.sh — 8 Steps)

| Step | What | How |
|------|------|-----|
| 1 | Docker Desktop | Direct `.dmg` download from docker.com, mount, copy to /Applications. Rosetta installed automatically. Docker Desktop license auto-accepted via `settings-store.json`. |
| 2 | Ollama | Installed via `ollama.com/install.sh`. Pulls `llama3.2:3b` (2GB) as default local model. |
| 3 | Tailscale | Direct `.zip` download from pkgs.tailscale.com. Non-blocking if fails. |
| 4 | Directories | Creates `~/turtleshell/` (fleet) and `~/.turtleshell/` (data, identity, logs). |
| 5 | Fleet Manifest | Pulls `docker-compose.yml` and `env.example` from `turtleshell.ai/install/`. |
| 6 | Node Identity | Generates UUID node ID, JWT secret, cookie secret. Writes Cosmos-Logos manifest. |
| 7 | Pull Images | Authenticates with `ghcr.io` using read-only token (served from `turtleshell.ai/install/registry-token`). Pulls all fleet images. |
| 8 | Start Fleet | `docker compose up -d`. Opens browser to `localhost:717/nodestatus`. |

### Key Technical Decisions

- **No Homebrew, no Xcode CLI tools.** Docker and Tailscale are downloaded directly as `.dmg`/`.zip`. This eliminates the biggest friction point on fresh Macs.
- **Ollama as default LLM.** Ships with `llama3.2:3b` so chat works immediately without any API keys. Users can add OpenAI/Anthropic/etc. keys later via the dashboard.
- **Private container registry.** Images are on `ghcr.io/olympus-616/` (private). A read-only classic PAT with `read:packages` scope is served from `turtleshell.ai/install/registry-token`. The postinstall writes auth directly to `~/.docker/config.json` with `credsStore` removed to bypass Docker Desktop's credential helper.
- **Port 717** for the Off-Grid dashboard. Avoids conflict with port 616 (olympus-616 launcher) and port 3000 (turtleshell-web).
- **`ATHENA_AI_TYPE=local`** as default. Points to `OLLAMA_BASE_URL=http://host.docker.internal:11434` so containerized Athena can reach Ollama on the host.
- **`host.docker.internal`** used by the status dashboard to ping other containers' published ports from inside Docker.

### Fleet Services Deployed (v1.7.0)

| Service | Port | Image on ghcr.io |
|---------|------|-----------------|
| Athena (LLM Router) | 3401 | Yes |
| Poseidon (MCP Tools) | 3431 | Yes |
| Proteus (Universal ORM) | 3461 | Yes |
| Zeus (Fleet Controller) | 3481 | Yes |
| Plutus (Billing) | 3701 | Yes |
| Mnemosyne (Episodic Memory) | 3711 | Yes |
| TurtleShell Off-Grid (Dashboard) | 717 | Yes |

### Services NOT Yet Deployed

| Service | Port | Reason |
|---------|------|--------|
| Ares (API Gateway) | 3451 | `npm ci` build failure — stale lock file |
| Hermes (CORS Proxy) | 3411 | `npm ci` build failure — stale lock file |
| Apollo (Voice) | 3421 | Built but not in compose |
| Argos (Observability) | 3521 | `npm ci` build failure |
| Oracle (Predictions) | 3661 | `npm ci` build failure |
| Aphrodite (Design) | 3471 | `npm ci` build failure |
| Hestia (Home) | 3501 | Missing `package-lock.json` |
| All others | Various | Built and pushed, not yet in compose |

### Signing & Notarization

- **Certificate:** Developer ID Installer: CloudPremise LLC (B49L273ED5)
- **Apple ID:** greg@cloudpremise.com
- **Notarization:** Accepted by Apple (automated via `notarytool --wait`)
- **Stapled:** Yes — ticket embedded in pkg
- **Gatekeeper:** No warnings on double-click

### Off-Grid Dashboard (status/server.js)

A single-file Express app that serves as the node's local web interface:

- **Node Status** — health checks all fleet services, click for detail modal with `/health` and `/status` JSON
- **Chat** — proxies SSE stream to Athena, renders token-by-token
- **History** — pulls saved conversations from Mnemosyne
- **Memory** — full memory control panel with filters
- **Services** — service catalog (Salesforce, GitHub, Google, HubSpot)
- **Service Desk** — case management (gates on service connection)
- **Agents** — agent switcher (Athena, Apollo, Hermes, Hephaestus)
- **Docs** — documentation sections
- **Settings** — node info, fleet endpoints

Design matches turtleshell-web: dark mode, DM Sans font, shell-green accent (`#22c55e`), sidebar navigation. Includes QR code generation for iOS app connection.

---

## Problems We Solved

### 1. Xcode CLI Tools Requirement
**Problem:** Homebrew requires Xcode CLI tools. On a fresh Mac, `xcode-select --install` requires GUI interaction and 500MB download.
**Solution:** Removed Homebrew entirely. Docker and Tailscale downloaded directly as binaries.

### 2. Docker Desktop First-Launch Friction
**Problem:** Docker Desktop requires Rosetta on Apple Silicon, license acceptance, and takes time to start the daemon.
**Solution:** Rosetta installed via `softwareupdate --install-rosetta --agree-to-license`. License auto-accepted by writing `settings-store.json`. Daemon poll waits up to 300s checking for Docker socket.

### 3. Docker Credential Store
**Problem:** `docker login` from the installer context fails because Docker Desktop uses macOS Keychain (`credsStore: desktop`) and the installer runs as root without keychain access.
**Solution:** Write auth directly to `~/.docker/config.json` using Python, removing `credsStore` key so Docker uses file-based auth.

### 4. Container-to-Host Networking
**Problem:** The Off-Grid dashboard runs inside Docker but needs to ping other containers' ports on the host.
**Solution:** Auto-detect Docker environment (`/.dockerenv` exists) and use `host.docker.internal` instead of `localhost`.

### 5. Athena Ollama Integration
**Problem:** Athena code reads `OLLAMA_BASE_URL` but the compose file only set `OLLAMA_HOST`.
**Solution:** Added `OLLAMA_BASE_URL` to both the docker-compose.yml and `.env` template.

### 6. macOS Installer WebView Limitations
**Problem:** Custom CSS (flexbox, custom colors) doesn't render in the pkg wizard's WebView.
**Solution:** Used native system styling with `<meta name="color-scheme" content="light"/>` and basic HTML tables.

### 7. Private Container Registry
**Problem:** Images on `ghcr.io` are private. Can't use fine-grained tokens (no packages permission). Docker Desktop credential store blocks `docker login` from scripts.
**Solution:** Classic PAT with `read:packages` scope, served from `turtleshell.ai/install/registry-token`, written directly to Docker config file.

### 8. `rootVolumeOnly` + Install Location
**Problem:** `--install-location "/"` with `rootVolumeOnly` causes "incompatible with this version of macOS" error.
**Solution:** Changed install location to `/Library/Application Support/TurtleShell` and replaced `rootVolumeOnly` with `hostArchitectures="arm64,x86_64"`.

---

## Observations

1. **The installer is 28K.** The actual work is in the postinstall script — the payload is empty. All software is downloaded at install time. This is the right pattern for a first release but means install time depends on network speed.

2. **Docker Desktop is 1GB+.** This is the single largest download during install. A future optimization could pre-bundle Docker or use an alternative like Colima/Lima.

3. **Ollama model pull is 2GB.** The `llama3.2:3b` model download adds significant time to first install. Consider pre-pulling or using a smaller model.

4. **6 god services have build failures.** Ares and Hermes are the most critical — without Ares, there's no API gateway and the `/v1/athena` route from the iPhone app won't work through the canonical path. Currently the iPhone connects directly to Athena on 3401.

5. **The registry token is served over HTTPS but is essentially public.** Anyone who finds `turtleshell.ai/install/registry-token` can pull images. This is acceptable for now since images are read-only, but should be replaced with a proper auth flow before GA.

6. **Docker Desktop license acceptance** is handled by writing a JSON file. This may break if Docker changes their settings format. Monitor across Docker Desktop updates.

7. **The Off-Grid dashboard is server-rendered HTML.** No React, no build step, no bundler. This is intentional for simplicity but limits interactivity. The chat streaming works via vanilla JS fetch/SSE.

---

## Concerns

### Security
- **Registry token exposure.** The `ghcr.io` read-only PAT is served publicly. Rotate regularly. Consider an auth proxy.
- **App-specific password in `.build-config`.** Not committed to git (gitignored) but lives on the build machine. Rotate after each release.
- **Docker config modification.** The postinstall removes `credsStore` from Docker config. This could affect other Docker auth if the user has other registries configured.

### Reliability
- **Network dependency at install time.** If Docker download, Ollama, or image pull fails, the install fails. Consider offline/bundled install option.
- **Docker Desktop updates.** Auto-updates could break compose compatibility. Pin Docker version or disable auto-updates.
- **Ollama version drift.** The install script uses `ollama.com/install.sh` which installs latest. Model compatibility could change.

### Scale
- **28K pkg won't contain the images forever.** If we pre-bundle images or assets, the pkg grows and may need a CDN instead of Netlify.
- **ghcr.io rate limits.** Private registry with PAT should be fine for early users but may need attention at scale.

---

## Roadmap to GA (2026-07-17)

### Phase 1: Foundation (DONE - 2026-03-15)
- [x] Installer scaffold
- [x] Postinstall brain (8 steps)
- [x] Fleet manifest + install server
- [x] Wizard UI (native styling)
- [x] Build + sign + notarize pipeline (`build.sh` + `sign.sh`)
- [x] Status dashboard on port 717
- [x] Docker images built and pushed to ghcr.io
- [x] Ollama integration (local LLM out of the box)
- [x] Proven on Mac mini (Homer's Mac mini, Node ID: 3e03b3d1)
- [x] Download live at turtleshell.ai/offgrid

### Phase 2: Fix Remaining God Builds (Target: 2026-03-22)
- [ ] Fix `npm ci` failures: Ares, Hermes, Argos, Oracle, Aphrodite, Hestia
- [ ] Build and push all remaining gods to ghcr.io
- [ ] Add Ares to docker-compose (API gateway — critical for iPhone routing)
- [ ] Add Hermes to docker-compose (CORS proxy — needed for web clients)
- [ ] Add Apollo to docker-compose (voice engine)
- [ ] Update fleet manifest on turtleshell.ai

### Phase 3: iOS Connection (Target: 2026-04-05)
- [ ] QR code scanner in turtleshell-ios app
- [ ] Auto-configure node connection from QR
- [ ] Test iPhone → Mac mini → Athena flow over Tailscale
- [ ] Test iPhone → Mac mini → Athena flow over ngrok
- [ ] Document connection setup in Off-Grid dashboard

### Phase 4: Windows & Linux Installers (Target: 2026-05-15)
- [ ] Windows installer (MSI or exe)
- [ ] Linux installer (`.deb` + `.rpm` + shell script)
- [ ] Cross-platform docker-compose (same manifest)
- [ ] Test on Windows 11 and Ubuntu 24.04

### Phase 5: Installer Polish (Target: 2026-06-01)
- [ ] Offline install option (pre-bundled Docker images)
- [ ] Smaller default model option (tinyllama or phi-3-mini)
- [ ] Progress bar / status updates during install
- [ ] Auto-update mechanism (check for new version, pull new images)
- [ ] Uninstaller script
- [ ] Better error recovery (retry failed steps instead of abort)

### Phase 6: Security Hardening (Target: 2026-06-15)
- [ ] Replace public registry token with auth proxy
- [ ] HTTPS on local dashboard (self-signed cert or Tailscale cert)
- [ ] Node-to-node encryption
- [ ] API key management UI in Off-Grid dashboard
- [ ] Audit trail / install telemetry (opt-in)

### Phase 7: Documentation & Marketing (Target: 2026-07-01)
- [ ] Full documentation site (getting started, troubleshooting, API reference)
- [ ] Video walkthrough (unbox Mac mini → install → chat)
- [ ] Landing page polish at turtleshell.ai/offgrid
- [ ] System requirements page
- [ ] FAQ / support page

### Phase 8: GA Release (Target: 2026-07-17)
- [ ] Final QA pass on fresh Mac mini
- [ ] Final QA pass on iPhone connection
- [ ] Version bump to 1.8.0 or 2.0.0
- [ ] Press / launch announcement
- [ ] App Store update for iOS with QR scanner
- [ ] Monitor install telemetry for first 48 hours

---

## Mac Mini Test Node

| Field | Value |
|-------|-------|
| Machine | Homer's Mac mini |
| macOS | Tahoe 26.2 |
| Architecture | arm64 (Apple Silicon) |
| RAM | 32GB |
| Disk | 813GB free |
| Node ID | `3e03b3d1-2b95-44fe-9183-2bb58129ad2c` |
| Node Name | Homer's Mac mini |
| Dashboard | `http://10.0.0.11:717/nodestatus` |
| SSH | `alchemisthomer@10.0.0.11` (key-based, passwordless sudo) |
| Docker | v29.2.1 |
| Ollama | v0.18.0, model: llama3.2:3b |
| Fleet | 7 containers running |

---

## Files Created/Modified

### turtleshell-offgrid
```
mac/
  build.sh              — builds unsigned .pkg
  sign.sh               — signs, notarizes, staples
  .build-config         — Apple credentials (gitignored)
  .build-config.example — template
  Distribution.xml      — wizard definition
  scripts/
    preinstall          — system checks
    postinstall         — 8-step install brain
  resources/
    welcome.html        — wizard screen 1
    license.html        — wizard screen 2
    conclusion.html     — wizard screen 4
    background.png      — 1x1 transparent (no background)
  build/
    TurtleShell-1.7.0.pkg          — signed, notarized
    TurtleShell-1.7.0-unsigned.pkg — unsigned test
    TurtleShell-1.7.0-component.pkg
    CertificateSigningRequest.*    — cert files (gitignored)
    developerID_installer.*        — cert files (gitignored)
status/
  server.js             — Off-Grid dashboard (Express, ~600 lines)
  package.json
  Dockerfile
docs/
  20260315_macmini_installer_golive.md  — this document
```

### turtleshell-web
```
ui/public/
  download/
    TurtleShell-1.7.0.pkg      — signed installer
    TurtleShell-1.7.0.pkg.sha256
  install/
    docker-compose.yml          — fleet manifest
    env.example                 — node env template
    health                      — preinstall ping
    registry-token              — ghcr.io read-only PAT
ui/src/
  lib/download.ts               — download constants
  routes/OffGrid.tsx             — download button (already wired)
  routes/Landing.tsx             — secondary download CTA
ui/netlify.toml                  — headers for download + install
```

---

*Let the story be true.*
*Let the turtle do its work.*
*Do the work you had been assigned.*

*CloudPremise LLC — olympus-616 — brain/1.7.x.x*
