/* =========================================================
   view-credit.js — the credit book
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

  /* =========================== CREDIT BOOK =========================== */
  V.credit = function (el) {
    el.dataset.hue = "due";
    state.credit = state.credit || { q: "", status: "open", customer: "", from: "", to: "", expanded: {} };
    var F = state.credit;
    setPage("Credit Book", "Every credit invoice — outstanding & settled");

    function ageDays(s) {
      var t = Date.parse(s.date || U.todayISO());
      return isNaN(t) ? 0 : Math.max(0, Math.floor((Date.now() - t) / 86400000));
    }
    function all() {
      return state.sales.filter(function (s) { return s.paymentMethod === "Credit" || store.saleDue(s) > 0; })
        .slice().sort(function (a, b) {
          return ((a.date || "") + (a.createdAt || "")).localeCompare((b.date || "") + (b.createdAt || ""));
        });
    }
    var rows0 = all();
    var custs = [];
    rows0.forEach(function (s) { var n = (s.customerName || "").trim(); if (n && custs.indexOf(n) < 0) custs.push(n); });
    custs.sort();

    el.innerHTML =
      '<div id="cr-sum"></div>' +
    '<div class="toolbar">' +
        '<div class="search">' + ico("search","s-ico") + '<input id="cr-q" placeholder="Search invoice or customer…" value="' + h(F.q) + '"><button class="s-clear" type="button" tabindex="-1" aria-label="Clear search">' + ico("close") + '</button></div>' +
        '<select class="select" id="cr-status" style="max-width:140px" title="Status">' +
          '<option value="open"' + (F.status === "open" ? " selected" : "") + ">Open (due)</option>" +
          '<option value="settled"' + (F.status === "settled" ? " selected" : "") + ">Settled</option>" +
          '<option value="all"' + (F.status === "all" ? " selected" : "") + ">All</option></select>" +
        '<select class="select" id="cr-cust" style="max-width:180px" title="Customer"><option value="">All customers</option>' +
          custs.map(function (c) { return '<option value="' + h(c) + '"' + (F.customer === c ? " selected" : "") + ">" + h(c) + "</option>"; }).join("") +
        "</select>" +
        '<input class="input" type="date" id="cr-from" value="' + h(F.from) + '" title="From date" style="max-width:155px">' +
        '<input class="input" type="date" id="cr-to" value="' + h(F.to) + '" title="To date" style="max-width:155px">' +
        '<div class="grow"></div>' +
        '<button class="btn" id="cr-csv" title="Export the credit book as a spreadsheet">' + ico("download") + ' Export</button>' +
      "</div>" +
      '<div id="cr-table" class="mt"></div>';

    function filtered() {
      var q = (F.q || "").trim().toLowerCase();
      return rows0.filter(function (s) {
        var due = store.saleDue(s);
        if (F.status === "open" && due <= 0) return false;
        if (F.status === "settled" && due > 0) return false;
        if (F.customer && (s.customerName || "").trim() !== F.customer) return false;
        if (F.from && (s.date || "") < F.from) return false;
        if (F.to && (s.date || "") > F.to) return false;
        if (q && ((s.invoiceNo || "") + " " + (s.customerName || "") + " " + (s.customerPhone || "")).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
    }

    function payLedger(s) {
      var ps = s.payments || [];
      if (!ps.length) return '<div class="small muted">No payments recorded yet.</div>';
      return '<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th class="num">Amount</th><th>Method / note</th></tr></thead><tbody>' +
        ps.map(function (p) {
          return "<tr><td>" + U.fmtDate(p.date) + '</td><td class="num">' + U.money(p.amount) + "</td>" +
            '<td class="small muted">' + h(p.method || p.note || "") + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }

    function paint() {
      var rows = filtered();
      var open = rows.filter(function (s) { return store.saleDue(s) > 0; });
      var settled = rows.filter(function (s) { return store.saleDue(s) <= 0; });
      var outstanding = U.roundMoney(open.reduce(function (a, s) { return a + store.saleDue(s); }, 0));
      var extended = U.roundMoney(rows.reduce(function (a, s) { return a + Number(s.total || 0); }, 0));
      var oldest = open.length ? Math.max.apply(null, open.map(ageDays)) : 0;
      $("#cr-sum", el).innerHTML = rows0.length ? metrics([
        { label: "Outstanding", value: U.money(outstanding), hint: open.length + " open invoice(s)", hue: "bad" },
        { label: "Oldest open", value: open.length ? oldest + " days" : "—", hint: open.length ? "chase the oldest first" : "nothing outstanding", hue: open.length ? "warn" : "" },
        { label: "Settled", value: settled.length, hint: "fully collected" },
        { label: "Credit extended", value: U.money(extended), hint: "lifetime, in view" }
      ]) : "";

      var body = rows.length ? rows.map(function (s) {
        var due = store.saleDue(s);
        var xp = !!F.expanded[s.id];
        var main = "<tr>" +
          '<td><button class="icon-btn" data-xp="' + s.id + '" title="Show payment ledger">' + ico("chevron", xp ? "chev open" : "chev") + "</button> <strong>" + h(s.invoiceNo) + "</strong></td>" +
          "<td>" + U.fmtDate(s.date) + "</td>" +
          "<td>" + h(s.customerName || "Walk-in") + (s.customerPhone ? '<div class="small muted">' + h(s.customerPhone) + "</div>" : "") + "</td>" +
          '<td class="num">' + U.money(s.total) + "</td>" +
          '<td class="num">' + U.money(Number(s.paid || 0)) + "</td>" +
          '<td class="num">' + (due > 0 ? '<strong style="color:var(--danger)">' + U.money(due) + "</strong>" : U.money(0)) + "</td>" +
          "<td>" + (due > 0 ? ageDays(s) + " d" : "—") + "</td>" +
          '<td><span class="badge ' + (due > 0 ? "red" : "green") + '">' + (due > 0 ? "Open" : "Settled") + "</span></td>" +
          "<td>" + (due > 0 ? '<button class="btn btn-sm btn-primary" data-recv="' + s.id + '">Receive</button> ' : "") +
            (due > 0 ? '<button class="btn btn-sm" data-wa="' + s.id + '" title="Send WhatsApp reminder">' + ico("chat") + '</button> ' : "") +
            '<button class="btn btn-sm" data-vi="' + s.id + '">View</button></td></tr>';
        var detail = xp ? '<tr class="xp-row"><td colspan="9" style="background:var(--panel-2)">' + payLedger(s) + "</td></tr>" : "";
        return main + detail;
      }).join("") : (rows0.length
        ? emptyRow(9, "search", "No credit invoice matches these filters", "Clear the search, or switch Status to All.")
        : emptyRow(9, "card", "Nothing on credit", "Bills sold on Credit show up here until the farmer pays."));

      $("#cr-table", el).innerHTML =
        '<div class="table-wrap"><table class="data"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Due</th><th>Age</th><th>Status</th><th></th></tr></thead><tbody>' +
        body + "</tbody></table></div>";

      $all("[data-recv]", el).forEach(function (b) { b.onclick = function () { openReceiveModal(b.dataset.recv); }; });
      $all("[data-wa]", el).forEach(function (b) {
        b.onclick = function () {
          var s = (state.sales || []).filter(function (x) { return x.id === b.dataset.wa; })[0];
          if (s) FS.ui._shared.waSaleReminder(s);
        };
      });
      $all("[data-vi]", el).forEach(function (b) { b.onclick = function () { S.viewSale(b.dataset.vi); }; });
      $all("[data-xp]", el).forEach(function (b) {
        b.onclick = function () { var id = b.dataset.xp; if (F.expanded[id]) delete F.expanded[id]; else F.expanded[id] = 1; paint(); };
      });
    }

    $("#cr-q", el).addEventListener("input", U.debounce(function () { F.q = $("#cr-q", el).value; paint(); }, 180));
    $("#cr-status", el).onchange = function (e) { F.status = e.target.value; paint(); };
    $("#cr-cust", el).onchange = function (e) { F.customer = e.target.value; paint(); };
    $("#cr-from", el).onchange = function (e) { F.from = e.target.value; paint(); };
    $("#cr-to", el).onchange = function (e) { F.to = e.target.value; paint(); };
    exportMenu($("#cr-csv", el), {
      title: "credit book", unit: "invoice", filename: "credit-book",
      data: function () {
        function row(s) {
          var due = store.saleDue(s);
          return [s.invoiceNo || "", s.date || "", s.customerName || "Walk-in", s.customerPhone || "",
            s.total || 0, Number(s.paid || 0), due, due > 0 ? ageDays(s) : "", due > 0 ? "Open" : "Settled"];
        }
        return {
          columns: ["Invoice", "Date", "Customer", "Phone", "Total", "Paid", "Due", "Age days", "Status"],
          rows: filtered().map(row),
          all: rows0.map(row)
        };
      }
    });
    paint();
  };

  function openReceiveModal(id) {
    store.getSale(id).then(function (sale) {
      if (!sale || sale.id !== id) { toast("Sale not found", "error"); return; }
      var due = store.saleDue(sale);
      if (!(due > 0)) { toast("No outstanding due on this invoice", "warn"); return; }
      modal({
        title: "Receive payment — " + sale.invoiceNo,
        size: "narrow",
        body:
          '<div class="form-grid" style="grid-template-columns:1fr">' +
            '<div class="field"><label>Customer</label><div class="input" style="background:var(--panel-2)">' + h(sale.customerName || "Walk-in") + "</div></div>" +
            '<div class="field"><label>Outstanding due</label><div class="input" style="background:var(--panel-2)">' + U.money(due) + "</div></div>" +
            '<div class="field"><label>Amount received *</label><input class="input" type="number" step="0.01" min="0.01" max="' + due + '" id="rv-amt" value="' + due + '"></div>' +
            '<div class="field"><label>Note (optional)</label><input class="input" id="rv-note" placeholder="e.g. cash collected at shop"></div>' +
          "</div>",
        footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="rv-save">Receive</button>',
        onMount: function (el, close) {
          $("#rv-save", el).onclick = function () {
            var amt = U.num($("#rv-amt", el).value);
            store.receivePayment(id, amt, $("#rv-note", el).value.trim()).then(function () {
              close(); return refresh();
            }).then(function () { toast("Payment received"); })
              .catch(function (e) { toast(e.message || "Could not record payment", "error"); });
          };
        }
      });
    }).catch(function (e) { toast(e.message || "Could not open invoice", "error"); });
  }
  Object.assign(FS.ui._shared, {
    openReceiveModal: openReceiveModal });
})(window.FS);
