#!/usr/bin/env bash
set -u
PROFILE_NAME="${DSH_PROFILE:-web}"
if [ "${1:-}" = "--profile" ]; then PROFILE_NAME="${2:-web}"; shift 2; fi
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE_NAME"
PID_FILE="$PROFILE_DIR/dsh-supervisor.pid"
LOG_FILE="$PROFILE_DIR/dsh-supervisor.log"
PORT="${DSH_PORT:-3080}"
read_pid() { [ -f "$PID_FILE" ] && cat "$PID_FILE" || true; }
is_running() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null; }
# The pid currently listening on the profile's web port (whoever started it —
# the supervisor OR a manual `dsh web`).
port_pid() { lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }
start_profile() {
  local pid="$(read_pid)"
  if is_running "$pid"; then echo "$PROFILE_NAME profile already running: pid $pid"; return 0; fi
  local listener="$(port_pid)"
  if [ -n "$listener" ]; then
    echo "$listener" > "$PID_FILE"
    echo "$PROFILE_NAME profile already running on port $PORT (not supervised): pid $listener"
    return 0
  fi
  mkdir -p "$PROFILE_DIR"; rm -f "$PID_FILE"
  # Drop the composed leaf config so the booting process creates it fresh.
  # macOS provenance (com.apple.provenance) tags a file with the provenance
  # of its creator and denies other-provenance processes opening it for
  # write; deleting first turns every start into a clean create (creation is
  # never blocked), instead of an overwrite of a foreign-tagged file (EPERM).
  rm -f "$PROFILE_DIR/cordis.yml" "$PROFILE_DIR/cordis.yml.tmp"
  if [ -n "${DSH_REAL_BIN:-}" ] && [ -x "$DSH_REAL_BIN" ]; then nohup "$DSH_REAL_BIN" --profile "$PROFILE_NAME" >>"$LOG_FILE" 2>&1 < /dev/null &
  else command -v npx >/dev/null 2>&1 || { echo "npx is required; install Node.js first" >&2; return 1; }; nohup npx --yes @deepseek-ai/dsh --profile "$PROFILE_NAME" >>"$LOG_FILE" 2>&1 < /dev/null & fi
  pid=$!; echo "$pid" > "$PID_FILE"; echo "started $PROFILE_NAME profile: pid $pid"; echo "log: $LOG_FILE"
}
stop_profile() {
  local pid="$(read_pid)"
  if ! is_running "$pid"; then pid="$(port_pid)"; fi
  if ! is_running "$pid"; then rm -f "$PID_FILE"; echo "$PROFILE_NAME profile is not managed or already stopped"; return 0; fi
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do
    if ! is_running "$pid"; then
      # The wrapper may have died but its node child could still own the
      # port (npm exec trees) — make sure the listener is really gone.
      local leftover="$(port_pid)"
      if [ -n "$leftover" ]; then kill "$leftover" 2>/dev/null || true; fi
      if [ -n "$leftover" ]; then for __ in $(seq 1 10); do [ -z "$(port_pid)" ] && break; sleep 1; done; fi
      rm -f "$PID_FILE"
      echo "stopped $PROFILE_NAME profile: pid $pid"
      return 0
    fi
    sleep 1
  done
  echo "$PROFILE_NAME profile did not stop within 30 seconds" >&2; return 1
}
status_profile() {
  local pid="$(read_pid)"
  if is_running "$pid"; then echo "$PROFILE_NAME profile is running: pid $pid"; echo "url: http://127.0.0.1:$PORT"; return 0; fi
  local listener="$(port_pid)"
  if [ -n "$listener" ]; then echo "$PROFILE_NAME profile is running (not supervised): pid $listener"; echo "url: http://127.0.0.1:$PORT"; return 0; fi
  echo "$PROFILE_NAME profile is not running"; return 1
}
# Detached restart: the stop step kills the profile web server — which is
# exactly the process an in-web-agent (or the harness shell) may be running
# ON. So `restart-detached` re-invokes this supervisor as a fully detached
# child (nohup + disown, survives the launching shell being killed) and
# returns immediately; the child performs stop → start → web probe and writes
# the outcome to a result file the caller can read later.
RESULT_FILE="$PROFILE_DIR/dsh-restart-detached.result"
detached_restart_run() {
  rm -f "$RESULT_FILE"
  echo "profile=$PROFILE_NAME" > "$RESULT_FILE"
  echo "began_at=$(date +%s)" >> "$RESULT_FILE"
  # Heartbeat: proves the worker survived its launch session (if the harness
  # reaps the launching process group, this line never appears).
  echo "worker_alive=yes" >> "$RESULT_FILE"
  # Give the launching shell time to deliver its tool result before 3080
  # drops (the child is detached, so this sleep only delays the bounce).
  sleep 1
  if ! stop_profile; then echo "stop=failed" >> "$RESULT_FILE"; echo "result=error" >> "$RESULT_FILE"; exit 1; fi
  echo "stop=ok" >> "$RESULT_FILE"
  if ! start_profile; then echo "start=failed" >> "$RESULT_FILE"; echo "result=error" >> "$RESULT_FILE"; exit 1; fi
  echo "start=ok" >> "$RESULT_FILE"
  local code=000
  for _ in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:$PORT/" || true)
    [ "$code" = "200" ] && break
    sleep 1
  done
  {
    echo "web_status=$code"
    echo "boot_ok=$([ "$code" = "200" ] && echo yes || echo no)"
    echo "listener_pid=$(port_pid)"
    echo "cordis_yml=$([ -f "$PROFILE_DIR/cordis.yml" ] && echo present || echo missing)"
    echo "finished_at=$(date +%s)"
    echo "result=$([ "$code" = "200" ] && echo ok || echo failed)"
  } >> "$RESULT_FILE"
}
restart_detached() {
  # Launch the worker in its OWN session (perl fork + setsid) so it leaves
  # this process group entirely: when the launching shell's job is reaped,
  # the worker and the server it spawns are not collateral. macOS has no
  # `setsid` binary and its perl needs POSIX for setsid, hence this line.
  perl -e 'use POSIX qw(setsid); exit if fork; setsid(); exec @ARGV' \
    bash "$0" --profile "$PROFILE_NAME" __detached-restart__ \
    >>"$LOG_FILE" 2>&1 < /dev/null &
  disown 2>/dev/null || true
  echo "restart scheduled (detached): profile $PROFILE_NAME"
  echo "outcome: $RESULT_FILE"
}
case "${1:-status}" in
  start) start_profile ;;
  stop) stop_profile ;;
  # restart is ALWAYS detached: it returns immediately, the worker bounces
  # the server in its own session (safe from any side — terminal, agent,
  # harness), and the outcome lands in the result file. `restart-sync`
  # keeps the old blocking behavior for scripts that want to wait.
  restart|restart-detached|restart-d) restart_detached ;;
  restart-sync) stop_profile || exit $?; start_profile ;;
  __detached-restart__) detached_restart_run ;;
  status) status_profile ;;
  *) echo "usage: dsh [start|stop|restart|restart-detached|status] | dsh web | dsh --profile web" >&2; exit 2 ;;
esac
