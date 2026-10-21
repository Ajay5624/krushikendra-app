/* =========================================================
   view-payables.js — supplier payables
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

  /* =========================== PAYABLES (supplier ledger) =========================== */
  V.payables = function (el) {
    el.dataset.hue = "due";
    state.payables = Object.assign({ q: "", status: "open", supplier: "", from: "", to: "", expanded: {} }, state.payables || {});
    var F = state.payables;
    setPage("Payables", "Money you owe suppliers — outstanding & settled");

    function ageDays(p) {
      var t = Date.parse(p.date || U.todayISO());
      return isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 86400000));
    }
    function supName(id) { return (state.smapSup[id] || {}).name || "—"; }
    function all() {
      return state.purchases.filter(function (p) { return p.paymentMethod === "Credit" || store.purchaseDue(p) > 0; })
        .slice().sort(function (a, b) {
          return ((a.date || "") + (a.createdAt || "")).localeCompare((b.date || "") + (b.createdAt || ""));
        });
    }
    var rows0 = all();
    var sups = [];
    rows0.forEach(function (p) { if (p.supplierId && sups.indexOf(p.supplierId) < 0) sups.push(p.supplierId); });
    sups.sort(function (a, b) { return supName(a).localeCompare(supName(b)); });

    el.innerHTML =
      '<div id="pa-sum"></div>' +
    '<div class="toolbar">' +
        '<div class="search">' + ico("search","s-ico") + '<input id="pa-q" placeholder="Search invoice or supplier…" value="' + h(F.q) + '"><button class="s-clear" type="button" tabindex="-1" aria-label="Clear search">' + ico("close") + '</button></div>' +
        '<select class="select" id="pa-status" style="max-width:140px" title="Status">' +
          '<option value="open"' + (F.status === "open" ? " selected" : "") + ">Open (owed)</option>" +
          '<option value="settled"' + (F.status === "settled" ? " selected" : "") + ">Settled</option>" +
          '<option value="all"' + (F.status === "all" ? " selected" : "") + ">All</option></select>" +
        '<select class="select" id="pa-sup" style="max-width:190px" title="Supplier"><option value="">All suppliers</option>' +
          sups.map(function (id) { return '<option value="' + h(id) + '"' + (F.supplier === id ? " selected" : "") + ">" + h(supName(id)) + "</option>"; }).join("") +
        "</select>" +
        '<input class="input" type="date" id="pa-from" value="' + h(F.from) + '" title="From date" style="max-width:155px">' +
        '<input class="input" type="date" id="pa-to" value="' + h(F.to) + '" title="To date" style="max-width:155px">' +
        '<div class="grow"></div>' +
        '<button class="btn" id="pa-wa" title="WhatsApp a statement to the selected supplier">' + ico("chat") + ' Remind</button>' +
        '<button class="btn" id="pa-stmt" title="Print a payables statement">' + ico("print") + ' Statement</button>' +
        '<button class="btn" id="pa-csv" title="Export payables as a spreadsheet">' + ico("download") + ' Export</button>' +
      "</div>" +
      '<div id="pa-table" class="mt"></div>';

    function filtered() {
      var q = (F.q || "").trim().toLowerCase();
      return rows0.filter(function (p) {
        var due = store.purchaseDue(p);
        if (F.status === "open" && due <= 0) return false;
        if (F.status === "settled" && due > 0) return false;
        if (F.supplier && p.supplierId !== F.supplier) return false;
        if (F.from && (p.date || "") < F.from) return false;
        if (F.to && (p.date || "") > F.to) return false;
        if (q && ((p.invoiceNo || "") + " " + supName(p.supplierId)).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
    }

    function payLedger(p) {
      var ps = p.payments || [];
      if (!ps.length) return '<div class="small muted">No payments recorded yet.</div>';
      return '<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th class="num">Amount</th><th>Method / note</th></tr></thead><tbody>' +
        ps.map(function (x) {
          return "<tr><td>" + U.fmtDate(x.date) + '</td><td class="num">' + U.money(x.amount) + "</td>" +
            '<td class="small muted">' + h(x.method || x.note || "") + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }

    function paint() {
      var rows = filtered();
      var open = rows.filter(function (p) { return store.purchaseDue(p) > 0; });
      var settled = rows.filter(function (p) { return store.purchaseDue(p) <= 0; });
      var outstanding = U.roundMoney(open.reduce(function (a, p) { return a + store.purchaseDue(p); }, 0));
      var purchased = U.roundMoney(rows.reduce(function (a, p) { return a + Number(p.totalAmount || 0); }, 0));
      var oldest = open.length ? Math.max.apply(null, open.map(ageDays)) : 0;
      $("#pa-sum", el).innerHTML = rows0.length ? metrics([
        { label: "Payable now", value: U.money(outstanding), hint: open.length + " open bill(s)", hue: "bad" },
        { label: "Oldest open", value: open.length ? oldest + " days" : "—", hint: open.length ? "settle the oldest first" : "nothing owed", hue: open.length ? "warn" : "" },
        { label: "Settled", value: settled.length, hint: "fully paid" },
        { label: "Purchased", value: U.money(purchased), hint: "lifetime, in view" }
      ]) : "";

      var body = rows.length ? rows.map(function (p) {
        var due = store.purchaseDue(p);
        var xp = !!F.expanded[p.id];
        var main = "<tr>" +
          '<td><button class="icon-btn" data-xp="' + p.id + '" title="Show payment ledger">' + ico("chevron", xp ? "chev open" : "chev") + "</button> <strong>" + h(p.invoiceNo) + "</strong></td>" +
          "<td>" + U.fmtDate(p.date) + "</td>" +
          "<td>" + h(supName(p.supplierId)) + "</td>" +
          '<td class="num">' + U.money(p.totalAmount) + "</td>" +
          '<td class="num">' + U.money(Number(p.paid || 0)) + "</td>" +
          '<td class="num">' + (due > 0 ? '<strong style="color:var(--danger)">' + U.money(due) + "</strong>" : U.money(0)) + "</td>" +
          "<td>" + (due > 0 ? ageDays(p) + " d" : "—") + "</td>" +
          '<td><span class="badge ' + (due > 0 ? "red" : "green") + '">' + (due > 0 ? "Owed" : "Paid") + "</span></td>" +
          "<td>" + (due > 0 ? '<button class="btn btn-sm btn-primary" data-pay="' + p.id + '">Pay</button> ' : "") +
            (due > 0 ? '<button class="btn btn-sm" data-wa="' + p.id + '" title="WhatsApp reminder to supplier">' + ico("chat") + '</button> ' : "") +
            '<button class="btn btn-sm" data-vp="' + p.id + '">View</button></td></tr>';
        var detail = xp ? '<tr class="xp-row"><td colspan="9" style="background:var(--panel-2)">' + payLedger(p) + "</td></tr>" : "";
        return main + detail;
      }).join("") : (rows0.length
        ? emptyRow(9, "search", "No payable bill matches these filters", "Clear the search, or switch Status to All.")
        : emptyRow(9, "factory", "You owe no supplier", "Purchases marked Credit appear here until you pay them."));

      $("#pa-table", el).innerHTML =
        '<div class="table-wrap"><table class="data"><thead><tr><th>Invoice</th><th>Date</th><th>Supplier</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Due</th><th>Age</th><th>Status</th><th></th></tr></thead><tbody>' +
        body + "</tbody></table></div>";

      $all("[data-pay]", el).forEach(function (b) { b.onclick = function () { S.openPaySupplierModal(b.dataset.pay); }; });
      $all("[data-wa]", el).forEach(function (b) {
        b.onclick = function () {
          var p = (state.purchases || []).filter(function (x) { return x.id === b.dataset.wa; })[0];
          if (p) waPurchaseReminder(p);
        };
      });
      $all("[data-vp]", el).forEach(function (b) { b.onclick = function () { S.viewPurchase(b.dataset.vp); }; });
      $all("[data-xp]", el).forEach(function (b) {
        b.onclick = function () { var id = b.dataset.xp; if (F.expanded[id]) delete F.expanded[id]; else F.expanded[id] = 1; paint(); };
      });
    }

    $("#pa-q", el).addEventListener("input", U.debounce(function () { F.q = $("#pa-q", el).value; paint(); }, 180));
    $("#pa-status", el).onchange = function (e) { F.status = e.target.value; paint(); };
    $("#pa-sup", el).onchange = function (e) { F.supplier = e.target.value; paint(); };
    $("#pa-from", el).onchange = function (e) { F.from = e.target.value; paint(); };
    $("#pa-to", el).onchange = function (e) { F.to = e.target.value; paint(); };
    $("#pa-stmt", el).onclick = function () { printPayablesStatement(filtered()); };
    $("#pa-wa", el).onclick = function () {
      if (!F.supplier) { toast("Pick a supplier first, then tap Remind", "warn"); return; }
      waSupplierStatement(F.supplier);
    };
    exportMenu($("#pa-csv", el), {
      title: "payables", unit: "bill", filename: "supplier-payables",
      data: function () {
        function row(p) {
          var due = store.purchaseDue(p);
          return [p.invoiceNo || "", p.date || "", supName(p.supplierId), (state.smapSup[p.supplierId] || {}).phone || "",
            p.totalAmount || 0, Number(p.paid || 0), due, due > 0 ? ageDays(p) : "", due > 0 ? "Owed" : "Paid"];
        }
        return {
          columns: ["Invoice", "Date", "Supplier", "Phone", "Total", "Paid", "Due", "Age days", "Status"],
          rows: filtered().map(row),
          all: rows0.map(row)
        };
      }
    });
    paint();
  };

  function supplierDueText(name, lines, totalDue) {
    var s = state.settings;
    return "Namaste " + name + " ji,\n" +
      "Payment status from " + (s.shopName || "our shop") + ".\n\n" +
      (lines.length ? "Pending purchase bill(s):\n" + lines.join("\n") + "\n\n" : "") +
      "Total payable: " + U.money(totalDue) + "\n" +
      "We will settle this soon. Thank you!";
  }

  function waPurchaseReminder(p) {
    var due = store.purchaseDue(p);
    if (!(due > 0)) { toast("This purchase is fully paid", "warn"); return; }
    var sup = state.smapSup[p.supplierId] || {};
    FS.ui._shared.waOpen(sup.phone, supplierDueText(sup.name || "Supplier",
      ["- " + p.invoiceNo + " (" + U.fmtDate(p.date) + "): " + U.money(due)], due), "supplier");
  }

  function waSupplierStatement(supId) {
    var sup = state.smapSup[supId] || {};
    var open = state.purchases.filter(function (p) { return p.supplierId === supId && store.purchaseDue(p) > 0; });
    if (!open.length) { toast("Nothing owed to " + (sup.name || "this supplier"), "warn"); return; }
    var totalDue = U.roundMoney(open.reduce(function (a, p) { return a + store.purchaseDue(p); }, 0));
    var lines = open.map(function (p) { return "- " + p.invoiceNo + " (" + U.fmtDate(p.date) + "): " + U.money(store.purchaseDue(p)); });
    FS.ui._shared.waOpen(sup.phone, supplierDueText(sup.name || "Supplier", lines, totalDue), "supplier");
  }

  function printPayablesStatement(rows) {
    if (!rows.length) { toast("Nothing to print — no payables in view", "warn"); return; }
    var s = state.settings;
    var bySup = {};
    rows.forEach(function (p) { var k = p.supplierId || ""; (bySup[k] = bySup[k] || []).push(p); });
    var keys = Object.keys(bySup).sort(function (a, b) {
      return ((state.smapSup[a] || {}).name || "").localeCompare((state.smapSup[b] || {}).name || "");
    });
    var grand = 0;
    var blocks = keys.map(function (k) {
      var sup = state.smapSup[k] || {};
      var ps = bySup[k].slice().sort(function (a, b) { return (a.date || "").localeCompare(b.date || ""); });
      var sub = 0;
      var trs = ps.map(function (p) {
        var due = store.purchaseDue(p); sub = U.roundMoney(sub + due);
        return "<tr><td>" + h(p.invoiceNo) + "</td><td>" + U.fmtDate(p.date) + '</td><td class="num">' + U.money(p.totalAmount) +
          '</td><td class="num">' + U.money(Number(p.paid || 0)) + '</td><td class="num">' + U.money(due) + "</td></tr>";
      }).join("");
      grand = U.roundMoney(grand + sub);
      return '<div class="rc-cat">' + h(sup.name || "Supplier") + (sup.phone ? " · " + h(sup.phone) : "") + "</div>" +
        '<table class="inv"><thead><tr><th>Invoice</th><th>Date</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Due</th></tr></thead><tbody>' +
        trs + '<tr class="total-row"><td colspan="4">Payable to ' + h(sup.name || "supplier") + '</td><td class="num">' + U.money(sub) + "</td></tr></tbody></table>";
    }).join("");
    var area = $("#print-area");
    area.className = "print-area";
    H.setPrintPage(false); // five narrow columns — portrait, and never the previous job's page style
    area.innerHTML =
      '<div class="invoice">' +
        '<div class="inv-copy">Payables Statement</div>' +
        '<div class="inv-head"><div class="inv-shop"><div>' +
          "<h2>" + h(s.shopName || "Shop") + "</h2>" +
          '<div class="small">Money owed to suppliers — ' + U.fmtDate(U.todayISO()) + "</div>" +
        "</div></div>" +
        '<div class="inv-meta"><div style="font-size:16px;font-weight:700;color:#111">' + keys.length + " supplier(s)</div>" +
          "<div>Total payable " + U.money(grand) + "</div></div></div>" +
        blocks +
        '<div class="inv-foot">Prepared from your purchase records. Verify before paying.</div>' +
      "</div>";
    setTimeout(function () { window.print(); }, 60);
  }
})(window.FS);
