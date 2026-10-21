/* =========================================================
   view-suppliers.js — suppliers
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

  /* =========================== SUPPLIERS =========================== */
  V.suppliers = function (el) {
    state.supHist = state.supHist || { sel: null, from: "", to: "", q: "" };
    if (state.supHist.sel) { renderSupplierDetail(el, state.supHist); return; }
    setPage("Suppliers", state.suppliers.length + " supplier(s)");
    el.dataset.hue = "info";
    var spSpend = U.roundMoney(state.purchases.reduce(function (a, p) { return a + Number(p.totalAmount || 0); }, 0));
    var spOwed = U.roundMoney(state.purchases.reduce(function (a, p) { return a + store.purchaseDue(p); }, 0));
    var spActive = {}; state.purchases.forEach(function (p) { if (p.supplierId) spActive[p.supplierId] = 1; });
    el.innerHTML =
      metrics([
        { label: "Suppliers", value: state.suppliers.length, hint: Object.keys(spActive).length + " bought from so far" },
        { label: "Bought for", value: U.money(spSpend), hint: "all purchase bills" },
        { label: "Owed now", value: U.money(spOwed), hint: spOwed > 0 ? "Payables has the bills" : "nothing outstanding", hue: spOwed > 0 ? "bad" : "" }
      ]) +
      '<div class="toolbar"><div class="grow"></div>' +
        '<button class="btn" id="sp-csv" title="Export your supplier list as a spreadsheet">' + ico("download") + ' Export</button>' +
        '<button class="btn btn-primary" id="sp-add">' + ico("plus") + ' Add Supplier</button></div>' +
      '<div id="sp-list"></div>';
    $("#sp-add", el).onclick = function () { openSupplierModal(null); };

    exportMenu($("#sp-csv", el), {
      title: "suppliers", unit: "supplier", filename: "suppliers",
      data: function () {
        function row(s) {
          var purch = state.purchases.filter(function (p) { return p.supplierId === s.id; });
          var spend = U.roundMoney(purch.reduce(function (a, p) { return a + Number(p.totalAmount || 0); }, 0));
          var last = purch.map(function (p) { return p.date || ""; }).sort().pop() || "";
          return [s.name || "", s.phone || "", s.email || "", s.address || "", s.gstin || "",
            purch.length, spend, last, s.notes || ""];
        }
        return {
          columns: ["Name", "Phone", "Email", "Address", "GSTIN", "Purchases", "Total spend", "Last purchase", "Notes"],
          rows: state.suppliers.map(row)
        };
      }
    });

    var body = state.suppliers.length ? state.suppliers.map(function (s) {
      var purch = state.purchases.filter(function (p) { return p.supplierId === s.id; });
      var spend = U.roundMoney(purch.reduce(function (a, p) { return a + Number(p.totalAmount || 0); }, 0));
      var owed = U.roundMoney(purch.reduce(function (a, p) { return a + store.purchaseDue(p); }, 0));
      return '<div class="card"><div class="spread">' +
        "<div><strong style='font-size:15px'>" + h(s.name) + "</strong>" +
          '<div class="small muted">' + [s.phone, s.email].filter(Boolean).map(h).join(" · ") + "</div>" +
          (s.address ? '<div class="small soft">' + h(s.address) + "</div>" : "") +
          (s.notes ? '<div class="small muted mt-sm">' + h(s.notes) + "</div>" : "") + "</div>" +
        '<div class="right"><div class="row" style="gap:6px;justify-content:flex-end"><span class="badge blue">' + purch.length + " purchase(s)</span>" +
          (owed > 0 ? '<span class="badge red">Owe ' + U.money(owed) + "</span>" : "") + "</div>" +
          '<div class="small muted mt-sm">Spend: ' + U.money(spend) + "</div>" +
          '<div class="actions mt-sm" style="justify-content:flex-end">' +
            (owed > 0 ? '<button class="btn btn-sm" data-payable="' + s.id + '">Payables</button>' : "") +
            '<button class="btn btn-sm" data-hist="' + s.id + '">History</button>' +
            '<button class="btn btn-sm" data-edit="' + s.id + '">Edit</button>' +
            '<button class="btn btn-sm btn-danger" data-del="' + s.id + '">Del</button>' +
          "</div></div>" +
      "</div></div>";
    }).join("") : '<div class="empty-state">' + ico("factory") + 'No suppliers yet<div class="es-hint">Add the companies you buy from — their bills, phone numbers and outstanding dues stay with the name.</div></div>'

    $("#sp-list", el).innerHTML = '<div class="stack">' + body + "</div>";
    $all("[data-hist]", el).forEach(function (b) {
      b.onclick = function () { state.supHist.sel = b.dataset.hist; ui.setView("suppliers"); };
    });
    $all("[data-payable]", el).forEach(function (b) {
      b.onclick = function () {
        state.payables = Object.assign(state.payables || {}, { q: "", status: "open", supplier: b.dataset.payable, from: "", to: "", expanded: {} });
        ui.setView("payables");
      };
    });
    $all("[data-edit]", el).forEach(function (b) {
      b.onclick = function () { openSupplierModal(state.smapSup[b.dataset.edit]); };
    });
    $all("[data-del]", el).forEach(function (b) {
      b.onclick = function () {
        var s = state.smapSup[b.dataset.del] || {};
        confirm({ title: "Delete supplier?", danger: true, okText: "Delete", message: "Delete <strong>" + h(s.name) + "</strong>? Past purchases are kept." })
          .then(function (yes) { if (!yes) return; store.deleteSupplier(b.dataset.del).then(refresh).then(function () { toast("Supplier deleted"); })
            .catch(function (e) { toast(e.message || "Delete failed", "error"); }); });
      };
    });
  };

  function renderSupplierDetail(el, F) {
    var s = state.smapSup[F.sel];
    if (!s) { F.sel = null; V.suppliers(el); return; }
    var all = state.purchases.filter(function (p) { return p.supplierId === s.id; })
      .slice().sort(function (a, b) { return ((b.date || "") + (b.createdAt || "")).localeCompare((a.date || "") + (a.createdAt || "")); });
    setPage(s.name, [s.phone, s.email].filter(Boolean).join(" · ") + " · " + all.length + " purchase(s)");

    el.innerHTML =
      '<div id="sd-sum"></div>' +
    '<div class="toolbar">' +
        '<button class="btn" id="sd-back">' + ico("back") + ' All suppliers</button>' +
        '<div class="search">' + ico("search","s-ico") + '<input id="sd-q" placeholder="Search invoice or product…" value="' + h(F.q) + '"><button class="s-clear" type="button" tabindex="-1" aria-label="Clear search">' + ico("close") + '</button></div>' +
        '<input class="input" type="date" id="sd-from" value="' + h(F.from) + '" title="From date" style="max-width:155px">' +
        '<input class="input" type="date" id="sd-to" value="' + h(F.to) + '" title="To date" style="max-width:155px">' +
        '<div class="grow"></div>' +
        '<button class="btn" id="sd-edit">Edit</button>' +
        '<button class="btn" id="sd-csv" title="Export this supplier\'s purchases as a spreadsheet">' + ico("download") + ' Export</button>' +
      "</div>" +
      '<div id="sd-table" class="mt"></div>';

    function pItems(p) {
      return (p.items || []).map(function (it) { var pr = state.pmap[it.productId] || {}; return pr.name || "?"; });
    }
    function filtered() {
      var q = (F.q || "").trim().toLowerCase();
      return all.filter(function (p) {
        if (F.from && (p.date || "") < F.from) return false;
        if (F.to && (p.date || "") > F.to) return false;
        if (q) {
          var hay = (p.invoiceNo + " " + pItems(p).join(" ")).toLowerCase();
          if (hay.indexOf(q) < 0) return false;
        }
        return true;
      });
    }
    function paint() {
      var rows = filtered();
      var spend = U.roundMoney(rows.reduce(function (a, p) { return a + Number(p.totalAmount || 0); }, 0));
      var qty = U.roundQty(rows.reduce(function (a, p) { return a + (p.items || []).reduce(function (x, it) { return x + Number(it.quantity || 0); }, 0); }, 0));
      var lines = rows.reduce(function (a, p) { return a + (p.items || []).length; }, 0);
      $("#sd-sum", el).innerHTML = metrics([
        { label: "Purchases", value: rows.length, hint: "of " + all.length + " total" },
        { label: "Spend", value: U.money(spend), hint: lines + " item line(s) in view" },
        { label: "Quantity", value: U.qty(qty), hint: "units received in view" },
        { label: "Last purchase", value: all.length ? U.fmtDate(all[0].date) : "—", hint: "most recent delivery" }
      ]);

      var body = rows.length ? rows.map(function (p) {
        var names = pItems(p);
        var qtyP = U.roundQty((p.items || []).reduce(function (x, it) { return x + Number(it.quantity || 0); }, 0));
        return "<tr>" +
          "<td>" + U.fmtDate(p.date) + "</td>" +
          "<td><strong>" + h(p.invoiceNo) + "</strong></td>" +
          '<td class="small">' + h(names.slice(0, 3).join(", ")) + (names.length > 3 ? " +" + (names.length - 3) : "") + "</td>" +
          '<td class="num">' + U.qty(qtyP) + "</td>" +
          '<td class="num">' + U.money(p.totalAmount) + "</td>" +
          (p.bill ? "<td>" + ico("clip") + " " + h(p.bill.name) + "</td>" : '<td class="muted">—</td>') +
          '<td><button class="btn btn-sm" data-vp="' + p.id + '">View</button></td></tr>';
      }).join("") : (all.length
        ? emptyRow(7, "search", "No purchase matches this search", "Try the bill number or a product name.")
        : emptyRow(7, "factory", "No purchases from this supplier yet", "Record a purchase and it appears on this card."));

      $("#sd-table", el).innerHTML =
        '<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Invoice</th><th>Items</th><th class="num">Qty</th><th class="num">Total</th><th>Bill</th><th></th></tr></thead><tbody>' +
        body + "</tbody></table></div>";

      $all("[data-vp]", el).forEach(function (b) { b.onclick = function () { S.viewPurchase(b.dataset.vp); }; });
    }

    $("#sd-back", el).onclick = function () { F.sel = null; ui.setView("suppliers"); };
    $("#sd-edit", el).onclick = function () { openSupplierModal(s); };
    $("#sd-q", el).addEventListener("input", U.debounce(function () { F.q = $("#sd-q", el).value; paint(); }, 180));
    $("#sd-from", el).onchange = function (e) { F.from = e.target.value; paint(); };
    $("#sd-to", el).onchange = function (e) { F.to = e.target.value; paint(); };
    exportMenu($("#sd-csv", el), {
      title: s.name + " — purchases", unit: "purchase", filename: "supplier-" + U.safeName(s.name),
      data: function () {
        function row(p) {
          return [p.date || "", p.invoiceNo || "", s.name || "", pItems(p).join("; "),
            (p.items || []).length,
            U.roundQty((p.items || []).reduce(function (x, it) { return x + Number(it.quantity || 0); }, 0)),
            p.totalAmount || 0];
        }
        return {
          columns: ["Date", "Invoice", "Supplier", "Items", "Item lines", "Qty", "Total"],
          rows: filtered().map(row),
          all: all.map(row)
        };
      }
    });
    paint();
  }

  function openSupplierModal(s) {
    var isNew = !s; s = s || {};
    var body =
      '<form id="spf"><div class="form-grid">' +
        '<div class="field full"><label>Name *</label><input class="input" name="name" required value="' + h(s.name || "") + '"></div>' +
        '<div class="field"><label>Phone</label><input class="input" name="phone" value="' + h(s.phone || "") + '"></div>' +
        '<div class="field"><label>Email</label><input class="input" name="email" value="' + h(s.email || "") + '"></div>' +
        '<div class="field full"><label>Address</label><input class="input" name="address" value="' + h(s.address || "") + '"></div>' +
        '<div class="field full"><label>Notes</label><textarea class="textarea" name="notes">' + h(s.notes || "") + "</textarea></div>" +
      "</div></form>";
    modal({
      title: isNew ? "Add Supplier" : "Edit Supplier", body: body,
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="spf-save">Save</button>',
      onMount: function (el, close) {
        $("#spf-save", el).onclick = function () {
          var f = $("#spf", el), d = formData(f);
          if (!(d.name || "").trim()) { fieldError(f, "name", "Supplier name is required"); return; }
          store.saveSupplier({ id: s.id, name: d.name.trim(), phone: d.phone.trim(), email: d.email.trim(), address: d.address.trim(), notes: d.notes.trim() })
            .then(function () { close(); return refresh(); }).then(function () { toast(isNew ? "Supplier added" : "Supplier updated"); })
            .catch(function (e) { toast(e.message, "error"); });
        };
      }
    });
  }
})(window.FS);
