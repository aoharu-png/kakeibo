#!/bin/bash
# Publishes the current app to the GitHub repo so installed apps update themselves.
#   ./release.sh "message"          web-only update (bumps WEB_VERSION)
#   SHELL_UPDATE=1 ./release.sh ...  also requires the new APK (set MIN_SHELL to the manifest versionCode first)
set -euo pipefail
cd "$(dirname "$0")"
REPO=${REPO:-/home/claude/kakeibo/repo}
echo $(( $(cat WEB_VERSION) + 1 )) > WEB_VERSION
bash build.sh >/dev/null
rm -rf "$REPO/www" && mkdir -p "$REPO/www" "$REPO/dist" "$REPO/src"
cp -r build/assets/www/. "$REPO/www/"
cp PocketKakeibo.apk "$REPO/dist/PocketKakeibo.apk"
rm -rf "$REPO/src/android" "$REPO/src/app" && mkdir -p "$REPO/src/android" "$REPO/src/app"
tar --exclude=./build --exclude='*.keystore' --exclude='*.apk' -cf - . | tar -xf - -C "$REPO/src/android"   # never publish the signing key
(cd ../app && tar -cf - --exclude=./vendor . | tar -xf - -C "$REPO/src/app")
cd "$REPO"
git add -A
git commit -q -m "${1:-Update} (web $(python3 -c 'import json;print(json.load(open("www/version.json"))["web"])'))" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_0196d3DEZDfMegpXLafD1DqR"
git push -q origin HEAD:main
git log --oneline -1
