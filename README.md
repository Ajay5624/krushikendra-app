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

## Rebuilding the APK

`tools/build-apk.sh` produces a release APK from this working tree. It needs a
JDK (17+) and Android build-tools for `zipalign`, `apksigner` and `aapt` — no
Gradle and no Android Studio.

```
./tools/build-apk.sh        # -> build/KrushiKendra-<version>.apk
```

**It patches the installed app rather than rewriting it.** `classes.dex`,
`AndroidManifest.xml`, `resources.arsc` and `res/` are copied out of
`KrushiKendra.apk` byte-for-byte and only `assets/*` is replaced with
`src/assets`. That is deliberate: the shell serves the app from the fake origin
`https://app.krushikendra/`, which is where the shop's IndexedDB lives, and it
implements the `AndroidBridge` that `shim.js` uses to write backups into
Downloads, to print through the system print service and to pick files. None of
that is visible from the web files, so rebuilding it from scratch risks silently
losing the shop's data location, its printing or its backups. The script fails
the build if any shell entry stops matching the original, or if `resources.arsc`
is no longer stored uncompressed — Android memory-maps that file.

### The signing key

The key that signed the installed app is gone, so builds are signed with a new
one at `~/krushikendra-keys/krushikendra-release.jks`, alias `krushikendra`,
password in `keystore-password.txt` beside it. Two consequences:

- **Android will not install this over the existing app.** A different signature
  means the old app has to be uninstalled first, and uninstalling erases the
  records held on that device. Take `Settings → Backup` off the tablet *before*
  installing, then `Settings → Import backup → Replace all`.
- **Lose this key and the same wall goes up again.** Keep the keystore and its
  password somewhere that outlives this PC. A leaked keystore is worse than a
  lost one: anyone holding it can ship a fake update to tablets already running
  this app. Both files are gitignored and must stay that way.

Once a build signed with this key is installed, later builds signed with the
same key update in place — provided `versionCode` goes up.

### Known gap: the version label

`versionCode` and `versionName` live in the binary manifest that is copied
verbatim, so every build from this script reports **1.13 / versionCode 14**, like
the APK it was derived from. That is harmless for a fresh install, but it blocks
the first in-place update. Raising it means recompiling the manifest with `aapt2`
from the extracted `src/AndroidManifest.xml`, which has not been done.

## Not in version control

`KrushiKendra.apk`, `build/` and `Glassmorphism UI Playground.html` are ignored.
The first is the base APK the build patches, the second build output, the third a
design reference. All live on disk beside the repo. Signing keys are ignored as
well, and should stay that way.
