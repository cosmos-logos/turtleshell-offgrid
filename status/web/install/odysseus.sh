#!/bin/bash
# ═══════════════════════════════════════════════════════
# ODYSSEUS — Off-Grid Fleet Manager
# ═══════════════════════════════════════════════════════
# Manages the TurtleShell off-grid fleet on local hardware.
# Pulls the Pantheon image (same as AWS), starts the fleet,
# verifies health, and keeps it running.
#
# Usage:
#   bash odysseus.sh              # Run locally on the off-grid device
#   ssh user@device bash odysseus.sh  # Run remotely via SSH
#
# The fleet runs as a single Pantheon Docker container
# (identical to the AWS ECS deployment) plus the
# turtleshell-offgrid dashboard.
# ═══════════════════════════════════════════════════════

export OLYMPUS_MODE=offgrid

# ── Resolve fleet directory ──────────────────────────────
FLEET_DIR="${FLEET_DIR:-$HOME/turtleshell}"
FLEET_ENV="${FLEET_DIR}/.env"
FLEET_COMPOSE="${FLEET_DIR}/docker-compose.yml"
DATA_DIR="${HOME}/.turtleshell"

echo ""
echo "  ═══════════════════════════════════════════════"
echo "  ║     T U R T L E S H E L L                   ║"
echo "  ║     O F F - G R I D   F L E E T             ║"
echo "  ═══════════════════════════════════════════════"
echo ""
echo "  Fleet dir: ${FLEET_DIR}"
echo ""

# ── Docker preflight ─────────────────────────────────────
DOCKER=""
for p in /usr/local/bin/docker /usr/bin/docker /opt/homebrew/bin/docker "/Applications/Docker.app/Contents/Resources/bin/docker"; do
  if [ -x "$p" ]; then DOCKER="$p"; break; fi
done

if [ -z "$DOCKER" ]; then
  echo "  ERROR: Docker not found. Install Docker Desktop first."
  echo "  https://www.docker.com/products/docker-desktop/"
  exit 1
fi

# Wait for Docker daemon
if ! "$DOCKER" info &>/dev/null; then
  echo "  Starting Docker..."
  open -a Docker 2>/dev/null || true
  for i in $(seq 1 60); do
    if "$DOCKER" info &>/dev/null; then break; fi
    sleep 2
  done
  if ! "$DOCKER" info &>/dev/null; then
    echo "  ERROR: Docker daemon not responding after 120 seconds"
    exit 1
  fi
fi
echo "  Docker: ready"

# ── Ensure directories ───────────────────────────────────
mkdir -p "$FLEET_DIR" "$DATA_DIR/keys" "$DATA_DIR/data" "$DATA_DIR/logs"

# ── Generate .env if missing ─────────────────────────────
if [ ! -f "$FLEET_ENV" ]; then
  echo "  Generating .env..."
  NODE_ID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c "import uuid; print(uuid.uuid4())")
  JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)
  cat > "$FLEET_ENV" <<ENVEOF
# TurtleShell Off-Grid Fleet Configuration
# Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
NODE_ID=${NODE_ID}
NODE_ENV=local
JWT_SECRET=${JWT_SECRET}

# LLM API Keys (optional — Ollama works without keys)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GROK_API_KEY=
GEMINI_API_KEY=

# Ollama (local LLM — runs on host, accessed via host.docker.internal)
OLLAMA_BASE_URL=http://host.docker.internal:11434
ATHENA_AI_TYPE=local

# Cosmos-Logos private keys (generated at install, used for handshake)
COSMOS_LOGOS_PRIVATE_KEY=
COSMOS_LOGOS_POSEIDON_PRIVATE_KEY=
ENVEOF
  echo "  .env created at ${FLEET_ENV}"
fi

# ── Generate docker-compose.yml ──────────────────────────
echo "  Writing docker-compose.yml..."
cat > "$FLEET_COMPOSE" <<'COMPOSEEOF'
# ═══════════════════════════════════════════════════════════
# TurtleShell Off-Grid Fleet — Docker Compose
# ═══════════════════════════════════════════════════════════
# Single Pantheon container (same image as AWS ECS) + dashboard.
# odysseus.sh manages this compose file.
# ═══════════════════════════════════════════════════════════

networks:
  olympus-internal:
    driver: bridge

volumes:
  turtleshell-data:
    driver: local

