#!/bin/bash
# Builds ポケット家計簿 APK from ../app without Gradle.
set -euo pipefail
cd "$(dirname "$0")"
JAR=/usr/lib/android-sdk/platforms/android-23/android.jar
OUT=build
rm -rf $OUT && mkdir -p $OUT/gen $OUT/obj $OUT/assets/www

# web app -> assets/www (wrap the page in a full document skeleton)
cp -r ../app/parse.js ../app/vendor $OUT/assets/www/
{
  printf '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
  printf '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%%}[hidden]{display:none!important}</style></head><body>'
  cat ../app/index.html
  printf '</body></html>'
} > $OUT/assets/www/index.html

# version.json: web version + SHA-256 of every file, used by the in-app updater
python3 - "$OUT/assets/www" "$(cat WEB_VERSION)" "$(cat MIN_SHELL)" <<'PY'
import hashlib, json, os, sys
root, web, min_shell = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
files = []
for d, _, names in os.walk(root):
    for n in sorted(names):
        full = os.path.join(d, n); rel = os.path.relpath(full, root).replace(os.sep, "/")
        if rel == "version.json": continue
        files.append({"path": rel, "sha256": hashlib.sha256(open(full, "rb").read()).hexdigest()})
files.sort(key=lambda f: f["path"])
json.dump({"web": web, "minShell": min_shell, "files": files}, open(os.path.join(root, "version.json"), "w"), ensure_ascii=False, indent=1)
PY

aapt package -f -m -J $OUT/gen -M AndroidManifest.xml -S res -I $JAR
javac -nowarn --release 8 -classpath $JAR -d $OUT/obj $OUT/gen/jp/kakeibo/pocket/R.java src/jp/kakeibo/pocket/MainActivity.java src/jp/kakeibo/pocket/Updater.java
dalvik-exchange --dex --output=$OUT/classes.dex $OUT/obj
aapt package -f -M AndroidManifest.xml -S res -A $OUT/assets -I $JAR -F $OUT/unsigned.apk -0 wasm
(cd $OUT && aapt add -f unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 $OUT/unsigned.apk $OUT/aligned.apk
[ -f kakeibo.keystore ] || keytool -genkeypair -keystore kakeibo.keystore -storepass kakeibo123 -keypass kakeibo123 \
  -alias kakeibo -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Pocket Kakeibo" >/dev/null 2>&1
apksigner sign --ks kakeibo.keystore --ks-pass pass:kakeibo123 --key-pass pass:kakeibo123 --out PocketKakeibo.apk $OUT/aligned.apk
apksigner verify --print-certs PocketKakeibo.apk | head -2
ls -la PocketKakeibo.apk
