# 2026-10-22 (evening) — retail-value card, browser-check server, 1.29 on the phone

Session summary. Keep only what is not obvious from the code; details live in
README.md and git.

## What happened

On the Products page, total retail value (stock x sell price) was only a small
hint under the cost card. It is now its own metric card:

- ribbon went 4 -> 5 segments: `Stock value (cost)` (hint "on N item(s)") and
  `Stock value (retail)` (hint "margin ₹X"). Same figure and wording family the
  dashboard already uses ("Stock at retail").
- `52daa1a` — the card itself, in `src/assets/js/frontend/view-products.js`.
- `f24fd06` — `tools/serve-local.cjs`: `node tools/serve-local.cjs` serves
  `src/assets` at http://localhost:8931 so UI changes get checked in a desktop
  browser (Playwright) without an APK build. Verified math, tablet (1100px, one
  row) and phone (480px, 3+2 wrap) layouts that way.

Both pushed. Built `build/KrushiKendra-1.29.apk` (code 29) with
`./tools/build-apk2.sh`; installed over 1.27 on the Vivo T4x with
`adb install -r` — same key, in place, records intact, 0 crashes. Confirmed on
the phone screen: cost ₹17,100 / retail ₹22,800 / margin ₹5,700.

## Machine facts learned (also in user memory)

- adb is not on PATH: `~/android-sdk/platform-tools/adb.exe`.
- Git Bash mangles adb file args like `/sdcard/ui.xml`; export
  `MSYS_NO_PATHCONV=1` first. `uiautomator dump` + `adb pull` + `input tap`
  works for driving the real device.
- The USB-connected device is the Vivo T4x (V2437, serial 10MF75F7H400040),
  now running a current-key build, so future installs update in place.

## Loose ends

- Shop tablet (Redmi Pad) still has no current-key build installed; first
  install there needs backup -> uninstall -> install -> import, per the
  morning log.
- GitHub release still points at `v1.13-b1`; current build is 1.29. Refresh
  tag + asset when a real version goes out.
- Still open from the morning audit: Export/Print buttons in the low-stock
  alert are ~34dp (below 44dp touch target); system printing and landscape
  never verified on hardware.
- `build/` still holds stale artefacts (`KrushiKendra-1.13.apk`,
  `aligned.apk`, `unsigned.apk`).
