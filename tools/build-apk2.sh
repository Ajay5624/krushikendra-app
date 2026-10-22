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

# Every build must be installable as an update over the one before it, which
# Android only allows when versionCode rises. The manifest is stored verbatim, so
# the version is stamped into it at assembly time rather than recompiled.
# Commit count is monotonic with the code and needs no state file; the label is
# derived from it at a fixed width because an in-place patch cannot resize the
# string it lives in.
if [ -d "$ROOT/.git" ]; then
  CODE="$(git -C "$ROOT" rev-list --count HEAD)"
else
  echo "FATAL: no git history to take the version from (shallow clone?)" >&2; exit 1
fi
[ "$CODE" -gt 14 ] || { echo "FATAL: versionCode $CODE is not above the 14 already shipped" >&2; exit 1; }
NAME="$(printf "%d.%02d" $((1 + CODE / 100)) $((CODE % 100)))"
echo "== version $NAME (versionCode $CODE)"

echo "== assembling package from src/"
java -cp "$BUILD/classes" Assemble "$SRC" "$BUILD/unsigned.apk" "$CODE" "$NAME"

echo "== zipalign"
"$ZIPALIGN" -f -p 4 "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

echo "== signing (v3; minSdk 29 makes v1/v2 unnecessary)"
$APKSIGNER sign --ks "$KEYSTORE" --ks-key-alias krushikendra \
  --ks-pass "pass:$KEYPASS" --key-pass "pass:$KEYPASS" \
  --v1-signing-enabled false --v2-signing-enabled false --v3-signing-enabled true \
  --out "$BUILD/signed.apk" "$BUILD/aligned.apk"

# Read the version back out of the signed APK: if the stamp did not survive
# zipalign, signing and Android's own parser, the build is wrong.
BADGE="$("$AAPT" dump badging "$BUILD/signed.apk" 2>/dev/null | head -1)"
GOT_CODE="$(printf '%s' "$BADGE" | sed -n "s/.*versionCode='\([^']*\)'.*/\1/p")"
GOT_NAME="$(printf '%s' "$BADGE" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p")"
[ "$GOT_CODE" = "$CODE" ] && [ "$GOT_NAME" = "$NAME" ] \
  || { echo "FATAL: built APK reports $GOT_NAME / versionCode $GOT_CODE, expected $NAME / $CODE" >&2; exit 1; }
OUT="$BUILD/KrushiKendra-$NAME.apk"
mv "$BUILD/signed.apk" "$OUT"

echo "== verifying"
$APKSIGNER verify --verbose "$OUT" | grep -i "verifies"
"$ZIPALIGN" -c 4 "$OUT" && echo "alignment ok"
unzip -v "$OUT" | grep "resources.arsc" | grep -q "Stored" \
  || { echo "FATAL: resources.arsc is not STORED; Android cannot memory-map it" >&2; exit 1; }
echo "resources.arsc stored ok"

# Every shell entry must survive assembly, alignment and signing unchanged. The
# manifest is the one exception: it carries this build's version, so the check is
# that exactly the version bytes differ - same length, and only 4 bytes of
# versionCode plus two per character of versionName.
while IFS= read -r -d '' f; do
  rel="${f#"$SRC"/}"
  unzip -p "$OUT" "$rel" > "$BUILD/.a" 2>/dev/null || { echo "FATAL: $rel missing from the APK" >&2; exit 1; }
  if [ "$rel" = "AndroidManifest.xml" ]; then
    sa="$(wc -c < "$BUILD/.a")"; sb="$(wc -c < "$f")"
    [ "$sa" = "$sb" ] || { echo "FATAL: manifest length changed, $sb to $sa" >&2; exit 1; }
    # cmp exits 1 when files differ, which pipefail would otherwise turn into a
    # silent death here, so its status is discarded deliberately.
    diffs="$( { cmp -l "$BUILD/.a" "$f" || true; } | wc -l )"
    want=$((4 + 2 * ${#NAME}))
    # Assemble.java already proves every changed byte sits inside the version
    # fields; this bounds it again from outside the JVM. 14 to 22 is one byte, so
    # the floor is "something changed" and the ceiling is the whole field width.
    [ "$diffs" -ge 1 ] && [ "$diffs" -le "$want" ] \
      || { echo "FATAL: manifest differs from src/ in $diffs bytes, expected 1..$want" >&2; exit 1; }
    echo "manifest stamped only: $diffs of $sa bytes"
  else
    cmp -s "$BUILD/.a" "$f" || { echo "FATAL: $rel in the APK differs from src/" >&2; exit 1; }
    echo "shell intact: $rel"
  fi
done < <(find "$SRC" -maxdepth 1 -type f -print0; \
         find "$SRC/res" -type f -print0)
rm -f "$BUILD/.a" "$BUILD/unsigned.apk" "$BUILD/aligned.apk"

# Whole-app smoke test: aapt parsing the manifest and resources proves the binary
# manifest and resources.arsc are structurally readable, which the byte checks
# alone cannot show.
"$AAPT" dump badging "$OUT" >/dev/null || { echo "FATAL: aapt cannot parse the built APK" >&2; exit 1; }
echo "manifest and resources parse ok"
echo "packaged files: $(unzip -l "$OUT" | tail -1 | awk '{print $2}')"

echo
echo "built $OUT  (version $NAME, versionCode $CODE)"
echo "Signed with the keystore at $KEYSTORE. A device already running a build signed"
echo "with this key updates in place, because versionCode rises with every commit. A"
echo "device running the original app needs uninstalling first, which erases its"
echo "records - take Settings > Backup off it before doing that."
