# Krushi Kendra — shop inventory, billing & credit ledger

Offline-first app for a fertiliser and agri-input shop. It runs with **no server,
no internet and no account**: every record lives in the browser's IndexedDB on
the device that made it.

Two ways it is used:

- **Android tablet at the counter** — a WebView shell loads these files from
  inside the APK.
- **Windows PC** — the same `src/assets/index.html`, served locally or opened
  directly.

## Layout

| Path | What it is |
|---|---|
| `src/assets/` | The entire application — this is where all work happens |
| `src/assets/index.html` | App shell and the script load order |
| `src/assets/css/styles.css` | All styling, including the `GLASS STACK` token block at the end |
| `src/assets/css/fonts.css` | Inter, vendored locally (see *No CDN* below) |
| `src/assets/js/backend/` | `db.js` IndexedDB layer, `store.js` all business logic |
| `src/assets/js/frontend/` | `ui.js` helpers plus one `view-*.js` per screen |
| `src/assets/shim.js` | Android WebView bridge — printing, file saves, back button |
| `src/AndroidManifest.xml`, `src/classes.dex`, `src/res/` | The Android wrapper, extracted from the shipped APK |

The app screens are: Dashboard, Point of Sale, Sales History, Customers, Credit
Book, Products, Stock History, Purchases, Payables, Suppliers, Reports, Settings.

## Run it

```
node serve-preview.js      # then open http://127.0.0.1:4173
```

A plain HTTP server is used rather than `file://` because IndexedDB needs a real
origin. `fetch-inter.js` is the one-off script that downloaded the font; you do
not need it to run the app.

There is **no build step, no bundler and no dependencies** — no `npm install`,
nothing to compile. Files are loaded as written.

## No CDN, deliberately

The app ships inside an APK that must work offline, and the page sets a
content-security policy. So nothing is fetched at runtime: fonts are vendored,
icons are hand-drawn SVG, charts are hand-drawn DOM. Do not add a CDN link, a
webfont URL or an analytics tag — it will break the phone build.

## Theming

Light mode is opaque paper; dark mode is frosted glass over an ambient colour
scene. Both are driven by the `--g-*` tokens in the `GLASS STACK` section of
`styles.css` — light sets `--g-frost: none` and full alphas, so the light theme
pays no compositing cost. Two rules worth keeping:

- Blur only structural surfaces (sidebar, header, dialogs, panels). The product
  shelf is ~270 tiles and ledger rows are unbounded; blurring those costs frame
  rate on the counter tablet.
- Hue is meaning, not decoration. Green is money in, red is money out, and each
  pesticide category has its own band colour used across every screen.

## Target device

A Xiaomi Redmi Pad: 2000×1200, 90 Hz, touchscreen — roughly **1334×800 CSS px in
landscape** and **800×1333 in portrait**. Touch ergonomics are gated on
`@media (pointer: coarse)`, not on width, so the tablet gets finger-sized
controls and 16px field text; the last condition is what stops Android zooming
the page when you tap into a field. Test at both orientations before shipping.

## Rebuilding the APK — read this first

**This repository cannot produce an APK.** It holds the app's web files and the
Android wrapper extracted from the shipped one, but no Gradle project and no
signing keystore.

The keystore that signed the installed app is gone. A rebuilt APK therefore
cannot install over the existing one — Android rejects a different signature, so
the old app has to be uninstalled first, **which erases the shop's records held
on that device.** Always take a `Settings → Backup` export off the tablet before
installing anything new.

## Not in version control

`KrushiKendra.apk` and `Glassmorphism UI Playground.html` are ignored. The first
is a build artifact, the second a design reference. Both live on disk beside the
repo. Signing keys are ignored as well, and should stay that way.
