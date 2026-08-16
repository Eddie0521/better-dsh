#!/usr/bin/env bash
set -u
PROFILE_NAME="${DSH_PROFILE:-web}"
if [ "${1:-}" = "--profile" ]; then PROFILE_NAME="${2:-web}"; shift 2; fi
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE_NAME"
PID_FILE="$PROFILE_DIR/dsh-supervisor.pid"
LOG_FILE="$PROFILE_DIR/dsh-supervisor.log"
read_pid() { [ -f "$PID_FILE" ] && cat "$PID_FILE" || true; }
is_running() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null; }
start_profile() {
  local pid="$(read_pid)"
  if is_running "$pid"; then echo "$PROFILE_NAME profile already running: pid $pid"; return 0; fi
  mkdir -p "$PROFILE_DIR"; rm -f "$PID_FILE"
  if [ -n "${DSH_REAL_BIN:-}" ] && [ -x "$DSH_REAL_BIN" ]; then nohup "$DSH_REAL_BIN" --profile "$PROFILE_NAME" >>"$LOG_FILE" 2>&1 < /dev/null &
  else command -v npx >/dev/null 2>&1 || { echo "npx is required; install Node.js first" >&2; return 1; }; nohup npx --yes @deepseek-ai/dsh --profile "$PROFILE_NAME" >>"$LOG_FILE" 2>&1 < /dev/null & fi
  pid=$!; echo "$pid" > "$PID_FILE"; echo "started $PROFILE_NAME profile: pid $pid"; echo "log: $LOG_FILE"
}
stop_profile() {
  local pid="$(read_pid)"
  if ! is_running "$pid"; then rm -f "$PID_FILE"; echo "$PROFILE_NAME profile is not managed or already stopped"; return 0; fi
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do if ! is_running "$pid"; then rm -f "$PID_FILE"; echo "stopped $PROFILE_NAME profile: pid $pid"; return 0; fi; sleep 1; done
  echo "$PROFILE_NAME profile did not stop within 30 seconds" >&2; return 1
}
status_profile() { local pid="$(read_pid)"; if is_running "$pid"; then echo "$PROFILE_NAME profile is running: pid $pid"; echo "url: http://127.0.0.1:3080"; return 0; fi; echo "$PROFILE_NAME profile is not managed"; return 1; }
case "${1:-status}" in start) start_profile ;; stop) stop_profile ;; restart) stop_profile || exit $?; start_profile ;; status) status_profile ;; *) echo "usage: dsh [start|stop|restart|status] | dsh --profile web" >&2; exit 2 ;; esac
