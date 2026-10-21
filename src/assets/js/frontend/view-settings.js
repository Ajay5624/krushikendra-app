/* =========================================================
   view-settings.js — settings, security and backup
   Part of the views family. Helpers shared by more than one
   screen live in js/frontend/views-core.js and arrive on FS.ui._shared;
   screens reach each other through the same object, late-bound
   at call time, so script order cannot break a button.
   ========================================================= */
(function (FS) {
  "use strict";
  var U = FS.util, db = FS.db, store = FS.store, ui = FS.ui;
  var H = ui._helpers, V = ui._VIEWS, S = ui._shared, h = U.escapeHtml;
  var $ = H.$, $$ = H.$$, $all = H.$$;
  var toast = H.toast, fieldError = H.fieldError, modal = H.modal, confirm = H.confirm;
  var formData = H.formData, statusBadge = H.statusBadge, expiryBadge = H.expiryBadge;
  var setPage = H.setPage, refresh = H.refresh, state = H.state, UNITS = H.UNITS, PAYMENTS = H.PAYMENTS;
  var exportMenu = H.exportMenu, ico = H.ico, mseg = H.mseg, metrics = H.metrics, emptyRow = H.emptyRow, reveal = H.reveal;
  var stock = S.stock, isoOffset = S.isoOffset, cats = S.cats, unitOpts = S.unitOpts, cardPriceLabel = S.cardPriceLabel;
  var selOpts = S.selOpts, typeBadge = S.typeBadge, movementTable = S.movementTable, kv = S.kv, kvHtml = S.kvHtml;
  var TYPES = S.TYPES, CROP_TYPES = S.CROP_TYPES, TOX_TYPES = S.TOX_TYPES, FORMS = S.FORMS, TOX = S.TOX;
  var invoiceHTML = S.invoiceHTML, printInvoice = S.printInvoice, customerList = S.customerList;
  var waPhone = S.waPhone, waOpen = S.waOpen, dueReminderText = S.dueReminderText, invoiceWaLines = S.invoiceWaLines;
  var waSaleReminder = S.waSaleReminder, waCustomerReminder = S.waCustomerReminder;

  /* =========================== SETTINGS =========================== */
  var THEMES = [
    { key: "green", name: "Green", dark: false, c: "#16a34a" },
    { key: "dark",  name: "Dark",  dark: true,  c: "#22c55e" }
  ];

  V.settings = function (el) {
    el.dataset.hue = "info";
    setPage("Settings", "Shop details, defaults & data");
    var s = state.settings;
    el.innerHTML =
      '<div class="grid cols-2">' +
        '<div class="card"><div class="card-head"><h2>Shop details</h2></div>' +
          '<form id="set-form"><div class="form-grid">' +
            '<div class="field full"><label>Shop name</label><input class="input" name="shopName" value="' + h(s.shopName) + '"></div>' +
            '<div class="field full"><label>Address</label><input class="input" name="address" value="' + h(s.address) + '"></div>' +
            '<div class="field"><label>Phone</label><input class="input" name="phone" value="' + h(s.phone) + '"></div>' +
            '<div class="field"><label>Email</label><input class="input" name="email" value="' + h(s.email) + '"></div>' +
            '<div class="field"><label>GSTIN / Tax ID</label><input class="input" name="gstin" value="' + h(s.gstin) + '"></div>' +
            '<div class="field"><label>Currency symbol</label><input class="input" name="currency" value="' + h(s.currency) + '"></div>' +
            '<div class="field"><label>Invoice prefix</label><input class="input" name="invoicePrefix" value="' + h(s.invoicePrefix) + '"></div>' +
            '<div class="field"><label>Purchase prefix</label><input class="input" name="purchasePrefix" value="' + h(s.purchasePrefix) + '"></div>' +
            '<div class="field"><label>Default tax % (GST)</label><input class="input" type="number" step="0.01" min="0" name="taxRate" value="' + (s.taxRate || 0) + '"></div>' +
            '<div class="field"><label>Default reorder level</label><input class="input" type="number" step="1" min="0" name="lowStockDefault" value="' + (s.lowStockDefault || 0) + '"></div>' +
            '<div class="field"><label>Expiry warning (days)</label><input class="input" type="number" step="1" min="0" name="expiryWarnDays" value="' + (s.expiryWarnDays || 0) + '"></div>' +
            '<div class="field"><label>Auto-lock after idle (min, 0 = off)</label><input class="input" type="number" step="1" min="0" name="idleLockMin" value="' + (s.idleLockMin || 0) + '"></div>' +
            '<div class="field"><label>UPI ID (reminders &amp; invoice QR)</label><input class="input" name="upiId" value="' + h(s.upiId || "") + '" placeholder="e.g. 9876543210@upi"></div>' +
            '<div class="field"><label>WhatsApp language</label><select class="select" name="waLang">' +
              '<option value="en"' + ((s.waLang || "en") === "en" ? " selected" : "") + ">English</option>" +
              '<option value="hi"' + (s.waLang === "hi" ? " selected" : "") + ">हिंदी (Hindi)</option>" +
            "</select></div>" +
            '<div class="field"><label>Invoice print language <span class="muted" style="font-weight:400">(with English)</span></label><select class="select" name="printLang">' +
              U.LANGS.map(function (L) { return '<option value="' + L.code + '"' + ((s.printLang || "en") === L.code ? " selected" : "") + ">" + h(L.label) + "</option>"; }).join("") +
            "</select></div>" +
            '<div class="field full"><label>Invoice footer</label><input class="input" name="invoiceFooter" value="' + h(s.invoiceFooter) + '"></div>' +
          "</div>" +
          '<div class="mt"><button class="btn btn-primary" type="button" id="set-save">Save settings</button></div></form>' +
        "</div>" +

        '<div class="stack">' +
          '<div class="card"><div class="card-head"><h2>Appearance</h2><span class="sub">Theme</span></div>' +
            '<div class="theme-grid" id="theme-grid">' +
              THEMES.map(function (t) {
                var sel = ((s.theme || "green") === t.key) ? " sel" : "";
                return '<button type="button" class="theme-opt' + sel + '" data-theme="' + t.key + '" title="' + h(t.name) + '">' +
                  '<span class="th-prev ' + (t.dark ? "dark" : "light") + '">' +
                    '<i style="height:55%;background:' + t.c + '"></i>' +
                    '<i style="height:100%;background:' + t.c + '"></i>' +
                    '<i style="height:38%;background:' + t.c + '"></i>' +
                  '</span>' +
                  '<span class="th-name">' + h(t.name) + '</span>' +
                '</button>';
              }).join("") +
            '</div>' +
          "</div>" +
          '<div class="card"><div class="card-head"><h2>Security</h2><span class="sub" id="pin-status">' + (H.pinSet() ? "PIN lock: On" : "PIN lock: Off") + '</span></div>' +
            '<p class="small soft">Set a 4–8 digit PIN to lock the app on open and after idle time. The PIN is stored as a hash — it is never kept in plain text. Forgot it? Use Reset PIN, or the "Forgot PIN?" link on the lock screen.</p>' +
            '<div class="row mt-sm">' +
              '<button class="btn" id="set-pin">' + (H.pinSet() ? "Change PIN" : "Set PIN") + '</button>' +
              (H.pinSet() ? '<button class="btn" id="reset-pin">Reset PIN</button>' : '') +
              (H.pinSet() ? '<button class="btn btn-danger" id="rm-pin">Remove PIN</button>' : '') +
              '<button class="btn" id="lock-now">' + ico("lock") + ' Lock now</button>' +
            '</div>' +
          "</div>" +
          '<div class="card"><div class="card-head"><h2>Data & backup</h2></div>' +
            '<p class="small soft">All data lives in this browser (IndexedDB). Export a backup regularly, especially before clearing browser data or moving computers.</p>' +
            '<div class="row mt-sm"><button class="btn" id="set-export">' + ico("download") + ' Export backup (.json)</button></div>' +
            '<div class="row mt"><div class="field grow"><label>Import backup</label>' +
              '<div class="row"><select class="select" id="imp-mode" style="max-width:150px"><option value="merge">Merge</option><option value="replace">Replace all</option></select>' +
              '<button class="btn" id="imp-btn">Choose file…</button></div>' +
              '<input type="file" id="imp-file" accept="application/json,.json" style="display:none">' +
            "</div></div>" +
          "</div>" +
          '<div class="card"><div class="card-head"><h2>About</h2></div>' +
            '<p class="small soft"><strong>Fertilizer Shop Inventory</strong> — a fully offline app. Open <code>index.html</code> in any modern browser; no internet or installation required.</p>' +
            '<ul class="small soft" style="padding-left:18px;margin:8px 0 0">' +
              "<li>Track products with NPK, batch numbers, expiry and units.</li>" +
              "<li>Bill sales at the counter and print invoices.</li>" +
              "<li>Record purchases to add stock (FIFO consumed on sale).</li>" +
              "<li>Reports for revenue, profit, valuation, low stock & expiry.</li>" +
            "</ul>" +
          "</div>" +
        "</div>" +
      "</div>";

    $("#set-save", el).onclick = function () {
      var d = formData($("#set-form", el));
      // The currency symbol is concatenated straight into money strings in several
      // templates, so it is the one setting that must never carry markup.
      var cur = (d.currency.trim() || "₹").slice(0, 4).replace(/[<>&"']/g, "");
      function clamp(v, lo, hi) { var n = U.num(v); return isNaN(n) ? lo : Math.min(hi, Math.max(lo, n)); }
      var next = {
        shopName: d.shopName.trim() || "Shop", address: d.address, phone: d.phone, email: d.email, gstin: d.gstin,
        currency: cur, invoicePrefix: d.invoicePrefix.trim() || "INV", purchasePrefix: d.purchasePrefix.trim() || "PUR",
        taxRate: clamp(d.taxRate, 0, 100), lowStockDefault: clamp(d.lowStockDefault, 0, 1000), expiryWarnDays: clamp(d.expiryWarnDays, 1, 3650),
        idleLockMin: clamp(d.idleLockMin, 0, 720),
        upiId: (d.upiId || "").trim(), waLang: d.waLang === "hi" ? "hi" : "en",
        printLang: ["hi", "mr", "te"].indexOf(d.printLang) >= 0 ? d.printLang : "en",
        invoiceFooter: d.invoiceFooter,
        theme: state.settings.theme || "green",
        pinHash: state.settings.pinHash || "", pinSalt: state.settings.pinSalt || ""
      };
      db.saveSettings(next).then(function () { FS.CURRENCY = next.currency; return refresh(); })
        .then(function () { if (ui.idleBump) ui.idleBump(); toast("Settings saved"); })
        .catch(function (e) { toast(e.message || "Could not save settings", "error"); });
    };

    $all("#theme-grid .theme-opt", el).forEach(function (btn) {
      btn.onclick = function () {
        var t = btn.dataset.theme;
        state.settings.theme = t;
        H.applyTheme(t);
        $all("#theme-grid .theme-opt", el).forEach(function (b) { b.classList.toggle("sel", b === btn); });
        db.saveSettings(state.settings).then(function () { toast("Theme applied"); })
          .catch(function (e) { toast(e.message || "Could not save the theme", "error"); });
      };
    });

    $("#set-pin", el).onclick = function () {
      var has = H.pinSet();
      modal({
        title: has ? "Change PIN" : "Set PIN", size: "narrow",
        body:
          '<div class="stack">' +
            (has ? '<div class="field"><label>Current PIN</label><input class="input" id="pin-cur" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></div>' : '') +
            '<div class="field"><label>New PIN (4–8 digits)</label><input class="input" id="pin-new" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></div>' +
            '<div class="field"><label>Confirm new PIN</label><input class="input" id="pin-cnf" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></div>' +
            '<div class="lock-err" id="pin-err"></div>' +
          '</div>',
        footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="pin-save">Save PIN</button>',
        onMount: function (m, close) {
          $("#pin-save", m).onclick = function () {
            var cur = has ? ($("#pin-cur", m).value || "") : "";
            var nw = $("#pin-new", m).value || "", cn = $("#pin-cnf", m).value || "";
            var err = $("#pin-err", m);
            if (nw !== cn) { err.textContent = "New PINs do not match"; return; }
            H.changePin(cur, nw).then(function () {
              close(); return refresh();
            }).then(function () { toast("PIN saved"); })
              .catch(function (e) { err.textContent = e.message || "Could not save PIN"; });
          };
        }
      });
    };

    var rmPin = $("#rm-pin", el);
    if (rmPin) rmPin.onclick = function () {
      modal({
        title: "Remove PIN", size: "narrow",
        body:
          '<div class="stack">' +
            '<p class="small soft">Enter your current PIN to turn off the lock.</p>' +
            '<div class="field"><label>Current PIN</label><input class="input" id="pin-cur" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></div>' +
            '<div class="lock-err" id="pin-err"></div>' +
          '</div>',
        footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-danger" id="pin-rm">Remove PIN</button>',
        onMount: function (m, close) {
          $("#pin-rm", m).onclick = function () {
            H.clearPin($("#pin-cur", m).value || "").then(function () {
              close(); return refresh();
            }).then(function () { toast("PIN removed"); })
              .catch(function (e) { $("#pin-err", m).textContent = e.message || "Could not remove PIN"; });
          };
        }
      });
    };

    var resetPinBtn = $("#reset-pin", el);
    if (resetPinBtn) resetPinBtn.onclick = function () {
      modal({
        title: "Reset PIN", size: "narrow",
        body:
          '<div class="stack">' +
            '<p class="small soft">Set a new PIN. You do not need to enter your old one.</p>' +
            '<div class="field"><label>New PIN (4–8 digits)</label><input class="input" id="pin-new" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></div>' +
            '<div class="field"><label>Confirm new PIN</label><input class="input" id="pin-cnf" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></div>' +
            '<div class="lock-err" id="pin-err"></div>' +
          '</div>',
        footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="pin-reset-save">Reset PIN</button>',
        onMount: function (m, close) {
          $("#pin-reset-save", m).onclick = function () {
            var nw = $("#pin-new", m).value || "", cn = $("#pin-cnf", m).value || "";
            var err = $("#pin-err", m);
            if (nw !== cn) { err.textContent = "New PINs do not match"; return; }
            H.resetPin(nw).then(function () {
              close(); return refresh();
            }).then(function () { toast("PIN reset"); })
              .catch(function (e) { err.textContent = e.message || "Could not reset PIN"; });
          };
        }
      });
    };

    $("#lock-now", el).onclick = function () { H.lockNow(); };

    $("#set-export", el).onclick = function () { H.doExport(); };

    var fileInput = $("#imp-file", el);
    $("#imp-btn", el).onclick = function () { fileInput.click(); };
    fileInput.onchange = function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var replace = $("#imp-mode", el).value === "replace";
      U.readFileJSON(f).then(function (data) {
        return confirm({
          title: "Import backup?", danger: replace, okText: "Import",
          message: replace
            ? "This will <strong>replace all current data</strong> with the backup. Continue?"
            : "This will <strong>merge</strong> the backup into current data (matching records overwritten). Continue?"
        }).then(function (yes) {
          if (!yes) return;
          return store.importAll(data, replace).then(function (n) {
            return refresh().then(function () { toast("Imported " + n + " record(s)"); });
          });
        });
      }).catch(function (e) { toast(e.message || "Import failed", "error"); })
        .then(function () { fileInput.value = ""; });
    };
  };
})(window.FS);
