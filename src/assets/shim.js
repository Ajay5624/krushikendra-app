/* ---------------------------------------------------------------------------
   Android WebView adapter. MainActivity injects this after the page settles,
   so the PC build (file:// and the local server) never sees it. Everything is
   gated on window.AndroidBridge existing.
   --------------------------------------------------------------------------- */
(function () {
  if (!window.AndroidBridge) return;
  var B = window.AndroidBridge;

  /* ---- Printing ------------------------------------------------------------
     WebView has no window.print(). Route it to the system print service, and
     tell it which way the app's @page rule wants the sheet to run. */
  window.print = function () {
    var st = document.getElementById("fs-page-style");
    var land = !!(st && /landscape/i.test(st.textContent || ""));
    try { B.print(land ? 1 : 0); } catch (e) {}
  };

  /* ---- Saving files --------------------------------------------------------
     A blob: download is a no-op in WebView, so hand the bytes to Java in base64
     pieces (the JS->Java bridge dislikes huge strings). The blob is taken from
     the one the page just made, never re-fetched: fetch() of a blob: URL goes
     through the WebView request interceptor, which answers anything that is not
     a bundled app file, so a fetched backup arrives empty. */
  var CHUNK = 512 * 1024; // raw bytes per hop
  var makeUrl = URL.createObjectURL, killUrl = URL.revokeObjectURL, blobs = Object.create(null);

  URL.createObjectURL = function (obj) {
    var u = makeUrl.call(URL, obj);
    if (obj && typeof obj.size === "number") blobs[u] = obj;
    return u;
  };
  URL.revokeObjectURL = function (u) {
    delete blobs[u];
    return killUrl.call(URL, u);
  };

  function toB64(buf) {
    // 8k per apply(): a full backup is >1MB and one huge argument list throws.
    var bytes = new Uint8Array(buf), parts = [], step = 8192, i;
    for (i = 0; i < bytes.length; i += step) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + step, bytes.length))));
    }
    return btoa(parts.join(""));
  }

  function send(name, mime, blob) {
    var total = blob.size, at = 0;
    B.saveBegin(name, mime, total);
    function pump() {
      if (at >= total) { B.saveEnd(); return; }
      blob.slice(at, Math.min(at + CHUNK, total)).arrayBuffer()
        .then(function (buf) { B.saveChunk(toB64(buf)); at += CHUNK; pump(); })
        .catch(function (e) { B.saveAbort(String((e && e.message) || e)); });
    }
    pump();
  }

  var anchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    var href = this.href || "";
    if (this.download && href.indexOf("blob:") === 0) {
      var name = this.getAttribute("download") || "download";
      var blob = blobs[href];
      if (blob) {
        delete blobs[href];
        send(name, blob.type || "application/octet-stream", blob);
        return;
      }
      // Only for a blob this shim did not see created.
      fetch(href).then(function (r) { return r.blob(); })
        .then(function (b) { send(name, b.type || "application/octet-stream", b); })
        .catch(function (e) { B.saveFailed(name, String((e && e.message) || e)); });
      return;
    }
    return anchorClick.apply(this, arguments);
  };

  /* ---- External links ------------------------------------------------------
     The WhatsApp reminder button uses window.open(), which WebView only allows
     through an explicit popup path; hand it to the tablet's own browser instead. */
  window.open = function (url) {
    try { B.openExternal(String(url || "")); } catch (e) {}
    return null;
  };

  /* ---- Back button ---------------------------------------------------------
     Escape already closes whatever the app layers on screen, so reuse it
     instead of inventing a second close path. */
  function esc() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  }

  window.__abBack = function () {
    if (document.querySelector(".lock-screen")) return true;
    if (document.querySelector("#modal-root .modal-overlay")) { esc(); return true; }
    if (document.querySelector(".exp-pop")) { esc(); return true; }
    var sc = document.querySelector(".scrim");
    if (sc) { sc.click(); return true; }
    var active = document.querySelector(".nav-item.active");
    if (active && active.getAttribute("data-view") !== "dashboard") {
      var home = document.querySelector('.nav-item[data-view="dashboard"]');
      if (home) { home.click(); return true; }
    }
    return false;
  };

  /* Ask the OS not to evict the shop's IndexedDB when storage runs low. */
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
})();
