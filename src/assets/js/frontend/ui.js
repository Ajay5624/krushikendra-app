/* =========================================================
   ui.js — views, rendering, modals, toasts, event wiring
   Attaches to window.FS.ui
   ========================================================= */
(function (FS) {
  "use strict";
  var U = FS.util, db = FS.db, store = FS.store;
  var h = U.escapeHtml;
  var UNITS = ["bag", "kg", "quintal", "ton", "litre", "ml", "gm", "pack", "bottle", "packet", "box", "piece"];
  var PAYMENTS = ["Cash", "UPI", "Card", "Credit", "Bank", "Cheque"];

  var state = {
    view: "dashboard",
    settings: null, products: [], batches: [], suppliers: [], sales: [], purchases: [], customers: [],
    stockMap: {}, pmap: {}, smapSup: {}, custmap: {},
    cart: [], posCategory: "All", posSearch: "",
    productFilter: { q: "", category: "All" },
    reportRange: { from: "", to: "" }
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ===================== Shared UI helpers ===================== */

  function toast(msg, type) {
    var root = $("#toast-root");
    if (!root) return;
    var el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.innerHTML = ico((type === "error" || type === "warn") ? "alert" : "check") +
      '<div class="t-msg">' + h(msg) + "</div>";
    root.appendChild(el);
    setTimeout(function () {
      el.style.transition = "opacity var(--dur-2) ease, transform var(--dur-2) ease";
      el.style.opacity = "0"; el.style.transform = "translateX(20px)";
      setTimeout(function () { el.remove(); }, 300);
    }, 3200);
  }

  /* A toast alone does not say WHICH field is wrong in a two-column form, so the
     offending input is marked and focused as well. The mark clears on typing. */
  function fieldError(form, name, msg) {
    var input = form && form.querySelector ? form.querySelector('[name="' + name + '"]') : null;
    if (input) {
      input.classList.add("invalid");
      input.setAttribute("aria-invalid", "true");
      if (!input.dataset.errBound) {
        input.dataset.errBound = "1";
        input.addEventListener("input", function () {
          input.classList.remove("invalid"); input.removeAttribute("aria-invalid");
        });
      }
      input.focus();
      if (input.tagName === "INPUT" && input.type === "text") input.select();
    }
    toast(msg, "error");
  }

  function modal(opts) {
    opts = opts || {};
    var root = $("#modal-root");
    var overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    var size = opts.size ? " " + opts.size : "";
    overlay.innerHTML =
      '<div class="modal' + size + '" role="dialog" aria-modal="true"' +
        (opts.hue ? ' data-hue="' + opts.hue + '"' : "") + ">" +
        '<div class="modal-head"><h3>' + (opts.icon ? ico(opts.icon) : "") + h(opts.title || "") + "</h3>" +
          '<button class="icon-btn" data-close aria-label="Close">' + ico("close") + "</button></div>" +
        '<div class="modal-body">' + (opts.body || "") + "</div>" +
        (opts.footer != null ? '<div class="modal-foot">' + opts.footer + "</div>" : "") +
      "</div>";
    root.appendChild(overlay);

    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === "Escape" && opts.dismissable !== false) close(); }

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay && opts.dismissable !== false) close();
      if (e.target.closest && e.target.closest("[data-close]")) close();
    });
    document.addEventListener("keydown", onKey);

    var el = overlay.querySelector(".modal");
    if (opts.onMount) opts.onMount(el, close);
    var first = el.querySelector("input,select,textarea,button");
    if (first && opts.autofocus !== false) { try { first.focus(); } catch (_) {} }
    return { el: el, close: close };
  }

  function confirm(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var decided = false;
      modal({
        title: opts.title || "Are you sure?",
        icon: opts.danger ? "alert" : "clock",
        hue: opts.danger ? "out" : "info",
        size: "narrow",
        body: "<p>" + (opts.message || "") + "</p>",
        footer:
          '<button class="btn" data-no>' + h(opts.cancelText || "Cancel") + "</button>" +
          '<button class="btn ' + (opts.danger ? "btn-danger" : "btn-primary") + '" data-yes>' + h(opts.okText || "Confirm") + "</button>",
        onClose: function () { if (!decided) resolve(false); },
        onMount: function (el, close) {
          el.querySelector("[data-yes]").onclick = function () { decided = true; close(); resolve(true); };
          el.querySelector("[data-no]").onclick = function () { decided = true; close(); resolve(false); };
        }
      });
    });
  }

  function formData(form) {
    var o = {};
    $$("[name]", form).forEach(function (el) {
      if (el.type === "checkbox") o[el.name] = el.checked;
      else o[el.name] = el.value;
    });
    return o;
  }

  function statusBadge(stock, reorder) {
    if (stock <= 0) return '<span class="badge red">Out of stock</span>';
    if (stock <= reorder) return '<span class="badge amber">Low</span>';
    return '<span class="badge green">In stock</span>';
  }

  function expiryBadge(dateStr) {
    if (!dateStr) return '<span class="muted small">—</span>';
    var d = U.daysUntil(dateStr);
    if (d == null) return '<span class="muted small">' + U.fmtDate(dateStr) + "</span>";
    if (d < 0) return '<span class="badge red">Expired ' + U.fmtDate(dateStr) + "</span>";
    if (d <= 60) return '<span class="badge amber">' + d + "d · " + U.fmtDate(dateStr) + "</span>";
    return '<span class="badge green">' + U.fmtDate(dateStr) + "</span>";
  }

  function setPage(title, sub) {
    $("#page-title").textContent = title;
    $("#page-sub").textContent = sub || "";
  }

  /* ===================== Export popover ===================== */
  /* One shared export UI for every list. The caller hands over a lazy
     data() so the popover always reflects the filters as they are now. */

  var expPop = null;

  function closeExportPop() {
    if (!expPop) return false;
    expPop.el.remove();
    document.removeEventListener("mousedown", expPop.outside, true);
    document.removeEventListener("keydown", expPop.key, true);
    window.removeEventListener("resize", expPop.place);
    window.removeEventListener("scroll", expPop.place, true);
    if (expPop.anchor) { expPop.anchor.classList.remove("open"); expPop.anchor.setAttribute("aria-expanded", "false"); }
    expPop = null;
    return true;
  }

  function exportMenu(btn, opts) {
    if (!btn) return;
    btn.classList.add("btn-export");
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-expanded", "false");
    btn.onclick = function () {
      if (expPop && expPop.anchor === btn) { closeExportPop(); return; }
      openExportPop(btn, opts);
    };
  }

  function exportData(opts) {
    var d = typeof opts.data === "function" ? (opts.data() || {}) : (opts.data || {});
    var columns = d.columns || [];
    var rows = d.rows || [];
    var all = d.all || null;
    // No point offering "everything" when filters are not narrowing anything.
    if (all && all.length === rows.length) all = null;
    return { columns: columns, rows: rows, all: all };
  }

  // Set the print page size/orientation for the current print job. Using the
  // default @page (not a named page) avoids Chrome's leading blank page.
  function setPrintPage(landscape) {
    var id = "fs-page-style", st = document.getElementById(id);
    if (!st) { st = document.createElement("style"); st.id = id; document.head.appendChild(st); }
    st.textContent = landscape ? "@page { size: A4 landscape; margin: 12mm; }" : "@page { size: A4 portrait; margin: 14mm; }";
  }

  // Render a styled PDF document into the print area and open the print dialog
  // (choose "Save as PDF" to export). Shared by every PDF export in the app.
  function printDoc(opts) {
    var s = state.settings;
    var blocks = opts.blocks || [];
    function isNum(v) { return typeof v === "number" ? true : (String(v).trim() !== "" && /^-?[\d,.₹%\s]+$/.test(String(v)) && /\d/.test(String(v))); }
    var html = '<div class="pdf-doc">' +
      '<div class="pdf-head"><div class="pdf-shop">' +
        (opts.noLogo ? "" : '<img src="assets/logo.svg" alt="">') +
        "<div><h1>" + h(s.shopName || "Shop") + "</h1>" +
        (s.address ? '<div class="addr">' + h(s.address) + "</div>" : "") +
        ((s.phone || s.gstin) ? '<div class="addr">' + h([s.phone ? "Ph: " + s.phone : "", s.gstin ? "GSTIN: " + s.gstin : ""].filter(Boolean).join("  ·  ")) + "</div>" : "") +
        "</div></div>" +
        '<div class="pdf-docmeta"><div class="dt">' + h(opts.title || "Report") + "</div>" +
        (opts.subtitle ? '<div class="sub">' + h(opts.subtitle) + "</div>" : "") +
        '<div class="sub">Generated ' + h(U.fmtDateTime(U.nowISO())) + "</div></div></div>";
    blocks.forEach(function (b) {
      if (b.kv) {
        html += '<div class="pdf-sec">' + (b.caption ? "<h3>" + h(b.caption) + "</h3>" : "") +
          '<div class="pdf-kv">' + b.kv.map(function (p) { return '<div class="cell"><div class="k">' + h(p[0]) + '</div><div class="v">' + h(p[1]) + "</div></div>"; }).join("") + "</div></div>";
      } else if (b.columns) {
        html += '<div class="pdf-sec">' + (b.caption ? "<h3>" + h(b.caption) + "</h3>" : "");
        var rows = b.rows || [];
        if (!rows.length) { html += '<div class="pdf-empty">No records.</div></div>'; return; }
        html += '<table class="pdf"><thead><tr>' + b.columns.map(function (c, i) { return "<th" + (b.numCols && b.numCols.indexOf(i) >= 0 ? ' class="num"' : "") + ">" + h(c) + "</th>"; }).join("") + "</tr></thead><tbody>" +
          rows.map(function (r) {
            var tot = /^total$/i.test(String(r[0] == null ? "" : r[0]).trim());
            return "<tr" + (tot ? ' class="tot"' : "") + ">" + r.map(function (cell, i) {
              var num = b.numCols ? b.numCols.indexOf(i) >= 0 : isNum(cell);
              return "<td" + (num ? ' class="num"' : "") + ">" + h(cell == null ? "" : cell) + "</td>";
            }).join("") + "</tr>";
          }).join("") + "</tbody></table></div>";
      }
    });
    html += '<div class="pdf-foot">' + h(opts.footer || ([s.shopName || "", s.phone || ""].filter(Boolean).join("  ·  "))) + "</div></div>";
    setPrintPage(true); // all data exports print landscape so wide tables fit
    var area = $("#print-area");
    area.className = "print-area";
    area.innerHTML = html;
    setTimeout(function () { window.print(); }, 60);
  }

  function openExportPop(btn, opts) {
    closeExportPop();
    var d = exportData(opts);
    if (!d.rows.length && !(d.all && d.all.length)) {
      toast("Nothing to export yet", "error");
      return;
    }

    var scope = "filtered";
    var pop = document.createElement("div");
    pop.className = "exp-pop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Export options");

    function bodyHTML() {
      var n = scope === "all" ? d.all.length : d.rows.length;
      var scopeBlock = "";
      if (d.all) {
        scopeBlock =
          '<div class="exp-lbl">What to export</div>' +
          '<div class="exp-scope">' +
            '<label class="exp-opt' + (scope === "filtered" ? " sel" : "") + '">' +
              '<input type="radio" name="exp-scope" value="filtered"' + (scope === "filtered" ? " checked" : "") + ">" +
              "<span><b>On screen</b><i>" + d.rows.length + " filtered row(s)</i></span></label>" +
            '<label class="exp-opt' + (scope === "all" ? " sel" : "") + '">' +
              '<input type="radio" name="exp-scope" value="all"' + (scope === "all" ? " checked" : "") + ">" +
              "<span><b>Everything</b><i>" + d.all.length + " row(s), filters ignored</i></span></label>" +
          "</div>";
      }
      return scopeBlock +
        '<div class="exp-lbl">Columns <span class="exp-n">' + d.columns.length + "</span></div>" +
        '<div class="exp-cols">' + (d.columns.length
          ? d.columns.map(function (c) { return "<span>" + h(c) + "</span>"; }).join("")
          : '<span class="exp-none">none</span>') + "</div>" +
        '<div class="exp-count"><strong>' + n + "</strong> row" + (n === 1 ? "" : "s") + " &middot; " +
          (opts.unit ? h(opts.unit) + (n === 1 ? "" : "s") + " &middot; " : "") + "saves as PDF</div>";
    }

    pop.innerHTML =
      '<div class="exp-head"><div><strong>Export ' + h(opts.title || "") + '</strong>' +
        '<div class="exp-sub">PDF document · print or Save as PDF</div></div>' +
        '<button class="icon-btn exp-x" type="button" aria-label="Close">' + ico("close") + "</button></div>" +
      '<div class="exp-body"></div>' +
      '<div class="exp-foot">' +
        '<button class="btn btn-sm btn-primary" type="button" data-pdf>' + ico("print") + ' Export PDF</button>' +
      "</div>";

    document.body.appendChild(pop);
    var bodyEl = pop.querySelector(".exp-body");
    bodyEl.innerHTML = bodyHTML();

    function place() {
      if (!pop.isConnected) return;
      var r = btn.getBoundingClientRect();
      var w = pop.offsetWidth, hh = pop.offsetHeight;
      var left = Math.min(Math.max(8, r.right - w), Math.max(8, window.innerWidth - w - 8));
      var top = r.bottom + 6;
      if (top + hh > window.innerHeight - 8) top = r.top - hh - 6;
      top = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - hh - 8));
      pop.style.left = left + "px";
      pop.style.top = top + "px";
    }
    place();

    btn.classList.add("open");
    btn.setAttribute("aria-expanded", "true");

    var st = { el: pop, anchor: btn, outside: null, key: null, place: place };
    st.outside = function (e) {
      if (pop.contains(e.target) || btn.contains(e.target)) return;
      closeExportPop();
    };
    st.key = function (e) { if (e.key === "Escape") { e.stopPropagation(); closeExportPop(); btn.focus(); } };
    document.addEventListener("mousedown", st.outside, true);
    document.addEventListener("keydown", st.key, true);
    window.addEventListener("resize", st.place);
    window.addEventListener("scroll", st.place, true);
    expPop = st;

    pop.querySelector(".exp-x").onclick = function () { closeExportPop(); btn.focus(); };

    bodyEl.addEventListener("change", function (e) {
      var r = e.target;
      if (!r || r.name !== "exp-scope") return;
      scope = r.value;
      bodyEl.innerHTML = bodyHTML();
      place();
    });

    function chosen() {
      var fresh = exportData(opts);
      return [fresh.columns].concat(scope === "all" && fresh.all ? fresh.all : fresh.rows);
    }
    pop.querySelector("[data-pdf]").onclick = function () {
      var rows = chosen();
      var cols = rows[0] || [];
      var data = rows.slice(1);
      closeExportPop();
      printDoc({ title: opts.title || "Export", subtitle: (scope === "all" ? "All records" : "Filtered") + " · " + data.length + " row(s)", blocks: [{ columns: cols, rows: data }] });
    };

    var first = pop.querySelector(".btn-primary");
    if (first) first.focus();
  }

  /* ===================== Data load ===================== */

  function reload() {
    return store.migrateToV5().then(store.clearDemoValues).then(function (cleared) {
      if (cleared && (cleared.rates || cleared.batches)) {
        toast("Demo prices and demo stock cleared — enter your real rates in Products", "warn");
      }
      return Promise.all([
        db.getSettings(), store.listProducts(), store.listBatches(),
        store.listSuppliers(), store.listSales(), store.listPurchases(), store.listCustomers()
      ]);
    }).then(function (r) {
      state.settings = r[0];
      FS.CURRENCY = r[0].currency || "₹";
      applyTheme(r[0].theme);
      state.products = r[1]; state.batches = r[2]; state.suppliers = r[3];
      state.sales = r[4]; state.purchases = r[5]; state.customers = r[6];
      state.stockMap = store.stockMap(r[2]);
      state.pmap = {}; r[1].forEach(function (p) { state.pmap[p.id] = p; });
      state.smapSup = {}; r[3].forEach(function (s) { state.smapSup[s.id] = s; });
      state.custmap = {}; (r[6] || []).forEach(function (c) { state.custmap[c.id] = c; });
      var bn = $("#brand-name"); if (bn) bn.textContent = state.settings.shopName || "Shop";
      document.title = (state.settings.shopName || "Shop") + " — Inventory";
    });
  }

  function refresh() { return reload().then(render); }

  function setView(v) {
    state.view = v;
    $$(".nav-item").forEach(function (b) { b.classList.toggle("active", b.dataset.view === v); });
    closeSidebar();
    render();
    var c = $(".content"); if (c) c.scrollTop = 0;
    window.scrollTo(0, 0);
  }

  /* ===================== Render dispatcher ===================== */

  function render() {
    var el = $("#view");
    if (!el) return;
    if (state.locked) { el.innerHTML = ""; return; }
    closeExportPop();
    el.removeAttribute("data-hue");
    var v = state.view;
    try {
      var fn = VIEWS[v] || VIEWS.dashboard;
      fn(el);
      reveal(el);
    } catch (err) {
      el.innerHTML = '<div class="alert red">Something went wrong rendering this page: ' + h(err && err.message || err) + "</div>";
      console.error(err);
    }
  }

  FS.ui = {
    init: init, state: state, toast: toast, modal: modal, confirm: confirm,
    render: render, refresh: refresh, setView: setView, reload: reload,
    exportMenu: exportMenu, closeExportPop: closeExportPop,
    lockNow: lockNow, pinSet: pinSet, changePin: changePin, clearPin: clearPin, resetPin: resetPin, idleBump: idleBump
  };

  function closeSidebar() {
    var sb = $("#sidebar"); if (sb) sb.classList.remove("open");
    var sc = $(".scrim"); if (sc) sc.remove();
  }

  /* ===================== INIT / chrome wiring ===================== */

  /* ===================== PIN lock ===================== */
  function hashPin(pin, salt) {
    var data = (salt || "") + ":" + pin;
    if (window.crypto && crypto.subtle && crypto.subtle.digest && window.TextEncoder) {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
      });
    }
    // No SubtleCrypto (non-secure context): weaker hash, still deters casual peeking.
    var h1 = 5381, h2 = 52711, i, c;
    for (i = 0; i < data.length; i++) { c = data.charCodeAt(i); h1 = (h1 * 33) ^ c; h2 = (h2 * 31) ^ c; }
    return Promise.resolve((h1 >>> 0).toString(16) + (h2 >>> 0).toString(16));
  }
  function pinSet() { return !!(state.settings && state.settings.pinHash); }
  function sessionUnlocked() { try { return sessionStorage.getItem("fs_unlocked") === "1"; } catch (e) { return false; } }
  function setSessionUnlocked(v) { try { if (v) sessionStorage.setItem("fs_unlocked", "1"); else sessionStorage.removeItem("fs_unlocked"); } catch (e) { /* private mode */ } }
  // Brute-force guard: 5 wrong PINs locks unlocking for 60s (persisted for the session).
  var PIN_MAX_FAILS = 5, PIN_LOCK_MS = 60000;
  function getPinGuard() {
    try { return { fails: Number(sessionStorage.getItem("fs_pin_fails") || 0), until: Number(sessionStorage.getItem("fs_pin_lock") || 0) }; }
    catch (e) { return { fails: 0, until: 0 }; }
  }
  function setPinGuard(fails, until) {
    try { sessionStorage.setItem("fs_pin_fails", String(fails || 0)); sessionStorage.setItem("fs_pin_lock", String(until || 0)); } catch (e) { /* private mode */ }
  }

  function showLock() {
    state.locked = true;
    var el = $("#lock-screen");
    if (!el) { el = document.createElement("div"); el.id = "lock-screen"; el.className = "lock-screen"; document.body.appendChild(el); }
    el.innerHTML =
      '<div class="lock-box">' +
        '<div class="lock-ico">' + ico("lock") + "</div>" +
        "<h2>" + h((state.settings && state.settings.shopName) || "Shop") + "</h2>" +
        '<p class="small muted">Enter your PIN to open the app</p>' +
        '<input class="input lock-pin" id="lock-pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="••••" aria-label="PIN">' +
        '<div class="lock-err small" id="lock-err" role="alert"></div>' +
        '<button class="btn btn-primary lock-btn" id="lock-go" type="button">Unlock</button>' +
        '<div class="center" style="margin-top:10px"><button class="link-btn" id="lock-reset" type="button">Forgot PIN? Reset it</button></div>' +
      "</div>";
    var inp = $("#lock-pin", el);
    function tryUnlock() {
      var g = getPinGuard(), now = Date.now();
      if (g.until > now) {
        $("#lock-err", el).textContent = "Too many wrong attempts — try again in " + Math.ceil((g.until - now) / 1000) + "s";
        return;
      }
      $("#lock-err", el).textContent = "";
      hashPin(inp.value, state.settings.pinSalt).then(function (hx) {
        if (hx === state.settings.pinHash) {
          setPinGuard(0, 0);
          setSessionUnlocked(true);
          state.locked = false;
          el.remove();
          idleBump();
          setView(state.view || "dashboard");
        } else {
          var fails = g.fails + 1;
          if (fails >= PIN_MAX_FAILS) {
            setPinGuard(0, Date.now() + PIN_LOCK_MS);
            $("#lock-err", el).textContent = "Too many wrong attempts — locked for " + Math.round(PIN_LOCK_MS / 1000) + " seconds";
          } else {
            setPinGuard(fails, 0);
            $("#lock-err", el).textContent = "Wrong PIN — " + (PIN_MAX_FAILS - fails) + " attempt(s) left";
          }
          inp.value = ""; inp.focus();
        }
      });
    }
    $("#lock-go", el).onclick = tryUnlock;
    $("#lock-reset", el).onclick = function () {
      if (!window.confirm("Reset your PIN? This clears the current PIN and opens the app. You can set a new one in Settings.")) return;
      clearPinNoAuth().then(function () {
        setSessionUnlocked(true);
        state.locked = false;
        el.remove();
        idleBump();
        setView(state.view || "dashboard");
        toast("PIN reset — set a new one in Settings");
      });
    };
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") tryUnlock(); });
    var g0 = getPinGuard();
    if (g0.until > Date.now()) $("#lock-err", el).textContent = "Too many wrong attempts — try again in " + Math.ceil((g0.until - Date.now()) / 1000) + "s";
    setTimeout(function () { inp.focus(); }, 50);
  }

  function lockNow() {
    if (!pinSet()) { toast("Set a PIN in Settings first", "warn"); return; }
    setSessionUnlocked(false);
    closeExportPop();
    var v = $("#view"); if (v) v.innerHTML = "";
    showLock();
  }

  var idleTimer = null;
  function idleBump() {
    stopIdle();
    if (state.locked || !pinSet()) return;
    var min = Number(state.settings.idleLockMin) || 0;
    if (!(min > 0)) return;
    idleTimer = setTimeout(function () { lockNow(); }, min * 60000);
  }
  function stopIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }

  function changePin(current, next) {
    next = String(next == null ? "" : next);
    if (!/^\d{4,8}$/.test(next)) return Promise.reject(new Error("PIN must be 4–8 digits"));
    var check = Promise.resolve();
    if (pinSet()) {
      if (!current) return Promise.reject(new Error("Enter your current PIN"));
      check = hashPin(current, state.settings.pinSalt).then(function (hx) {
        if (hx !== state.settings.pinHash) throw new Error("Current PIN is wrong");
      });
    }
    return check.then(function () {
      var salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
      return hashPin(next, salt).then(function (hx) {
        state.settings.pinSalt = salt; state.settings.pinHash = hx;
        return db.saveSettings(state.settings);
      });
    });
  }
  function clearPin(current) {
    if (!pinSet()) return Promise.resolve();
    if (!current) return Promise.reject(new Error("Enter your current PIN"));
    return hashPin(current, state.settings.pinSalt).then(function (hx) {
      if (hx !== state.settings.pinHash) throw new Error("Current PIN is wrong");
      state.settings.pinHash = ""; state.settings.pinSalt = "";
      stopIdle();
      return db.saveSettings(state.settings);
    });
  }
  // Recovery: set a new PIN without needing the old one (user forgot it).
  function resetPin(next) {
    next = String(next == null ? "" : next);
    if (!/^\d{4,8}$/.test(next)) return Promise.reject(new Error("PIN must be 4–8 digits"));
    var salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return hashPin(next, salt).then(function (hx) {
      state.settings.pinSalt = salt; state.settings.pinHash = hx;
      return db.saveSettings(state.settings);
    });
  }
  // Recovery: clear the PIN entirely from the lock screen (no auth — the app's PIN only deters casual peeking).
  function clearPinNoAuth() {
    state.settings.pinHash = ""; state.settings.pinSalt = "";
    setPinGuard(0, 0);
    return db.saveSettings(state.settings);
  }

  function init() {
    iconize(document);
    // nav
    $$(".nav-item").forEach(function (b) {
      b.addEventListener("click", function () { setView(b.dataset.view); });
    });
    // mobile menu
    var mt = $("#menu-toggle");
    if (mt) mt.addEventListener("click", function () {
      var sb = $("#sidebar");
      sb.classList.toggle("open");
      if (sb.classList.contains("open") && !$(".scrim")) {
        var sc = document.createElement("div");
        sc.className = "scrim";
        sc.addEventListener("click", closeSidebar);
        document.body.appendChild(sc);
      } else closeSidebar();
    });
    // quick backup
    var qe = $("#quick-export");
    if (qe) qe.addEventListener("click", function () { doExport(); });
    // quick lock
    var ql = $("#quick-lock");
    if (ql) ql.addEventListener("click", function () { lockNow(); });
    // search clear: × button and Escape while a search box is focused
    document.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".s-clear") : null;
      if (!b) return;
      var wrap = b.closest(".search");
      var inp = wrap && wrap.querySelector("input");
      if (!inp) return;
      inp.value = "";
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.focus();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var t = e.target;
      if (!t || !t.closest || !t.closest(".search input") || !t.value) return;
      if ($("#modal-root .modal-overlay")) return;
      t.value = "";
      t.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // clock
    tickClock(); setInterval(tickClock, 30000);
    // idle auto-lock
    ["click", "keydown", "touchstart", "scroll"].forEach(function (ev) {
      window.addEventListener(ev, idleBump, { passive: true });
    });

    return reload().then(function () {
      if (pinSet() && !sessionUnlocked()) { showLock(); return; }
      idleBump();
      setView("dashboard");
    });
  }

  function tickClock() {
    var c = $("#clock");
    if (!c) return;
    var d = new Date();
    var days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    c.textContent = days[d.getDay()] + ", " + U.fmtDate(U.toISODate(d)) + " · " +
      ("0" + ((d.getHours() % 12) || 12)).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2) + " " + (d.getHours() >= 12 ? "PM" : "AM");
  }

  function doExport() {
    store.exportAll().then(function (data) {
      var name = "inventory-backup-" + U.todayISO() + ".json";
      U.downloadJSON(name, data);
      toast("Backup downloaded: " + name, "");
    }).catch(function (e) { toast("Export failed: " + e.message, "error"); });
  }

  /* ===================== Theme ===================== */

  var THEME_KEYS = ["green", "dark"];

  function applyTheme(t) {
    if (THEME_KEYS.indexOf(t) < 0) t = "green";
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("fs_theme", t); } catch (e) {}
  }

  /* ==== view functions live in views1.js / views2.js ==== */

  /* One drawn icon set replaces the emoji the app shipped with. 24px grid,
     currentColor stroke, so icons inherit the button's state colour. */
  var ICONS = {
    sale: '<path d="M6.5 3.5h11v17l-2.7-1.6-2.8 1.6-2.8-1.6-2.7 1.6z"/><path d="M9.5 8h5M9.5 11.5h5"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    minus: '<path d="M5.5 12h13"/>',
    leaf: '<path d="M19.5 4.5c-8 0-13 4-13 10.5 0 1.6.4 3 .9 4C10 13 14 10 18 9c-3.5 1.8-7 4.6-8.8 9.6 5 1.4 10.3-2.6 10.3-14.1z"/>',
    box: '<path d="M3.5 8 12 3.5 20.5 8 12 12.5 3.5 8z"/><path d="M3.5 8v8l8.5 5 8.5-5V8"/>',
    users: '<circle cx="9.5" cy="8" r="3.5"/><path d="M3.5 20v-1a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v1"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M17.5 15.2a4 4 0 0 1 3 3.8v1"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>',
    chart: '<path d="M3.5 20.5h17"/><path d="M7 20.5V13M12 20.5V5.5M17 20.5v-5.5"/>',
    factory: '<path d="M2.5 20.5h19"/><path d="M5.5 20.5v-8.5l4.5 2.8v-2.8l4.5 2.8v-2.8l6 3v5.5"/><path d="M5.5 12V8.5H8V12"/>',
    print: '<path d="M7 8.5V4h10v4.5"/><path d="M7 17H5a2 2 0 0 1-2-2v-4.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2h-2"/><path d="M7 14.5h10v6H7z"/>',
    download: '<path d="M12 4v10M8 11l4 4 4-4M4.5 19.5h15"/>',
    search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="M14.5 5.5 18.5 9.5"/>',
    trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13.5h9L17.5 7M10 11v6M14 11v6"/>',
    alert: '<path d="M12 4 21 20H3z"/><path d="M12 10v4M12 17h.01"/>',
    check: '<path d="M5 13l4.5 4.5L19.5 7"/>',
    lock: '<path d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3"/><path d="M5.5 11h13v9.5h-13z"/>',
    db: '<path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M20 12c0 1.7-3.6 3-8 3s-8-1.3-8-3"/>',
    cash: '<path d="M3.5 8.5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M15.5 13.5H19"/>',
    tag: '<path d="M20 12.5 12.5 20 4 12.5V4h8.5z"/><circle cx="8.5" cy="8.5" r="1.6"/>',
    calendar: '<path d="M4 6.5h16v14H4z"/><path d="M4 11h16M8 3.5v4M16 3.5v4"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    cart: '<path d="M3.5 5h2l2.5 10h10l2.5-7.5H7"/><circle cx="9.5" cy="19" r="1.6"/><circle cx="17.5" cy="19" r="1.6"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.2M12 18.3v2.2M4.9 7.8l1.9 1.1M17.2 15.1l1.9 1.1M4.9 16.2l1.9-1.1M17.2 8.9l1.9-1.1"/>',
    doc: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 16h6"/>',
    card: '<path d="M3.5 7h17v11h-17z"/><path d="M3.5 11h17M7 15h3"/>',
    clip: '<path d="M15.5 8.5 9 15a3 3 0 0 1-4.2-4.2l7.5-7.5a4.5 4.5 0 0 1 6.4 6.3l-8 8"/>',
    bulb: '<path d="M9.5 18.5h5M10 21h4"/><path d="M12 3.5a6 6 0 0 1 3.6 10.8c-.7.6-1.1 1.3-1.2 2.2h-4.8c-.1-.9-.5-1.6-1.2-2.2A6 6 0 0 1 12 3.5z"/>',
    chevron: '<path d="M9 6.5 15 12l-6 5.5"/>',
    camera: '<path d="M3.5 8.5h3.5L9 6.5h6l2 2h3.5v11h-17z"/><circle cx="12" cy="13.5" r="3.4"/>',
    upload: '<path d="M12 18V7M8 11l4-4 4 4M4.5 19.5h15"/>',
    back: '<path d="M15 5.5 8 12l7 6.5"/>',
    grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    truck: '<path d="M2.5 6.5h11v10h-11z"/><path d="M13.5 10h4l3 3v3.5h-7z"/><circle cx="7" cy="18.5" r="1.8"/><circle cx="17" cy="18.5" r="1.8"/>',
    hamburger: '<path d="M4 7h16M4 12h16M4 17h16"/>'
  };
  function ico(name, cls) {
    return '<svg class="ico' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      (ICONS[name] || "") + "</svg>";
  }

  /* Static markup carries <i data-ico="name"> and gets the same drawn set as the views. */
  function iconize(root) {
    $$("[data-ico]", root || document).forEach(function (el) {
      var box = document.createElement("div");
      box.innerHTML = ico(el.getAttribute("data-ico"));
      el.replaceWith(box.firstChild);
    });
  }

  /* One metrics ribbon instead of a row of stat cards. Pass {label,value,hint,hue,attr}. */
  function mseg(o) {
    return '<div class="seg' + (o.hue ? " " + o.hue : "") + (o.attr ? " act" : "") + '"' +
      (o.attr ? " " + o.attr + ' role="button" tabindex="0"' : "") + ">" +
      '<div class="k">' + U.escapeHtml(o.label) + '</div><div class="v">' + U.escapeHtml(o.value) +
      '</div><div class="h">' + U.escapeHtml(o.hint || "") + "</div></div>";
  }
  function metrics(segs) {
    return '<div class="metrics">' + segs.map(function (s) { return typeof s === "string" ? s : mseg(s); }).join("") + "</div>";
  }

  /* Empty ledger row: names the situation and the way out. */
  function emptyRow(cols, icon, msg, hint) {
    return '<tr class="empty-row"><td colspan="' + cols + '">' +
      '<div class="er-in">' + ico(icon || "search") + "<div>" + U.escapeHtml(msg) + "</div>" +
      (hint ? '<div class="er-hint">' + U.escapeHtml(hint) + "</div>" : "") + "</div></td></tr>";
  }

  /* The page-open reveal, taken from the product shelves and applied app-wide.
     Only the outermost group of each kind waves; a group inside a card that is
     already rising stays put. Called on view entry, never from a search paint,
     so the counter never re-animates while someone is typing. */
  var REVEAL = [
    [".metrics", null],
    [".cats", null],
    [".ptiles", null],
    [".quick-grid", null],
    [".grid", ".card"],
    [".stack", ".card"],
    [".table-wrap > table > tbody", "tr"]
  ];
  var REVEAL_CAP = 9;
  // Only the first screen of a long list waves. Animating all 270 shelf tiles at
  // once asks a 120Hz panel to composite 270 layers for a fifth of a second,
  // which is exactly the frame drop that reads as "laggy" on the tab.
  var REVEAL_LIMIT = 18;
  var REVEAL_BOX = REVEAL.map(function (g) { return g[0]; }).join(", ");

  function reveal(root) {
    if (state.view === "pos") return;
    var rising = [], g = 0;
    // Document order, so a group's base delay always lands after its parent's.
    $$(REVEAL_BOX, root).forEach(function (box) {
      for (var a = box.parentElement; a; a = a.parentElement) {
        if (rising.indexOf(a) >= 0) return;
      }
      var filt = null;
      REVEAL.forEach(function (grp) { if (box.matches(grp[0])) filt = grp[1]; });
      var kids = box.children;
      var count = kids.length;
      if (!count) return;
      // A wave two screens down is never seen: it only costs the first paint.
      if (box.getBoundingClientRect().top > window.innerHeight * 1.5) return;
      // The wave is compressed across the items that animate, so the head of a
      // long list still reads as one movement rather than a slow crawl.
      var wave = Math.min(count, REVEAL_LIMIT);
      var span = Math.max(1, wave - 1);
      var hit = false, n = 0;
      box.style.setProperty("--b", Math.min(g, 5));
      for (var i = 0; i < count; i++) {
        if (filt && !kids[i].matches(filt)) continue;
        n++;
        if (n > wave) break;
        kids[i].style.setProperty("--i", Math.round((n - 1) * REVEAL_CAP / span));
        kids[i].classList.add("rv");
        rising.push(kids[i]);
        hit = true;
      }
      if (hit) g++;
    });
  }

  // VIEWS is filled by views1.js / views2.js at script load; the render
  // dispatcher only runs after every script has loaded.
  var VIEWS = {};
  FS.ui._VIEWS = VIEWS;
  // Cross-view helpers. Both view files ADD to this object, so neither script
  // order can wipe out the other's entries.
  FS.ui._shared = {};
  FS.ui._helpers = {
    $: $, $$: $$, toast: toast, fieldError: fieldError, modal: modal, confirm: confirm, formData: formData,
    statusBadge: statusBadge, expiryBadge: expiryBadge, setPage: setPage, refresh: refresh,
    state: state, UNITS: UNITS, PAYMENTS: PAYMENTS, doExport: doExport, reload: reload,
    applyTheme: applyTheme, THEME_KEYS: THEME_KEYS, ico: ico, mseg: mseg, metrics: metrics, emptyRow: emptyRow, reveal: reveal,
    exportMenu: exportMenu, closeExportPop: closeExportPop, printDoc: printDoc, setPrintPage: setPrintPage,
    pinSet: pinSet, changePin: changePin, clearPin: clearPin, resetPin: resetPin, lockNow: lockNow
  };
})(window.FS);
