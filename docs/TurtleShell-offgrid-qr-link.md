# TurtleShell Off-Grid — QR Link & Self-Onboarding

**Version:** 1.7.1
**Date:** 2026-03-16
**Branch:** `brain/1.7.x.x`
**Status:** DEPLOYED & VERIFIED

---

## Summary

This document covers the complete implementation of TurtleShell.ai's sovereign off-grid node — from the Salesforce-deployable iris portal to the self-hosted Mac Mini fleet with QR-based iPhone onboarding. The work spans multiple repositories across the Olympus-616 ecosystem.

---

## What Was Built

### 1. TurtleShell Iris — Feature Parity Rebuild

Ported the full turtleshell-web application into the Salesforce iris plugin framework, enabling TurtleShell.ai to run as a Salesforce Lightning utility bar application.

**54 new files created** across the iris turtleshell plugin:

| Layer | Files | Description |
|-------|-------|-------------|
| Types | 3 | Agent, Chat, Service type definitions |
| Zustand Stores | 6 | agent, chat, service, environment, apollo, theme |
| API Clients | 7 | Olympus-Grid, Salesforce, GitHub, Google, HubSpot, Workday, Plutus |
| Athena/MCP | 2 | Chat streaming client, MCP header builder |
| Audio | 1 | Web Audio API manager (bypasses SF CSP blob: restriction) |
| Hooks | 2 | useApollo (mic/TTS), useAgentStatus (polling) |
| Utilities | 2 | cn(), generateId(), formatTimestamp(), logger |
| Layout | 1 | TurtleShellLayout (minimal, no sidebar) |
| Pages | 13 | Chat, Services, Agents, Settings, History, Memory, ServiceDesk, Docs, Shells, OAuthCallback, AuthCallback |
| Service Modals | 6 | Connection dialogs for all 6 services |
| UI Components | 1 | Lightweight Dialog (replaces Radix UI) |
| Config | 2 | Routes (12 routes), Menus (turtle emoji) |

**Key architectural adaptations for Salesforce:**
- All `@/` path aliases converted to relative imports
- Routes: `/app/*` → `/turtleshell/*`
- Developer key: `ts-portal-int-2026`
- Radix UI Dialog → custom lightweight Dialog component
- Environment default: `cloud` (iris context)
- Legal links → external `https://turtleshell.ai/*`
- Custom `TurtleShellLayout` replaces iris DashboardLayout
- Sidebar removed — compact popover menu with navigation, agent picker, and toggle options

### 2. SLDS Theme

