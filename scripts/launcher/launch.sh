#!/bin/bash
# Launcher for VIDSTR. Started from a macOS .app bundle, so it runs without an
# inherited login shell: PATH, node and npm are resolved here.

PROJECT_DIR="__PROJECT_DIR__"
APP_NAME="__APP_NAME__"
DEV_PORT=5173
URL="http://localhost:${DEV_PORT}"
LOG_DIR="${PROJECT_DIR}/.launcher"
LOG_FILE="${LOG_DIR}/launcher.log"
# The pid handoff lives under ~/Library, not in the project: a Finder-launched
# .app needs a TCC grant to stat files under ~/Documents, and the Stop app has
# no way to ask for one. ~/Library is always reachable.
STATE_DIR="${HOME}/Library/Application Support/VIDSTR Launcher"
PID_FILE="${STATE_DIR}/dev-server.pid"

notify() {
  /usr/bin/osascript -e "display notification \"$1\" with title \"${APP_NAME}\"" >/dev/null 2>&1
}

fail() {
  /usr/bin/osascript -e "display dialog \"$1\" with title \"${APP_NAME}\" buttons {\"Show Log\", \"OK\"} default button \"OK\" with icon stop" \
    2>/dev/null | grep -q "Show Log" && /usr/bin/open -a Console "$LOG_FILE"
  exit 1
}

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >>"$LOG_FILE"
}

mkdir -p "$LOG_DIR" "$STATE_DIR"

# The running dev server keeps appending here, so never truncate mid-session:
# start a fresh log only when nothing is holding it open, otherwise append.
if [ -f "$LOG_FILE" ] && [ -z "$(/usr/sbin/lsof -t "$LOG_FILE" 2>/dev/null)" ]; then
  : >"$LOG_FILE"
fi
echo "" >>"$LOG_FILE"

cd "$PROJECT_DIR" 2>/dev/null || fail "Project folder not found:\n${PROJECT_DIR}\n\nRe-run scripts/launcher/make-launcher.sh after moving the project."

# --- Resolve node/npm -------------------------------------------------------
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# nvm installs are not on the GUI PATH; source it, then fall back to the
# newest installed version directory.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
fi

if ! command -v npm >/dev/null 2>&1; then
  newest_nvm_bin="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1)"
  [ -n "$newest_nvm_bin" ] && export PATH="$newest_nvm_bin:$PATH"
fi

command -v npm >/dev/null 2>&1 || fail "Could not find Node.js and npm.\n\nInstall Node 20 or newer from https://nodejs.org and try again."

log "node: $(command -v node) ($(node -v 2>/dev/null))"
log "npm:  $(command -v npm)"

# --- Already running? -------------------------------------------------------
if /usr/bin/curl -sf -o /dev/null --max-time 2 "$URL"; then
  log "Dev server already running; opening browser."
  /usr/bin/open "$URL"
  exit 0
fi

# A half-dead server holding the port would push vite onto 5174 and make the
# health check never pass.
pids="$(/usr/sbin/lsof -ti "tcp:${DEV_PORT}" -sTCP:LISTEN 2>/dev/null)"
if [ -n "$pids" ]; then
  log "Clearing stale listener on port ${DEV_PORT}: ${pids}"
  echo "$pids" | xargs kill 2>/dev/null
fi

# --- Dependencies -----------------------------------------------------------
if [ ! -d "${PROJECT_DIR}/node_modules" ]; then
  notify "Installing dependencies, this may take a minute…"
  log "Running npm install"
  if ! npm install >>"$LOG_FILE" 2>&1; then
    fail "npm install failed. See the log for details."
  fi
fi

# --- Start the dev server ---------------------------------------------------
notify "Starting up…"
log "Starting: npm run dev"
nohup npm run dev >>"$LOG_FILE" 2>&1 &
DEV_PID=$!
echo "$DEV_PID" >"$PID_FILE"
log "Dev server pid ${DEV_PID}"

# --- Wait for the dev server, then open the browser -------------------------
for _ in $(seq 1 60); do
  if /usr/bin/curl -sf -o /dev/null --max-time 2 "$URL"; then
    log "Dev server is up. Opening ${URL}"
    /usr/bin/open "$URL"
    exit 0
  fi
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    fail "The dev server stopped right after starting. See the log for details."
  fi
  sleep 1
done

fail "Timed out waiting for ${URL} to respond. See the log for details."
