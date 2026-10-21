/* =========================================================
   app.js — bootstrap
   ========================================================= */
(function (FS) {
  "use strict";

  function showError(err) {
    var view = document.getElementById("view");
    if (!view) return;
    var msg = (err && err.message) ? err.message : String(err);
    view.innerHTML =
      '<div class="card" style="max-width:640px;margin:40px auto">' +
        '<div class="alert red"><strong>Could not start the app.</strong></div>' +
        '<p class="mt-sm">' + FS.util.escapeHtml(msg) + "</p>" +
        '<div class="section-title mt">Things to try</div>' +
        '<ul class="small soft" style="padding-left:18px;margin:0">' +
          "<li>Use a modern browser (Chrome, Edge, or Firefox).</li>" +
          "<li>Don't open in a Private/Incognito window — local storage may be blocked.</li>" +
          "<li>If nothing happens, right-click <code>index.html</code> → Open with → your browser.</li>" +
        "</ul>" +
      "</div>";
    console.error(err);
  }

  function boot() {
    FS.db.open().then(function () {
      return FS.ui.init();
    }).catch(showError);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window.FS);
