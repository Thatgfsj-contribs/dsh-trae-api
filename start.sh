#!/usr/bin/env bash
#
# Trae Local API - one-click launcher for Linux / macOS.
# Windows users: use start.bat instead.
#
# First run decrypts the local Trae credentials into .env; later runs just start
# the proxy server.
#
set -u

cd "$(dirname "$0")" || exit 1

echo
echo "========================================"
echo "  Trae Local API - One Click Start"
echo "========================================"
echo

# Listen port: an exported PORT wins, then .env, then 9220.
if [ -z "${PORT:-}" ]; then
  PORT="9220"
  if [ -f .env ]; then
    env_port="$(sed -n 's/^PORT=//p' .env | tail -1 | tr -d '\r' | tr -d ' ')"
    if [ -n "$env_port" ]; then
      PORT="$env_port"
    fi
  fi
fi

if [ -f .env ] && grep -q '^TRAE_TOKEN=eyJ' .env; then
  echo "[info] Found .env with valid token"
else
  # No valid .env, run setup first (auto-detects 4 editions)
  echo "[info] First run, decrypting Trae config..."
  echo
  if ! node setup.cjs; then
    echo
    echo "[error] Setup failed! Make sure any Trae IDE is installed and logged in."
    echo "        Supported: Trae CN / TRAE SOLO CN / Trae SG / TRAE SOLO"
    exit 1
  fi
  echo
fi

# Port cleanup: only stop a previous instance of *this* server. Anything else
# listening on the port (for example an unrelated service) is reported instead
# of being killed.
is_trae_api_process() {
  local cmd
  cmd="$(ps -p "$1" -o args= 2>/dev/null || true)"
  case "$cmd" in
    *src/server.js* | *dsh-trae-api* | *trae-local-api*) return 0 ;;
    *) return 1 ;;
  esac
}

pids=""
if command -v lsof >/dev/null 2>&1; then
  pids="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
elif command -v fuser >/dev/null 2>&1; then
  pids="$(fuser -n tcp "${PORT}" 2>/dev/null || true)"
fi

if [ -n "${pids}" ]; then
  killable=""
  foreign=""
  for pid in ${pids}; do
    if is_trae_api_process "$pid"; then
      killable="${killable} ${pid}"
    else
      foreign="${foreign} ${pid}"
    fi
  done

  if [ -n "${foreign}" ]; then
    echo "[error] Port ${PORT} is already used by another process:${foreign}"
    echo "        Refusing to kill it. Stop that process, or set another port:"
    echo "          PORT=9321 ./start.sh"
    exit 1
  fi

  if [ -n "${killable}" ]; then
    echo "[info] Stopping previous server on port ${PORT} (PID:${killable})"
    # shellcheck disable=SC2086
    kill ${killable} 2>/dev/null || true
    sleep 1
  fi
fi

echo "Starting server on port ${PORT}..."
echo
exec node src/server.js
