/* =========================================================
   view-sales.js — sales history
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

  /* =========================== SALES HISTORY =========================== */
  V.sales = function (el) {
    setPage("Sales History", state.sales.length + " invoice(s)");
    el.dataset.hue = "in";
    var month = U.todayISO().slice(0, 7);
    var mTot = 0, mProfit = 0, mCount = 0, dueAll = 0;
    state.sales.forEach(function (s) {
      dueAll += store.saleDue(s);
      if ((s.date || "").slice(0, 7) === month) { mCount++; mTot += Number(s.total || 0); mProfit += Number(s.profit || 0); }
    });
    el.innerHTML =
      metrics([
        { label: "This month", value: U.money(mTot), hint: mCount + " invoice(s)" },
        { label: "Gross profit", value: U.money(mProfit), hint: "month, on billed stock", hue: "in" },
        { label: "Still to collect", value: U.money(dueAll), hint: dueAll > 0 ? "Credit Book has the list" : "everything is paid", hue: dueAll > 0 ? "bad" : "" },
        { label: "All invoices", value: state.sales.length, hint: "since you started" }
      ]) +
      '<div class="toolbar">' +
        '<div class="search">' + ico("search","s-ico") + '<input id="s-search" placeholder="Search invoice, customer, product…"><button class="s-clear" type="button" tabindex="-1" aria-label="Clear search">' + ico("close") + '</button></div>' +
        '<button class="chip' + (state.salesDueOnly ? " active" : "") + '" id="s-due" title="Show only invoices with outstanding credit">Due only</button>' +
        '<button class="btn" id="s-csv" title="Export these sales as a spreadsheet">' + ico("download") + ' Export</button>' +
        '<button class="btn" id="s-cust">' + ico("users") + ' Customers</button>' +
        '<button class="btn btn-primary" id="s-new">' + ico("sale") + ' New Sale</button>' +
      "</div>" +
      '<div id="sales-table"></div>';

    $("#s-new", el).onclick = function () { ui.setView("pos"); };
    $("#s-cust", el).onclick = function () { ui.setView("customers"); };
    $("#s-due", el).onclick = function () { state.salesDueOnly = !state.salesDueOnly; V.sales(el); };
    var s = $("#s-search", el);
    s.addEventListener("input", U.debounce(function () { paint(); }, 180));

    function saleNames(sale) {
      return (sale.items || []).map(function (it) { var p = state.pmap[it.productId] || {}; return p.name || "?"; });
    }
    function filtered() {
      var q = (s.value || "").trim().toLowerCase();
      return state.sales.filter(function (sale) {
        if (state.salesDueOnly && store.saleDue(sale) <= 0) return false;
        if (!q) return true;
        if ((sale.invoiceNo || "").toLowerCase().indexOf(q) >= 0) return true;
        if ((sale.customerName || "").toLowerCase().indexOf(q) >= 0) return true;
        if ((sale.customerPhone || "").indexOf(q) >= 0) return true;
        return saleNames(sale).some(function (n) { return n.toLowerCase().indexOf(q) >= 0; });
      });
    }

    exportMenu($("#s-csv", el), {
      title: "sales", unit: "invoice", filename: "sales",
      data: function () {
        function row(sale) {
          var due = store.saleDue(sale);
          return [sale.invoiceNo || "", sale.date || "", sale.customerName || "Walk-in", sale.customerPhone || "",
            saleNames(sale).join("; "),
            U.roundQty((sale.items || []).reduce(function (a, it) { return a + Number(it.quantity || 0); }, 0)),
            sale.subtotal || 0, sale.discount || 0, sale.tax || 0, sale.total || 0, Number(sale.paid || 0), due,
            sale.cost || 0, sale.profit || 0, sale.paymentMethod || "Cash", due > 0 ? "Due" : "Paid"];
        }
        return {
          columns: ["Invoice", "Date", "Customer", "Phone", "Items", "Qty", "Subtotal", "Discount", "Tax", "Total", "Paid", "Outstanding", "Cost", "Profit", "Payment", "Status"],
          rows: filtered().map(row),
          all: state.sales.map(row)
        };
      }
    });

    function paint() {
      var rows = filtered();
      var body = rows.length ? rows.map(function (sale) {
        var names = saleNames(sale);
        return "<tr>" +
          "<td><strong>" + h(sale.invoiceNo) + "</strong></td>" +
          "<td>" + U.fmtDate(sale.date) + "</td>" +
          "<td>" + h(sale.customerName || "Walk-in") + (sale.customerPhone ? '<div class="small muted">' + h(sale.customerPhone) + "</div>" : "") + "</td>" +
          '<td class="small">' + h(names.slice(0, 2).join(", ") + (names.length > 2 ? " +" + (names.length - 2) : "")) + "</td>" +
          '<td class="num">' + U.money(sale.total) + "</td>" +
          "<td><span class='badge gray'>" + h(sale.paymentMethod || "Cash") + "</span>" +
            (store.saleDue(sale) > 0 ? '<div style="margin-top:4px"><span class="badge red">Due ' + U.money(store.saleDue(sale)) + "</span></div>" : "") + "</td>" +
          '<td><div class="actions">' +
            '<button class="btn btn-sm" data-view="' + sale.id + '">View</button>' +
            (store.saleDue(sale) > 0 ? '<button class="btn btn-sm btn-primary" data-recv="' + sale.id + '">Receive</button>' : "") +
            '<button class="btn btn-sm btn-danger" data-del="' + sale.id + '">Del</button>' +
          "</div></td></tr>";
      }).join("") : (state.sales.length
        ? emptyRow(7, "search", "No invoice matches these filters", "Clear the search, or turn off Due only.")
        : emptyRow(7, "sale", "No sales recorded yet", "Start one from Point of Sale — every bill lands here."));

      $("#sales-table", el).innerHTML =
        '<div class="table-wrap"><table class="data"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Items</th><th class="num">Total</th><th>Payment</th><th></th></tr></thead><tbody>' + body + "</tbody></table></div>";

      $all("[data-view]", el).forEach(function (b) { b.onclick = function () { viewSale(b.dataset.view); }; });
      $all("[data-recv]", el).forEach(function (b) { b.onclick = function () { S.openReceiveModal(b.dataset.recv); }; });
      $all("[data-del]", el).forEach(function (b) { b.onclick = function () { delSale(b.dataset.del); }; });
    }
    paint();
  };

  function viewSale(id) {
    var sale = state.sales.filter(function (s) { return s.id === id; })[0];
    if (!sale) return;
    modal({
      title: "Invoice " + sale.invoiceNo, size: "wide",
      body: FS.ui._shared.invoiceHTML(sale),
      footer: '<button class="btn" data-close>Close</button><button class="btn btn-primary" id="iv-print">' + ico("print") + ' Print</button>',
      onMount: function (el) { $("#iv-print", el).onclick = function () { FS.ui._shared.printInvoice(sale); }; }
    });
  }

  function delSale(id) {
    store.getSale(id).then(function (sale) {
      if (!sale || sale.id !== id) { toast("Sale not found", "error"); return; }
      confirm({
        title: "Delete sale?", danger: true, okText: "Delete",
        message: "Delete invoice <strong>" + h(sale.invoiceNo || "") + "</strong>? The sold stock will be returned to inventory."
      }).then(function (yes) {
        if (!yes) return;
        store.deleteSale(id).then(refresh).then(function () { toast("Sale deleted, stock restored"); })
          .catch(function (e) { toast(e.message || "Delete failed", "error"); });
      });
    }).catch(function (e) { toast(e.message || "Delete failed", "error"); });
  }
  Object.assign(FS.ui._shared, {
    viewSale: viewSale });
})(window.FS);