Added Salesforce Lightning Design System theme as a style option alongside Light and Dark modes:
- CSS variables for SLDS palette (#f3f3f3 backgrounds, #16325c text, #0070d2 blue accent)
- ~50 CSS override rules remapping all `shell-*` (green) classes to Salesforce blue
- SLDS-specific border radius (0.25rem), font stack, and card styling
- Theme picker in Settings with three options: Light, Dark, Salesforce Lightning

### 3. Salesforce Lightning App

Created the `TurtleShell.ai` Salesforce application:

| Component | Type | Description |
|-----------|------|-------------|
| `TurtleShell_ai` | CustomApplication | Lightning app with green brand header |
| `TurtleShell_ai_Home` | CustomTab | Home page tab |
| `TurtleShell_ai_UtilityBar` | FlexiPage | Utility bar with Turtleshell Aura component |
| `turtleshellApp` | LWC | Tab wrapper |
| `turtleshellHome` | LWC | Home page with hero, services, support tabs |
| `TurtleshellOauth` | Visualforce Page | OAuth callback handler |
| `TurtleshellOauthCtrl` | Apex Class | OAuth code exchange + client ID retrieval |
| `Turtleshell_ai_Admin` | PermissionSet | App visibility + tab access |
| CSP Trusted Sites | 2 | Ares offgrid + cloud endpoints |

### 4. OAuth Flows in Salesforce Iframe

Implemented OAuth for all services within the Salesforce Lightning Container iframe, solving cross-origin cookie and localStorage challenges.

**The challenge:** The iris portal runs inside a `*.container.force.com` iframe. httpOnly cookies from Ares are blocked as third-party. LWC localStorage is namespaced by LockerService. Navigation is sandboxed.

**The solution (per service):**

#### Olympus-Grid (Magic Link)
- Ares modified to return tokens in `x-og-access-token` / `x-og-refresh-token` response headers when `x-token-delivery: header` is sent
- Iris portal stores tokens in container localStorage, injects as `x-user-identity` header on requests
- JWT signing certificate retrieved from scratch org and placed in Ares for validation

#### Salesforce (OAuth PKCE)
- `force:navigateToURL` via LCC message bridge to break out of sandboxed iframe
- VF page callback (`/apex/TurtleshellOauth`) captures code, redirects to LWC home tab with hash
- LWC exchanges code via Apex `OauthUtil.exchangeCode` (uses client_secret server-side)
- Tokens stored via cookies (LockerService-safe bridge between LWC and Aura)
- Aura `doInit` reads cookies → passes as container iframe URL params
- Iris portal reads `oauth_connected` param → registers service
- "Activate Connection" CTA button on LWC home page → page reload triggers `doInit`

#### GitHub (PAT)
- Direct API call from iris portal → Ares → Hermes → GitHub API
- `x-token-delivery: header` returns token in `x-gh-access-token` response header
- Token stored in container localStorage as `gh_access_token`
- Injected as `x-github-token` header on MCP requests

#### Google (OAuth)
- Same VF page callback pattern as Salesforce
- PKCE disabled in SF iframe (Apex exchange uses client_secret)
- LWC exchanges via Apex `OauthUtil.exchangeGoogleCode`
- Same cookie → Aura → container bridge

#### HubSpot (Private App Token)
- Same pattern as GitHub PAT
- `x-hs-access-token` response header → localStorage → `x-hubspot-api-key` header

**Ares changes (all services):**
- `x-token-delivery: header` mechanism added to all 5 auth routes
- CORS `exposedHeaders` updated with all service token headers
- `cookieToHeader.ts` already passes through client-sent headers (no cookie needed)

**MCP Headers:**
- `mcp-headers.ts` updated to inject all 5 stored tokens as headers when in SF iframe
- Same header names that Ares `cookieToHeader` middleware produces

### 5. Audio — Web Audio API

Replaced `<audio>` element + `blob:` URLs with Web Audio API (`AudioContext.decodeAudioData`) to bypass Salesforce CSP `media-src` blocking of `blob:` URLs. Full playback controls preserved: play, pause, resume, seek, speed.

### 6. Microphone — Hold-to-Record Fix

Fixed speech recognition on/off/on/off loop by adding `stoppedManuallyRef` flag. When user explicitly stops (hold-to-record release), `onend` handler doesn't restart the recognition loop.

### 7. Off-Grid Fleet — Ares & Hermes Docker Images

Built and pushed Docker images for Ares (API Gateway) and Hermes (Message Transport) to `ghcr.io/olympus-616/`:

**Problem:** `npm ci` failed due to workspace lock file mismatch.
**Fix:** Changed Dockerfiles from `npm ci` to `npm install` for both services.

**Hermes god proxy configuration:**
- Hermes reads route table from `.env` file at `OLYMPUS_DIR`
- Created `olympus-config/` directory with `.env` mapping service names to Docker hostnames
- `pantheon.json` marker file for `findOlympusDir()` discovery
- Volume mounted as `./olympus-config:/olympus-config:ro`

### 8. Docker Health Checks

Changed all health checks from `curl -f` to `wget -q --spider` — Alpine-based containers don't include curl. All 9 containers now report healthy.

### 9. Auto-Start on Boot

Installed macOS LaunchAgent (`~/Library/LaunchAgents/ai.turtleshell.fleet.plist`) that starts the Docker Compose fleet 30 seconds after login.

### 10. Self-Onboarding — `/connect` Page

Added 4 new routes to the off-grid dashboard (`status/server.js`):

| Route | Purpose |
|-------|---------|
| `GET /connect` | Standalone self-onboarding page with dark theme, node identity, certificate install steps, QR code, manual IP list |
| `GET /connect/cert` | Serves `rootCA.pem` for iOS certificate trust installation |
| `GET /connect/qr` | Returns QR code as PNG image |
| `GET /connect/manifest` | JSON endpoint with node info, endpoints, IPs |

**QR code format:** `http://{host}:3451/v1/athena` — matches the iOS app's `isValidTurtleShellURL()` validation (scheme: http/https, path: /v1/athena, port: 3451).

### 11. HTTPS — mkcert Self-Signed Certificates

- Dashboard runs dual-mode: HTTPS on port 717, HTTP on port 718 (for cert downloads before trust)
- mkcert generates certificates covering localhost, all local IPs, and hostname.local
- `rootCA.pem` served at `/connect/cert` for client installation
- `NODE_PRIMARY_IP` env var ensures correct host IP shown in Docker container

### 12. iOS App — Node Connection Fix

Fixed `NodeConnectionManager.connect()` to set `customEndpoint` to the full Athena URL (including `/v1/athena` path) instead of just `host:port`. This ensures `ChatService` calls `{baseURL}/chat` → `http://10.0.0.240:3451/v1/athena/chat` instead of `http://10.0.0.240:3451/chat`.

### 13. Installer Updates (v1.7.1)

Updated `mac/scripts/postinstall` with:
- **Step 3.5** — ngrok binary installation (direct download, no Homebrew)
- **Step 4** — Creates `olympus-config/` directory with Hermes god proxy `.env`
- **Step 9.5** — mkcert certificate generation (download binary from GitHub releases)
- **Step 10** — Opens `/connect` page instead of `/nodestatus`

Updated `docker-compose.yml` (served from `turtleshell.ai/install/`):
- Ares and Hermes uncommented and configured
- Hermes has `OLYMPUS_DIR` env var and volume mount for god proxy config
- Dashboard exposes port 718 for HTTP cert downloads
- All health checks use `wget` instead of `curl`

---

## Architecture

### The Complete Flow

```
INSTALLATION:
  .pkg installer → postinstall.sh
    → Docker Desktop
    → Ollama (llama3.2:3b)
    → Tailscale
    → ngrok
    → Fleet manifest (docker-compose.yml from turtleshell.ai)
    → Node identity (UUID, JWT secret)
    → Hermes god proxy config (olympus-config/.env)
    → Docker images (9 services from ghcr.io/olympus-616)
    → Fleet start (docker compose up -d)
    → mkcert HTTPS certificates
    → Open /connect page

ONBOARDING:
  iPhone on same network → http://{ip}:718/connect
    → Download rootCA.pem → Install profile → Trust certificate
    → Scan QR code with TurtleShell iOS app
    → App stores node config (athena URL with /v1/athena path)
    → App switches to custom environment
    → Chat: iPhone → http → Ares (3451) → Hermes (3411) → Athena (3401) → Ollama

SALESFORCE DEPLOYMENT:
  TurtleShell.ai Lightning App → Utility bar → Lightning Container
    → Iris portal (React SPA in iframe)
    → OAuth via VF page callback → LWC Apex exchange → Cookie bridge → Aura → Container
    → Chat: SF iframe → Ares → Hermes → Athena
    → MCP: x-user-identity, x-salesforce-token, x-github-token, x-google-token, x-hubspot-api-key
```

### Service Fleet (9 containers)

| Service | Port | Role |
|---------|------|------|
| Ares | 3451 | API Gateway |
| Hermes | 3411 | Message Transport / God Proxy |
| Athena | 3401 | LLM Router |
| Poseidon | 3431 | MCP Tool Server |
| Mnemosyne | 3711 | Episodic Memory |
| Proteus | 3461 | Universal ORM |
| Plutus | 3701 | Billing & Metering |
| Zeus | 3481 | Fleet Controller |
| TurtleShell Off-Grid | 717/718 | Node Dashboard |

### Repositories Touched

| Repo | Changes |
|------|---------|
| `iris` | 54 new plugin files, Tailwind/CSS updates, Salesforce static resource |
| `olympus-grid` | Lightning app, LWC, Aura, VF pages, Apex, permission set, CSP sites, custom metadata |
| `ares` | Token delivery headers, CORS, JWT cert, grid proxy, Dockerfile |
| `hermes` | Dockerfile fix |
| `turtleshell-web` | docker-compose.yml, installer .pkg, Netlify deploy |
| `turtleshell-offgrid` | postinstall, server.js, Dockerfile, docker-compose |
| `turtleshell-ios` | NodeConnection fix (custom endpoint path) |

---

## Verification

### Salesforce Portal
- [x] TurtleShell.ai app visible in App Launcher
- [x] Home page with hero, services, support tabs
- [x] Utility bar toolbar with chat interface
- [x] Olympus-Grid connected and tested via MCP
- [x] Salesforce connected via OAuth PKCE + Apex exchange
- [x] GitHub connected via PAT
- [x] Google connected via OAuth
- [x] HubSpot connected via Private App token
- [x] All 5 services pass connection tests
- [x] MCP tools working (Salesforce SObjects, GitHub repos, etc.)
- [x] SLDS theme available
- [x] Voice/TTS working via Web Audio API
- [x] Memory and auto-save toggles functional

### Off-Grid Node (Mac Mini)
- [x] 9/9 Docker containers healthy
- [x] Ares → Hermes → Athena chain working
- [x] ngrok tunnel to `athena-616.ngrok.io`
- [x] mkcert HTTPS certificates generated
- [x] `/connect` page accessible from iPhone
- [x] Certificate download and iOS trust installation
- [x] QR code scanned by TurtleShell iOS app
- [x] Chat working: iPhone → Ares → Hermes → Athena → Ollama
- [x] LaunchAgent for auto-start on boot
- [x] Installer v1.7.1 signed and notarized by Apple

---

## Known Limitations

1. **Netlify bandwidth** — Free tier exhausted; installer downloads may 503. Workaround: SCP the .pkg directly.
2. **mkcert -install via SSH** — Requires GUI interaction for macOS keychain trust. Must run on the Mac Mini directly with screen/keyboard.
3. **iOS ATS** — Plain HTTP connections require ATS exception. Local network works but production should use HTTPS.
4. **LWC LockerService** — Cannot write to localStorage or cookies visible to Aura. Data bridging uses cookies set by LWC (sometimes works) + `turtleshell_oauth_result` key polled by Aura.
5. **HubSpot MCP** — Token flows correctly but Athena's tool-calling for `get_hubspot_contacts` has parameter formatting issues (LLM sends schema instead of values).

---

*CloudPremise LLC — brain/1.7.x.x*
*The shell carries everything. No intermediate. No permission. Sovereign.* 🐢
