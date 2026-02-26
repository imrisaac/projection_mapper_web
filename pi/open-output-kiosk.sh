#!/usr/bin/env bash
set -euo pipefail

OUTPUT_URL="${1:-http://localhost:8080/?mode=output}"

export DISPLAY=:0
export XAUTHORITY="${XAUTHORITY:-/home/pi/.Xauthority}"

/usr/bin/chromium-browser \
  --kiosk \
  --incognito \
  --noerrdialogs \
  --disable-infobars \
  --autoplay-policy=no-user-gesture-required \
  --check-for-update-interval=31536000 \
  "$OUTPUT_URL"
