/* =========================================================
   view-reports.js — reports
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

  /* =========================== REPORTS =========================== */
  V.reports = function (el) {
    el.dataset.hue = "info";
    setPage("Reports", "Sales, purchases & inventory insights");
    var r = state.reportRange;
    var last = null;
    el.innerHTML =
      '<div class="toolbar">' +
        '<div class="row" style="gap:6px">' +
          '<span class="tk">Range</span>' +
          '<input class="input" type="date" id="rp-from" value="' + h(r.from) + '" title="From date" style="max-width:155px">' +
          '<span class="tk">to</span>' +
          '<input class="input" type="date" id="rp-to" value="' + h(r.to) + '" title="To date" style="max-width:155px">' +
        "</div>" +
        '<div class="row">' +
          '<button class="btn btn-sm" data-preset="today">Today</button>' +
          '<button class="btn btn-sm" data-preset="7">7 days</button>' +
          '<button class="btn btn-sm" data-preset="30">30 days</button>' +
          '<button class="btn btn-sm" data-preset="month">This month</button>' +
          '<button class="btn btn-sm" data-preset="all">All</button>' +
        "</div>" +
        '<div class="grow"></div>' +
        '<button class="btn btn-primary" id="rp-dl">' + ico("download") + ' Download report</button>' +
      "</div>" +
      '<div id="rp-body" class="mt"></div>';

    $all("[data-preset]", el).forEach(function (b) {
      b.onclick = function () {
        var p = b.dataset.preset, today = U.todayISO();
        if (p === "today") { r.from = today; r.to = today; }
        else if (p === "7") { r.from = isoOffset(-6); r.to = today; }
        else if (p === "30") { r.from = isoOffset(-29); r.to = today; }
        else if (p === "month") { var d = new Date(); r.from = U.toISODate(new Date(d.getFullYear(), d.getMonth(), 1)); r.to = today; }
        else { r.from = ""; r.to = ""; }
        $("#rp-from", el).value = r.from; $("#rp-to", el).value = r.to;
        paintReports();
      };
    });
    $("#rp-from", el).addEventListener("change", function (e) { r.from = e.target.value; paintReports(); });
    $("#rp-to", el).addEventListener("change", function (e) { r.to = e.target.value; paintReports(); });

    function paintReports() {
      var from = r.from, to = r.to;
      var inR = function (x) { var d = x.date; return (!from || d >= from) && (!to || d <= to); };
      var sales = state.sales.filter(inR);
      var purchases = state.purchases.filter(inR);
      var sum = function (a, k) { return U.roundMoney(a.reduce(function (s, x) { return s + Number(x[k] || 0); }, 0)); };
      var revenue = sum(sales, "total"), tax = sum(sales, "tax"), cogs = sum(sales, "cost");
      var profit = U.roundMoney(revenue - tax - cogs);
      var count = sales.length;
      var avg = count ? U.roundMoney(revenue / count) : 0;
      var purchTotal = sum(purchases, "totalAmount");

      var topRev = store.topProducts(sales, true, 5);
      var topQty = store.topProducts(sales, false, 5);

      // monthly grouping
      var mMap = {};
      sales.forEach(function (s) {
        var k = U.monthKey(s.date);
        if (!mMap[k]) mMap[k] = { invoices: 0, revenue: 0, profit: 0 };
        mMap[k].invoices++; mMap[k].revenue += Number(s.total || 0); mMap[k].profit += Number(s.profit || 0);
      });
      var mData = Object.keys(mMap).sort().reverse().map(function (k) {
        var m = mMap[k];
        return { label: U.monthLabel(k), invoices: m.invoices, revenue: U.roundMoney(m.revenue), profit: U.roundMoney(m.profit) };
      });
      var mRows = mData.map(function (m) {
        return "<tr><td>" + h(m.label) + "</td><td class='num'>" + m.invoices + "</td><td class='num'>" + U.money(m.revenue) + "</td><td class='num'>" + U.money(m.profit) + "</td></tr>";
      }).join("");

      // valuation
      var valRows = state.products.map(function (p) {
        var q = stock(p.id);
        var costVal = store.stockValuation(p.id, state.batches);
        var ret = U.roundMoney(q * Number(p.sellPrice || 0));
        return { p: p, q: q, costVal: costVal, ret: ret, margin: U.roundMoney(ret - costVal) };
      });
      var totCost = U.roundMoney(valRows.reduce(function (s, x) { return s + x.costVal; }, 0));
      var totRet = U.roundMoney(valRows.reduce(function (s, x) { return s + x.ret; }, 0));
      var valHTML = valRows.map(function (x) {
        return "<tr><td>" + h(x.p.name) + "</td><td class='num'>" + U.qty(x.q) + " " + h(x.p.unit || "") + "</td><td class='num'>" + U.money(x.costVal) + "</td><td class='num'>" + U.money(x.ret) + "</td><td class='num'>" + U.money(x.margin) + "</td></tr>";
      }).join("");

      var rangeLabel = (from ? U.fmtDate(from) : "start") + " → " + (to ? U.fmtDate(to) : "now");

      $("#rp-body", el).innerHTML =
        metrics([
          { label: "Revenue", value: U.money(revenue), hint: count + " invoice(s)", hue: "in" },
          { label: "Gross profit", value: U.money(profit), hint: "after tax & cost", hue: "info" },
          { label: "Purchases", value: U.money(purchTotal), hint: purchases.length + " record(s)" },
          { label: "Avg. sale", value: U.money(avg), hint: "per invoice" }
        ]) +
        '<div class="card mt"><div class="card-head"><h2>Sales in range</h2><span class="sub">' + h(rangeLabel) + '</span></div>' +
          '<div class="grid cols-2 mt">' +
            '<div><div class="section-title">Top by revenue</div>' + topTable(topRev, true) + "</div>" +
            '<div><div class="section-title">Top by quantity</div>' + topTable(topQty, false) + "</div>" +
          "</div></div>" +
        '<div class="grid cols-2 mt">' +
          '<div class="card"><div class="card-head"><h2>Sales by month</h2>' +
            '<button class="btn btn-sm btn-ghost" id="rp-csv-sales" title="Export this table">' + ico("download") + ' Export</button></div>' +
            (mRows ? '<div class="table-wrap mt-sm"><table class="data"><thead><tr><th>Month</th><th class="num">Invoices</th><th class="num">Revenue</th><th class="num">Profit</th></tr></thead><tbody>' + mRows + "</tbody></table></div>" : '<div class="muted small mt">Nothing sold in this range — pick a wider range, or check a month with trade in it.</div>') + "</div>" +
          '<div class="card" data-hue="due"><div class="card-head"><h2>Inventory valuation</h2>' +
            '<button class="btn btn-sm btn-ghost" id="rp-csv-inv" title="Export this table">' + ico("download") + ' Export</button></div>' +
            '<div class="table-wrap mt-sm" style="max-height:320px;overflow:auto"><table class="data"><thead><tr><th>Product</th><th class="num">Stock</th><th class="num">Cost value</th><th class="num">Retail value</th><th class="num">Margin</th></tr></thead><tbody>' +
              (valHTML || emptyRow(5, "box", "No product in this range", "Every product with a cost or price shows here.")) +
              '<tr class="total-row"><td>Total</td><td></td><td class="num">' + U.money(totCost) + "</td><td class='num'>" + U.money(totRet) + "</td><td class='num'>" + U.money(totRet - totCost) + "</td></tr>" +
            "</tbody></table></div></div>" +
        "</div>";

      exportMenu($("#rp-csv-sales", el), {
        title: "sales by month", unit: "month", filename: "sales-by-month",
        data: function () {
          return {
            columns: ["Month", "Invoices", "Revenue", "Profit"],
            rows: mData.map(function (m) { return [m.label, m.invoices, m.revenue, m.profit]; })
          };
        }
      });
      exportMenu($("#rp-csv-inv", el), {
        title: "inventory valuation", unit: "product", filename: "inventory-valuation",
        data: function () {
          function row(x) { return [x.p.name, x.p.category || "", x.p.npk || "", x.p.unit || "", x.q, x.costVal, x.ret, x.margin]; }
          var rows = valRows.map(row);
          if (rows.length) rows.push(["Total", "", "", "", "", totCost, totRet, totRet - totCost]);
          return {
            columns: ["Product", "Category", "NPK", "Unit", "Stock", "Cost value", "Retail value", "Margin"],
            rows: rows
          };
        }
      });

      last = {
        sales: sales, purchases: purchases, revenue: revenue, profit: profit, purchTotal: purchTotal,
        count: count, avg: avg, topRev: topRev, topQty: topQty, mData: mData, valRows: valRows,
        totCost: totCost, totRet: totRet, rangeLabel: rangeLabel
      };
    }

    function topTable(arr, byRev) {
      if (!arr.length) return '<div class="muted small">Nothing sold here in this range.</div>';
      var rows = arr.map(function (t) {
        var p = state.pmap[t.productId] || {};
        return "<tr><td>" + h(p.name || "?") + "</td><td class='num'>" + U.qty(t.qty) + "</td><td class='num'>" + U.money(t.revenue) + "</td></tr>";
      }).join("");
      return '<div class="table-wrap"><table class="data"><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Revenue</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
    }

    paintReports();

    $("#rp-dl", el).onclick = function () {
      if (!last) return;
      var pname = function (id) { return (state.pmap[id] || {}).name || "?"; };
      var M = function (v) { return U.money(v || 0); };
      var blocks = [];
      blocks.push({ caption: "Summary", kv: [["Revenue", M(last.revenue)], ["Gross profit", M(last.profit)], ["Purchases", M(last.purchTotal)], ["Invoices", String(last.count)], ["Average sale", M(last.avg)]] });
      blocks.push({ caption: "Sales by month", columns: ["Month", "Invoices", "Revenue", "Profit"], numCols: [1, 2, 3], rows: last.mData.map(function (m) { return [m.label, m.invoices, M(m.revenue), M(m.profit)]; }) });
      blocks.push({ caption: "Top products by revenue", columns: ["Product", "Qty", "Revenue"], numCols: [1, 2], rows: last.topRev.map(function (t) { return [pname(t.productId), U.qty(t.qty), M(t.revenue)]; }) });
      blocks.push({ caption: "Top products by quantity", columns: ["Product", "Qty", "Revenue"], numCols: [1, 2], rows: last.topQty.map(function (t) { return [pname(t.productId), U.qty(t.qty), M(t.revenue)]; }) });
      var invRows = last.valRows.map(function (x) { return [x.p.name, x.p.category || "", x.p.npk || "", x.p.unit || "", U.qty(x.q), M(x.costVal), M(x.ret), M(x.margin)]; });
      invRows.push(["Total", "", "", "", "", M(last.totCost), M(last.totRet), M(last.totRet - last.totCost)]);
      blocks.push({ caption: "Inventory valuation", columns: ["Product", "Category", "NPK", "Unit", "Stock", "Cost value", "Retail value", "Margin"], numCols: [4, 5, 6, 7], rows: invRows });
      blocks.push({ caption: "Purchases in range", columns: ["Ref", "Date", "Supplier", "Items", "Total"], numCols: [3, 4], rows: last.purchases.map(function (p) { return [p.invoiceNo, p.date, (state.smapSup[p.supplierId] || {}).name || "", (p.items || []).length, M(p.totalAmount)]; }) });
      blocks.push({ caption: "Sales in range", columns: ["Invoice", "Date", "Customer", "Subtotal", "Discount", "Tax", "Total", "Cost", "Profit", "Payment"], numCols: [3, 4, 5, 6, 7, 8], rows: last.sales.map(function (s) { return [s.invoiceNo, s.date, s.customerName || "", M(s.subtotal), M(s.discount), M(s.tax), M(s.total), M(s.cost), M(s.profit), s.paymentMethod || ""]; }) });
      H.printDoc({ title: "Report", subtitle: "Range: " + (last.rangeLabel || ""), blocks: blocks });
    };
  };
})(window.FS);
