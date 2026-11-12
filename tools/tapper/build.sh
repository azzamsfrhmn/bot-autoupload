#!/usr/bin/env bash
# Build APK tap-server tanpa gradle (aapt2 + javac + d8 + apksigner).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${LOCALAPPDATA:-$HOME/AppData/Local}/Android/Sdk"
BT="$SDK/build-tools/36.0.0"
AJ="$SDK/platforms/android-37.0/android.jar"
# Folder build di TEMP (tanpa spasi) supaya d8/@argfile tidak rusak.
OUT="${TEMP:-/tmp}/tapper_build"
rm -rf "$OUT"; mkdir -p "$OUT/dex" "$OUT/classes"

echo "[1/6] aapt2 compile res"
"$BT/aapt2.exe" compile --dir "$HERE/res" -o "$OUT/res.zip"

echo "[2/6] aapt2 link -> base.apk"
"$BT/aapt2.exe" link -o "$OUT/base.apk" -I "$AJ" \
  --manifest "$HERE/AndroidManifest.xml" \
  --min-sdk-version 24 --target-sdk-version 30 \
  "$OUT/res.zip"

echo "[3/6] javac"
: > "$OUT/srcs.txt"
while IFS= read -r p; do echo "\"$(cygpath -m "$p")\"" >> "$OUT/srcs.txt"; done < <(find "$HERE/src" -name '*.java')
javac --release 11 -cp "$(cygpath -m "$AJ")" -d "$(cygpath -m "$OUT/classes")" "@$(cygpath -m "$OUT/srcs.txt")"

echo "[4/6] d8 -> classes.dex"
# $OUT di TEMP tanpa spasi -> d8 @argfile aman tanpa kutip.
: > "$OUT/classes.txt"
while IFS= read -r p; do cygpath -m "$p" >> "$OUT/classes.txt"; done < <(find "$OUT/classes" -name '*.class')
"$BT/d8.bat" --min-api 24 --lib "$(cygpath -m "$AJ")" --output "$(cygpath -m "$OUT/dex")" "@$(cygpath -m "$OUT/classes.txt")"

echo "[5/6] masukkan dex + align"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
jar uf "$(cygpath -m "$OUT/unsigned.apk")" -C "$(cygpath -m "$OUT/dex")" classes.dex
"$BT/zipalign.exe" -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "[6/6] sign"
KS="$HERE/debug.keystore"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US"
fi
"$BT/apksigner.bat" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --out "$HERE/tapper.apk" "$OUT/aligned.apk"
echo "OK -> $HERE/tapper.apk"
