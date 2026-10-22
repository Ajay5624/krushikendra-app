# 2026-10-22 — APK rebuilt from the repo, versioned, audited on a phone

Session summary. Keep only what is not obvious from the code; details live in
README.md and git.

## What happened

The base APK and both signing keystores were deleted from this machine and are
unrecoverable from git. So the build was rebuilt around the shell committed in
`src/`, and then made to produce versioned, installable updates.

Commits, oldest first (all pushed to `origin/main` as of `adc6c7c`):

| commit | what |
| --- | --- |
| `d9b2ca1` | `tools/build-apk2.sh` + `tools/Assemble.java` — build from `src/` alone, no Gradle, no base APK, no network |
| `026f360` | `.gitattributes` — `*.sh` forced LF, the four binary shell entries marked binary, so a checkout cannot corrupt a build input |
| `0c1becd` | deleted `fetch-inter.js`, `serve-preview.js`, `styles.orig.css` |
| `fede7d4`, `f82f01c` | README run instructions + build section rewritten |
| `e97a932` | POS product photo square again (removed the 16:7 override) |
| `82aa694` | best-day bug: the `Math.max(maxDay, 1)` bar guard was printed as "Best day ₹1" on a shop with no sales — guard now only scales bars |
| `4315d4f` | every build stamps a new version into the binary manifest |
| `adc6c7c` | README documents the stamping |

## Version stamping — the thing to remember

`versionCode` = `git rev-list --count HEAD`; `versionName` = `%d.%02d` of it. So
commit 22 built **1.22 / code 22**. Monotonic by construction, never forgotten.

Patched in place inside `src/AndroidManifest.xml`'s AXML by `Assemble.java` — no
`aapt2` recompile. Three lessons went into the implementation, each cost a failed
build:
- manifest attribute names are **resource-map indices** (chunk type `0x0180`), not
  the `0x0101021b` ids you would grep for;
- `versionName` is rewritten inside the string it already occupies, so it must stay
  **exactly 4 characters** — fine up to commit 999, breaks after;
- the safety assertion checks byte **locations**, not byte counts (14→22 changes one
  byte), and `set -o pipefail` + `cmp -l` silently killed the script until the
  comparison was wrapped in `{ ... || true; }`.

Proof it works: `adb install -r` took 1.13/code 14 to 1.22/code 22 in place,
`firstInstallTime` preserved, 0 crashes.

## Signing key

Keystore generated 2026-10-22 (self-signed to 2056),
`~/krushikendra-keys/krushikendra-release.jks`, copy in
`~/krushikendra-backups/krushikendra-keys-2026-10-22/`. Both gitignored; never
print the password. v3 signature only, valid because minSdk 29.
Consequence: this key cannot install over the app that was on the tablet before —
different signature means uninstall, and uninstall erases that device's records.

## On-device audit — first ever, Vivo T4x (V2437, Android 16, 1080×2408)

Proved: shell launches, app stays on `https://app.krushikendra/`, IndexedDB survives
restarts, `Settings → Backup` writes to `Download/Krushi Kendra/` via
`AndroidBridge`, back button works, POS dialogs scroll to reach every field.

Found and fixed: best-day ₹1, POS thumbnails.
Found, **still open**: Export/Print buttons in the low-stock alert are ~34dp tall
(below the 44dp touch target). Also still unverified on hardware: system printing,
landscape, and the Redmi Pad the shop tablet is meant to be.

## Rules going forward

- The phone/tablet now holds **live shop records**. Backup before any install;
  never clear app data or uninstall without checking.
- Do not delete the `Audit Test Urea` product — real sales and batch rows reference it.
- `python` / `python3` on this machine are broken Store stubs; use `py` or node. No `zip` either.
- Pushing is always his own separate command.
- No `gh` CLI and no API token here, and the repo is private: releases are made by
  pushing a tag and dragging the APK into the browser upload.

## Loose ends

- GitHub release still points at tag `v1.13-b1`, whose bytes are
  `e2224646…`; the current build is `build/KrushiKendra-1.22.apk` (`44ac995d…`).
  The tag and the release asset both need refreshing when a real version goes out.
- Stale artefacts in `build/`: `KrushiKendra-1.13.apk`, `aligned.apk`, `unsigned.apk`.
- WebView debugging is not enabled in the shell, so no chrome://inspect on device.
- Post-update UI re-check (best-day value, square thumbs) never happened — the phone
  was asleep and was not unlocked.