services:
  # ── Pantheon — All gods in one container ───────────────
  pantheon:
    image: ghcr.io/olympus-616/pantheon:latest
    container_name: pantheon
    restart: unless-stopped
    ports:
      - "3401:3401"   # Athena (LLM)
      - "3411:3411"   # Hermes (routing)
      - "3421:3421"   # Apollo (TTS)
      - "3431:3431"   # Poseidon (MCP)
      - "3451:3451"   # Ares (gateway)
      - "3461:3461"   # Proteus (data)
      - "3481:3481"   # Zeus (fleet)
      - "3701:3701"   # Plutus (metering)
      - "3711:3711"   # Mnemosyne (memory)
      - "3741:3741"   # Prometheus (jobs)
      - "615:615"     # Control plane
    env_file: .env
    environment:
      - NODE_ENV=production
      - ARES_API=http://localhost:3451
      - HERMES_API=http://localhost:3411
      - ATHENA_API=http://localhost:3401
      - POSEIDON_API=http://localhost:3431
      - MNEMOSYNE_URL=http://localhost:3711
      - PROTEUS_URL=http://localhost:3461
      - PLUTUS_URL=http://localhost:3701
      - OLLAMA_BASE_URL=${OLLAMA_BASE_URL:-http://host.docker.internal:11434}
      - OLLAMA_HOST=${OLLAMA_BASE_URL:-http://host.docker.internal:11434}
      - MCP_SERVER_URL=http://localhost:3431/v1/poseidon/mcp/poc/mcp
    command: sh -c "env > /app/.env && exec pm2-runtime pm2.config.js"
    volumes:
      - turtleshell-data:/app/data
    networks:
      - olympus-internal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3451/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 180s

  # ── TurtleShell Off-Grid Dashboard ─────────────────────
  turtleshell-offgrid:
    image: ghcr.io/cosmos-logos/turtleshell-offgrid:latest
    container_name: turtleshell-offgrid
    restart: unless-stopped
    ports:
      - "717:717"
      - "718:718"
    environment:
      - PORT=717
      - FLEET_HOST=pantheon
      - NODE_ENV=local
    volumes:
      - ${HOME:-.}/.turtleshell:/root/.turtleshell
      - ${HOME:-.}/turtleshell:/fleet
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - olympus-internal
    depends_on:
      pantheon:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:717/health"]
      interval: 30s
      timeout: 10s
      retries: 3
COMPOSEEOF
echo "  docker-compose.yml written"

# ── Authenticate to GHCR ────────────────────────────────
# Check if we can pull the image (try without auth first)
if ! "$DOCKER" pull ghcr.io/olympus-616/pantheon:latest --quiet 2>/dev/null; then
  # Try registry token from turtleshell.ai
  echo "  Authenticating to GHCR..."
  REGISTRY_TOKEN=$(curl -sf https://turtleshell.ai/install/registry-token 2>/dev/null || echo "")
  if [ -n "$REGISTRY_TOKEN" ]; then
    echo "$REGISTRY_TOKEN" | "$DOCKER" login ghcr.io -u olympus-616 --password-stdin 2>/dev/null
  else
    echo "  WARNING: Could not fetch registry token. Image pull may fail."
  fi
fi

# ── Pull latest images ───────────────────────────────────
echo "  Pulling latest Pantheon image..."
cd "$FLEET_DIR"
"$DOCKER" compose pull 2>&1 | grep -v "^$"

# ── Start or restart fleet ───────────────────────────────
RUNNING=$("$DOCKER" compose ps --status running -q 2>/dev/null | wc -l | tr -d ' ')
if [ "$RUNNING" -gt 0 ]; then
  echo "  Fleet is running — recreating with latest image..."
  "$DOCKER" compose up -d --force-recreate 2>&1 | grep -v "^$"
else
  echo "  Starting fleet..."
  "$DOCKER" compose up -d 2>&1 | grep -v "^$"
fi

# ── Wait for health ──────────────────────────────────────
echo ""
echo "  Waiting for fleet health..."
for i in $(seq 1 60); do
  if curl -sf http://localhost:3451/health &>/dev/null; then
    break
  fi
  sleep 3
  printf "\r  Waiting... %ds" $((i * 3))
done
echo ""

# ── Health check ─────────────────────────────────────────
echo ""
echo "  ═══════════════════════════════════════════════"
echo "  ║     F L E E T   S T A T U S                 ║"
echo "  ═══════════════════════════════════════════════"
echo ""

SERVICES="ares:3451 hermes:3411 athena:3401 poseidon:3431 mnemosyne:3711 proteus:3461 plutus:3701 zeus:3481 apollo:3421 prometheus:3741"
ALL_OK=true
for svc in $SERVICES; do
  NAME="${svc%%:*}"
  PORT="${svc##*:}"
  if curl -sf "http://localhost:${PORT}/health" &>/dev/null; then
    printf "  %-15s ✅ healthy (:%s)\n" "$NAME" "$PORT"
  else
    printf "  %-15s ❌ down    (:%s)\n" "$NAME" "$PORT"
    ALL_OK=false
  fi
done

# Dashboard
if curl -sf http://localhost:717/health &>/dev/null; then
  printf "  %-15s ✅ healthy (:717)\n" "dashboard"
else
  printf "  %-15s ❌ down    (:717)\n" "dashboard"
  ALL_OK=false
fi

echo ""
if [ "$ALL_OK" = true ]; then
  echo "  🐢 Fleet is online. Open http://localhost:717"
else
  echo "  ⚠️  Some services are not healthy yet."
  echo "  Run: docker compose -f ${FLEET_COMPOSE} logs"
fi
echo ""
