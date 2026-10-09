#!/usr/bin/env bash
# Run the 5etools server and ngrok tunnel as one self-healing Linux stack.
#
# Optional environment variables:
#   NODE_BIN=/path/to/node       Node binary to use (default: node)
#   NGROK_BIN=/path/to/ngrok     ngrok binary to expose to start-tunnel.js
#   RESTART_SECONDS=43200        Scheduled full-refresh interval (default: 12h)

set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"
NGROK_BIN="${NGROK_BIN:-ngrok}"
RESTART_SECONDS="${RESTART_SECONDS:-43200}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-45}"

server_pid=""
tunnel_pid=""

log() {
	printf '[linux-stack] %s\n' "$*"
}

stop_stack() {
	for pid in "$tunnel_pid" "$server_pid"; do
		if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
			kill "$pid" 2>/dev/null || true
		fi
	done

	for pid in "$tunnel_pid" "$server_pid"; do
		if [[ -n "$pid" ]]; then
			wait "$pid" 2>/dev/null || true
		fi
	done

	server_pid=""
	tunnel_pid=""
}

cleanup() {
	log 'Stopping server and tunnel.'
	stop_stack
}

trap cleanup EXIT INT TERM

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "Required command not found: $1" >&2
		exit 1
	fi
}

update_repository() {
	if ! git diff --quiet || ! git diff --cached --quiet; then
		log 'Working tree has local changes; skipping automatic update.'
		return
	fi

	log 'Checking for updates.'
	if ! git pull --ff-only origin main; then
		log 'Update check failed; continuing with the current revision.'
	fi
}

wait_for_server() {
	local started_at now
	started_at="$(date +%s)"

	while true; do
		if curl --fail --silent --show-error --output /dev/null http://127.0.0.1:3000/; then
			return 0
		fi

		if ! kill -0 "$server_pid" 2>/dev/null; then
			return 1
		fi

		now="$(date +%s)"
		if (( now - started_at >= HEALTH_TIMEOUT_SECONDS )); then
			return 1
		fi

		sleep 1
	done
}

start_stack() {
	update_repository

	log 'Starting app server on port 3000.'
	"$NODE_BIN" server.js &
	server_pid="$!"

	if ! wait_for_server; then
		log 'App server did not become healthy.'
		return 1
	fi

	log 'Starting ngrok tunnel proxy.'
	"$NODE_BIN" start-tunnel.js &
	tunnel_pid="$!"
}

require_command "$NODE_BIN"
require_command "$NGROK_BIN"
require_command curl

# start-tunnel.js spawns `ngrok` by name. Make an explicitly configured binary
# available to that child process as well.
export PATH="$(dirname "$(command -v "$NGROK_BIN")"):$PATH"

cd "$PROJECT_DIR"

while true; do
	if ! start_stack; then
		stop_stack
		log 'Retrying stack startup in 5 seconds.'
		sleep 5
		continue
	fi

	log "Stack is healthy; scheduled refresh in ${RESTART_SECONDS}s."
	deadline=$(( $(date +%s) + RESTART_SECONDS ))

	while kill -0 "$server_pid" 2>/dev/null && kill -0 "$tunnel_pid" 2>/dev/null; do
		if (( $(date +%s) >= deadline )); then
			log 'Scheduled refresh is due.'
			break
		fi
		sleep 5
	done

	if ! kill -0 "$server_pid" 2>/dev/null || ! kill -0 "$tunnel_pid" 2>/dev/null; then
		log 'A stack process exited; restarting both services.'
	fi

	stop_stack
	log 'Restarting stack in 2 seconds.'
	sleep 2
done
