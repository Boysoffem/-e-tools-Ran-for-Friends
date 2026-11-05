#!/bin/sh
# Convenient launcher for this installation's bundled Node runtime.
set -eu
login_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
login_node="${NODE_BIN:-node}"
if ! command -v "$login_node" >/dev/null 2>&1; then
	login_node="$login_root/../.runtime/node-v24.21.0-linux-x64/bin/node"
fi
if [ ! -x "$login_node" ] && ! command -v "$login_node" >/dev/null 2>&1; then
	echo 'Node.js 24 or newer is needed to run login setup.' >&2
	exit 1
fi
cd "$login_root"
exec "$login_node" scripts/setup-auth.mjs "$@"
