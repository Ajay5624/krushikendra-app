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
| `src/AndroidManifest.xml`, `src/classes.dex`, `src/resources.arsc`, `src/res/` | The Android wrapper, extracted from the shipped APK — stored into the build as-is, apart from the two version fields in the manifest |

The app screens are: Dashboard, Point of Sale, Sales History, Customers, Credit
Book, Products, Stock History, Purchases, Payables, Suppliers, Reports, Settings.

## Run it

On the counter tablet the app runs from inside the APK — see *Rebuilding the APK*.

On a PC, serve `src/assets` over HTTP and open it in a browser:

```
py -m http.server 4173 --directory src/assets    # Windows; python3 elsewhere
```

Then open http://127.0.0.1:4173

An HTTP origin is required rather than `file://` because every record lives in
IndexedDB, and `file://` does not get one. Any static file server rooted at
`src/assets` works the same way; this is only a preview, the app has no
server-side half.

`serve-preview.js`, the plain Node server this repo used for that job, and
`fetch-inter.js`, the one-off script that downloaded the Inter font now vendored
under `src/assets/fonts/`, were removed in `0c1becd`. Either is recoverable with
`git show 0c1becd~1:serve-preview.js`.

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

```
./tools/build-apk2.sh        # -> build/KrushiKendra-<version>.apk
```

`tools/build-apk2.sh` needs a JDK (17+; 21 is what built this) and Android
build-tools for `zipalign`, `apksigner` and `aapt` — no Gradle, no Android Studio,
no base APK and no network. It uses the highest numerically versioned folder under
`~/android-sdk/build-tools/`; set `ANDROID_BUILD_TOOLS` to choose another.

**It patches the installed app rather than rewriting it.** `classes.dex`,
`resources.arsc` and `res/` go into the output byte-for-byte, exactly as they sit
in `src/`, `AndroidManifest.xml` goes in with only its two version fields
overwritten (see *The version number* below), and `src/assets` becomes `assets/*`.
That is deliberate: the shell serves the app from the fake origin
`https://app.krushikendra/`, which is where the shop's IndexedDB lives, and it
implements the `AndroidBridge` that `shim.js` uses to write backups into
Downloads, to print through the system print service and to pick files. None of
that is visible from the web files, so rebuilding it from scratch risks silently
losing the shop's data location, its printing or its backups. `resources.arsc` has
to stay STORED because Android memory-maps it.

The build fails rather than shipping something suspect: if any shell entry comes
out of the finished APK different from the file in `src/` — the manifest excepted,
which must differ only inside the version fields, or the build aborts, if
`resources.arsc` is compressed, or if `src/` holds a top-level entry
`tools/Assemble.java` does not know about. That last one matters now because `src/`
is the only surviving copy of the shell — there is no original APK left to diff
against.

`tools/build-apk.sh` is the older variant: identical from zipalign onwards, but it
extracts the shell from a shipped `KrushiKendra.apk` named by `BASE_APK` and
verifies against that file instead of against `src/`. It cannot run on a machine
that does not have the APK.

### The signing key

Builds are signed with v3 only — `aapt` reads the manifest as `sdkVersion: 29`, so
Android 10+ never needs the v1 or v2 schemes. The keystore is
`~/krushikendra-keys/krushikendra-release.jks`, alias `krushikendra`, password in
`keystore-password.txt` beside it; `KRUSHI_KEYSTORE` and `KRUSHI_KEYPASS` override.

The key that signed the installed app is long gone, and so is the one that signed
the first build from this repo — `~/krushikendra-keys/` and `~/krushikendra-backups/`
were both deleted from this machine. The keystore now in place was generated on
2026-10-22, self-signed until 2056, with a copy of both files in
`~/krushikendra-backups/krushikendra-keys-2026-10-22/`. Three consequences:

- **Android will not install this over the existing app.** A different signature
  means the old app has to be uninstalled first, and uninstalling erases the
  records held on that device. Take `Settings → Backup` off the tablet *before*
  installing, then `Settings → Import backup → Replace all`.
- **Lose this key and the same wall goes up again.** Keep the keystore and its
  password somewhere that outlives this PC, and not only on it. A leaked keystore
  is worse than a lost one: anyone holding it can ship a fake update to tablets
  already running this app. Both files are gitignored and must stay that way.
- Once a build signed with this key is installed, later builds signed with it
  update in place, as long as `versionCode` goes up — which the build now does on
  its own.

### The version number

Every build gets a fresh version, so a new APK installs as an update over the one
already on the tablet instead of failing with `INSTALL_FAILED_VERSION_DOWNGRADE`.
`build-apk2.sh` sets `versionCode` to the number of commits in this repo's history
(`git rev-list --count HEAD`) and derives `versionName` from it, so the 22nd commit
builds **1.22**. Commit count is monotonically increasing, which is exactly the
property `versionCode` needs, and it means the version is never forgotten by hand.
The build refuses to run on a history that is short enough to collide (`versionCode`
must be above the 14 already shipped), and the output is named
`KrushiKendra-<version>.apk`.

The two fields are rewritten inside the binary `AndroidManifest.xml`, in place, by
`tools/Assemble.java` — no `aapt2` recompile and no Gradle. It walks the AXML
string pool to the resource-id map (chunk type `0x0180`) and finds each attribute by
its index in that map, because the names in the manifest are map indices, not the
`0x0101021b` ids you would grep for. It refuses to patch unless everything matches
its expectation: `versionCode` typed `TYPE_INT_DEC`, `versionName` typed
`TYPE_STRING`, a UTF-16 string pool, and exactly one attribute of each. Then it
asserts that the file is the same length and that no byte outside the two version
values changed. After signing, `aapt dump badging` re-reads the finished APK and the
build aborts if it reports any version other than the one asked for.

The one limit left: `versionName` is patched inside the string it already occupies,
so it must stay exactly 4 characters. The `%d.%02d` format keeps it there for
commit counts up to 999 (`1.01` … `1.99`, `2.00` … `2.99`); past that, or for any
label you want to write by hand, the manifest has to be recompiled with `aapt2`.

### What the build checks, and what a device checked

What the build proves about its own output: the v3 signature verifies against the
keystore, alignment checks, `resources.arsc` is STORED, the manifest differs from
`src/` only inside the version fields while the other 7 shell entries stay
byte-identical, all 26 files from `src/assets` are packaged with none missing or
extra, and `aapt` parses the finished APK as `com.agrodepot.inventory` at exactly
the version requested, with `MainActivity` launchable and the icon and label
resolving. Building the same tree twice gives the same bytes, because
`Assemble.java` pins entry timestamps.

What a device proved, on a Vivo T4x (Android 16) in October 2026: the shell
launches, the app serves from `https://app.krushikendra/` and keeps its IndexedDB
across restarts, `Settings → Backup` writes into `Download/Krushi Kendra/` through
`AndroidBridge`, the back button behaves, POS dialogs scroll far enough to reach
every field, and `adb install -r` updates 1.13 (code 14) in place to 1.22 (code 22)
with `firstInstallTime` preserved — the records on the device survived. Two defects
came out of that run; the best-day label is fixed, and the Export/Print buttons in
the low-stock alert are still ~34dp tall.

Still unproven on hardware: printing through the system print service, landscape at
any width, and the Redmi Pad the shop tablet is expected to run on. Take a Backup
off the device before installing anything new there.
