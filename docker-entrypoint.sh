#!/bin/sh
set -eu

escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

runtime_env_path="/app/public/runtime-env.js"

enable_analytics="$(escape "${NEXT_PUBLIC_ENABLE_ANALYTICS:-}")"
askld_url="$(escape "${NEXT_PUBLIC_ASKLD_URL:-}")"

cat > "$runtime_env_path" <<EOF
window.__RUNTIME_ENV__ = {
  NEXT_PUBLIC_ENABLE_ANALYTICS: "${enable_analytics}",
  NEXT_PUBLIC_ASKLD_URL: "${askld_url}"
};
EOF

exec node server.js
