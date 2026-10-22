#!/usr/bin/env bash
# Build a release APK from the working tree, keeping the installed app's shell.
#
#   tools/build-apk.sh                 -> build/KrushiKendra-<ver>.apk
#
# What it does and why:
#   * classes.dex, AndroidManifest.xml, resources.arsc and res/* are copied out of
#     BASE_APK byte-for-byte. That shell serves the app from the fake origin
#     https://app.krushikendra/ (where the shop's IndexedDB lives), implements the
#     AndroidBridge that writes backups into Downloads, hooks printing and routes
#     the back button. None of it is recompiled, so none of it can drift.
#   * The web content under src/assets replaces assets/*, and the old META-INF
#     signature block is dropped.
#   * zipalign must run before signing; resources.arsc has to stay STORED or
#     Android cannot memory-map it.
#   * Signing uses the release keystore. Losing this keystore means every device
#     must be uninstalled and reinstalled, which erases on-device records: keep a
#     copy of KRUSHI_KEYSTORE and KRUSHI_KEYPASS somewhere that outlives this PC.
#
# Requirements: JDK 17+ (javac, keytool), Android build-tools (zipalign,
# apksigner), and BASE_APK present. Nothing else - no Gradle, no Android Studio.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
BASE_APK="${BASE_APK:-$ROOT/KrushiKendra.apk}"
KEYSTORE="${KRUSHI_KEYSTORE:-$HOME/krushikendra-keys/krushikendra-release.jks}"
KEYPASS="${KRUSHI_KEYPASS:-$(cat "$HOME/krushikendra-keys/keystore-password.txt" 2>/dev/null || true)}"
BT="${ANDROID_BUILD_TOOLS:-$(ls -d "$HOME"/android-sdk/build-tools/*/ 2>/dev/null | sort -V | tail -1)}"

[ -f "$BASE_APK" ]   || { echo "missing base APK: $BASE_APK" >&2; exit 1; }
[ -f "$KEYSTORE" ]   || { echo "missing keystore: $KEYSTORE" >&2; exit 1; }
[ -n "$KEYPASS" ]    || { echo "no keystore password: set KRUSHI_KEYPASS" >&2; exit 1; }
[ -x "${BT}zipalign.exe" ] || [ -x "${BT}zipalign" ] || { echo "zipalign not found under $BT" >&2; exit 1; }

ZIPALIGN="${BT}zipalign"; APKSIGNER="java -jar ${BT}lib/apksigner.jar"
[ -x "$ZIPALIGN" ] || ZIPALIGN="${ZIPALIGN}.exe"

# The version label lives in the binary manifest that is copied verbatim, so it
# cannot be bumped by this script. versionCode must go up before any in-place
# update over an installed build; see README for rebuilding the manifest.
VER="$("$BT/aapt.exe" dump badging "$BASE_APK" 2>/dev/null | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)"
OUT="$BUILD/KrushiKendra-$VER.apk"

mkdir -p "$BUILD/classes"
echo "== compiling repacker"
javac -d "$BUILD/classes" "$ROOT/tools/Repak.java"

echo "== repacking web content into the original shell"
java -cp "$BUILD/classes" Repak "$BASE_APK" "$BUILD/patched.unsigned.apk" "$ROOT/src/assets"

echo "== zipalign"
"$ZIPALIGN" -f -p 4 "$BUILD/patched.unsigned.apk" "$BUILD/aligned.apk"

echo "== signing (v3; minSdk 29 makes v1/v2 unnecessary)"
$APKSIGNER sign --ks "$KEYSTORE" --ks-key-alias krushikendra \
  --ks-pass "pass:$KEYPASS" --key-pass "pass:$KEYPASS" \
  --v1-signing-enabled false --v2-signing-enabled false --v3-signing-enabled true \
  --out "$OUT" "$BUILD/aligned.apk"

echo "== verifying"
$APKSIGNER verify --verbose "$OUT" | grep -i "verifies"
"$ZIPALIGN" -c 4 "$OUT" && echo "alignment ok"
unzip -v "$OUT" | grep "resources.arsc" | grep -q "Stored" \
  || { echo "FATAL: resources.arsc is not STORED; Android cannot memory-map it" >&2; exit 1; }
echo "resources.arsc stored ok"
for f in classes.dex AndroidManifest.xml resources.arsc; do
  unzip -p "$BASE_APK" "$f" > "$BUILD/.a" ; unzip -p "$OUT" "$f" > "$BUILD/.b"
  cmp -s "$BUILD/.a" "$BUILD/.b" || { echo "FATAL: $f differs from the installed shell" >&2; exit 1; }
  echo "shell intact: $f"
done
rm -f "$BUILD/.a" "$BUILD/.b" "$BUILD/patched.unsigned.apk" "$BUILD/aligned.apk"

echo
echo "built $OUT"
echo "Take the phone's Settings > Backup before installing: this APK is signed with a"
echo "different key to the one on the tablet, so Android will require uninstalling first."
