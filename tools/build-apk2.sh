#!/usr/bin/env bash
# Build a release APK from the repository alone — no base APK on disk.
#
#   tools/build-apk2.sh              -> build/KrushiKendra-<ver>.apk
#
# Difference from tools/build-apk.sh: that script extracts the Android shell out
# of the shipped KrushiKendra.apk and needs that file present. The shell
# (classes.dex, AndroidManifest.xml, resources.arsc, res/) is committed under src/
# now, so this script assembles the package from src/ with tools/Assemble.java.
# Everything after assembly is the same: zipalign, v3 sign, then the invariant
# checks.
#
# Still true, and the reason the shell is only ever stored and never recompiled:
# classes.dex serves the app from the fake origin https://app.krushikendra/,
# which is where the shop's IndexedDB lives, and implements the AndroidBridge that
# shim.js uses to write backups into Downloads, to print through the system print
# service and to pick files. resources.arsc must stay STORED or Android cannot
# memory-map it, and the launcher icon, label and theme break.
#
# Verification is against src/ instead of against the old APK: after signing, each
# shell entry is read back out of the finished APK and compared byte-for-byte with
# the file it came from.
#
# Requirements: JDK 17+ (javac, keytool), Android build-tools (zipalign,
# apksigner, aapt). No Gradle, no Android Studio, no base APK, no network.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/build"
SRC="$ROOT/src"
KEYSTORE="${KRUSHI_KEYSTORE:-$HOME/krushikendra-keys/krushikendra-release.jks}"
KEYPASS="${KRUSHI_KEYPASS:-$(cat "$HOME/krushikendra-keys/keystore-password.txt" 2>/dev/null || true)}"

# Highest numerically versioned build-tools only; the sdk folder also holds a
# non-numeric "android-14" directory that `sort -V` would rank last.
BT="${ANDROID_BUILD_TOOLS:-$(ls -d "$HOME"/android-sdk/build-tools/[0-9]*/ 2>/dev/null | sort -V | tail -1)}"

[ -d "$SRC" ]        || { echo "missing src/: $SRC" >&2; exit 1; }
[ -f "$KEYSTORE" ]   || { echo "missing keystore: $KEYSTORE" >&2; exit 1; }
[ -n "$KEYPASS" ]    || { echo "no keystore password: set KRUSHI_KEYPASS" >&2; exit 1; }
[ -x "${BT}zipalign.exe" ] || [ -x "${BT}zipalign" ] || { echo "zipalign not found under $BT" >&2; exit 1; }

ZIPALIGN="${BT}zipalign"; [ -x "$ZIPALIGN" ] || ZIPALIGN="${ZIPALIGN}.exe"
APKSIGNER="java -jar ${BT}lib/apksigner.jar"
AAPT="${BT}aapt.exe"; [ -x "$AAPT" ] || AAPT="${BT}aapt"

mkdir -p "$BUILD/classes"
echo "== compiling assembler"
javac -d "$BUILD/classes" "$ROOT/tools/Assemble.java"

echo "== assembling package from src/"
java -cp "$BUILD/classes" Assemble "$SRC" "$BUILD/unsigned.apk"

echo "== zipalign"
"$ZIPALIGN" -f -p 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

echo "== signing (v3; minSdk 29 makes v1/v2 unnecessary)"
$APKSIGNER sign --ks "$KEYSTORE" --ks-key-alias krushikendra \
  --ks-pass "pass:$KEYPASS" --key-pass "pass:$KEYPASS" \
  --v1-signing-enabled false --v2-signing-enabled false --v3-signing-enabled true \
  --out "$BUILD/signed.apk" "$BUILD/aligned.apk"

# The version label still comes from the binary manifest stored verbatim, so this
# reports 1.13 / versionCode 14. Raising it needs aapt2 to recompile the manifest.
VER="$("$AAPT" dump badging "$BUILD/signed.apk" 2>/dev/null | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)"
[ -n "$VER" ] || { echo "FATAL: aapt could not read the manifest of the built APK" >&2; exit 1; }
OUT="$BUILD/KrushiKendra-$VER.apk"
mv "$BUILD/signed.apk" "$OUT"

echo "== verifying"
$APKSIGNER verify --verbose "$OUT" | grep -i "verifies"
"$ZIPALIGN" -c 4 "$OUT" && echo "alignment ok"
unzip -v "$OUT" | grep "resources.arsc" | grep -q "Stored" \
  || { echo "FATAL: resources.arsc is not STORED; Android cannot memory-map it" >&2; exit 1; }
echo "resources.arsc stored ok"

# Every shell entry must survive assembly, alignment and signing unchanged.
while IFS= read -r -d '' f; do
  rel="${f#"$SRC"/}"
  unzip -p "$OUT" "$rel" > "$BUILD/.a" 2>/dev/null || { echo "FATAL: $rel missing from the APK" >&2; exit 1; }
  cmp -s "$BUILD/.a" "$f" || { echo "FATAL: $rel in the APK differs from src/" >&2; exit 1; }
  echo "shell intact: $rel"
done < <(find "$SRC" -maxdepth 1 -type f -print0; \
         find "$SRC/res" -type f -print0)
rm -f "$BUILD/.a"

# Whole-app smoke test: aapt parsing the manifest and resources proves the binary
# manifest and resources.arsc are structurally readable, which the byte checks
# alone cannot show.
"$AAPT" dump badging "$OUT" >/dev/null || { echo "FATAL: aapt cannot parse the built APK" >&2; exit 1; }
echo "manifest and resources parse ok"
echo "packaged files: $(unzip -l "$OUT" | tail -1 | awk '{print $2}')"

echo
echo "built $OUT"
echo "Signed with the keystore at $KEYSTORE. If a build signed with this same key is"
echo "already on the tablet, this one cannot replace it in place until versionCode is"
echo "raised - and if the key is lost, the next build needs an uninstall, which erases"
echo "that device's records. Take Settings > Backup off the tablet before uninstalling."
