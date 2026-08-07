#!/bin/bash
# Stops the dev server started by the VIDSTR launcher.
#
# This app deliberately depends on nothing inside the project folder. Launched
# from Finder it gets no TCC grant for ~/Documents, so a stat of anything under
# the project silently fails — the pid handoff and this app's log both live
# under ~/Library instead. The project log is written only when reachable.

PROJECT_DIR="__PROJECT_DIR__"
APP_NAME="__APP_NAME__"
DEV_PORT=5173
STATE_DIR="${HOME}/Library/Application Support/VIDSTR Launcher"
PID_FILE="${STATE_DIR}/dev-server.pid"
STATE_LOG="${STATE_DIR}/stop.log"
PROJECT_LOG="${PROJECT_DIR}/.launcher/launcher.log"

log() {
  local line="[$(date '+%Y-%m-%d %H:%M:%S')] stop: $1"
  mkdir -p "$STATE_DIR" 2>/dev/null
  echo "$line" >>"$STATE_LOG" 2>/dev/null
  # Best effort: only lands when this app can reach the project folder.
  echo "$line" >>"$PROJECT_LOG" 2>/dev/null
}

stopped=0

if [ -f "$PID_FILE" ]; then
  pid="$(cat "$PID_FILE" 2>/dev/null)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    # Kill the process group where there is one, so vite goes down with npm.
    log "terminating dev server pid ${pid}"
    kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    stopped=1
  else
    log "pid file present but process ${pid:-?} is already gone"
  fi
  rm -f "$PID_FILE"
fi

pids="$(/usr/sbin/lsof -ti "tcp:${DEV_PORT}" -sTCP:LISTEN 2>/dev/null)"
if [ -n "$pids" ]; then
  log "killing listener(s) on port ${DEV_PORT}: ${pids}"
  echo "$pids" | xargs kill 2>/dev/null
  stopped=1
fi

sleep 1

# Anything still holding the port gets a hard kill.
pids="$(/usr/sbin/lsof -ti "tcp:${DEV_PORT}" -sTCP:LISTEN 2>/dev/null)"
if [ -n "$pids" ]; then
  log "force killing: ${pids}"
  echo "$pids" | xargs kill -9 2>/dev/null
fi

log "finished (stopped=${stopped})"

if [ "$stopped" -eq 1 ]; then
  /usr/bin/osascript -e "display notification \"Dev server stopped.\" with title \"${APP_NAME}\"" >/dev/null 2>&1
else
  /usr/bin/osascript -e "display notification \"Nothing was running.\" with title \"${APP_NAME}\"" >/dev/null 2>&1
fi
