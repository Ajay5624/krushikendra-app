/* =========================================================
   view-dashboard.js — the counter overview
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

  /* =========================== DASHBOARD =========================== */
  V.dashboard = function (el) {
    setPage("Dashboard", state.settings.shopName || "");
    var smap = state.stockMap;
    var batches = state.batches, products = state.products, sales = state.sales;
    var stockValue = U.roundMoney(batches.reduce(function (s, b) { return s + (Number(b.quantity) || 0) * (Number(b.unitCost) || 0); }, 0));
    var retailValue = U.roundMoney(products.reduce(function (s, p) { return s + (smap[p.id] || 0) * (Number(p.sellPrice) || 0); }, 0));
    var today = U.todayISO(), mk = U.monthKey(today);
    var todaySales = sales.filter(function (s) { return s.date === today; });
    var monthSales = sales.filter(function (s) { return U.monthKey(s.date) === mk; });
    var sum = function (a) { return U.roundMoney(a.reduce(function (s, x) { return s + Number(x.total || 0); }, 0)); };
    var low = store.reorderList(products, smap, store.stockedSet(batches));
    var expiring = store.expiringSoon(batches, state.settings.expiryWarnDays);
    var creditDue = U.roundMoney(sales.reduce(function (s, x) { return s + store.saleDue(x); }, 0));
    var creditCount = sales.filter(function (x) { return store.saleDue(x) > 0; }).length;
    var warnDays = state.settings.expiryWarnDays || 60;

    // last 7 days
    var keys = []; for (var i = 6; i >= 0; i--) keys.push(isoOffset(-i));
    var dmap = {}; keys.forEach(function (k) { dmap[k] = 0; });
    sales.forEach(function (s) { if (dmap[s.date] != null) dmap[s.date] = U.roundMoney(dmap[s.date] + Number(s.total || 0)); });
    var maxDay = Math.max.apply(null, keys.map(function (k) { return dmap[k]; }));
    // The guard is for the bar maths only; showing it would print a best day of
    // ₹1 on a shop that has not sold anything.
    var barScale = Math.max(maxDay, 1);
    var weekTotal = U.roundMoney(keys.reduce(function (a, k) { return a + dmap[k]; }, 0));
    var bars = keys.map(function (k, idx) {
      var hgt = Math.round((dmap[k] / barScale) * 100);
      var isToday = idx === keys.length - 1;
      return '<div class="bar-col' + (isToday ? " now" : "") + '"><div class="bar" style="height:' + Math.max(hgt, 2) + '%" data-val="' + U.money(dmap[k]) + '"></div><div class="bar-lbl">' + (isToday ? "Today" : U.fmtDate(k).slice(0, 5)) + "</div></div>";
    }).join("");

    function qb(icon, label, hint, attr, hue) {
      return '<button class="btn quick"' + (hue ? ' data-hue="' + hue + '"' : "") + " " + attr + ">" + ico(icon) +
        "<span><b>" + h(label) + "</b><i>" + h(hint) + "</i></span></button>";
    }

    el.innerHTML =
      metrics([
        { label: "Today", value: U.money(sum(todaySales)), hint: todaySales.length + " invoice(s) · sales", attr: 'data-go="sales"' },
        { label: "This month", value: U.money(sum(monthSales)), hint: monthSales.length + " invoice(s) · reports", attr: 'data-go="reports"' },
        { label: "Stock at cost", value: U.money(stockValue), hint: batches.filter(function (b) { return Number(b.quantity) > 0; }).length + " live batches · products", attr: 'data-go="products"' },
        { label: "Stock at retail", value: U.money(retailValue), hint: products.filter(function (p) { return p.active !== false; }).length + " products · products", attr: 'data-go="products"' },
        { label: "Credit out", value: U.money(creditDue), hint: creditCount + " invoice(s) unpaid · khata", attr: 'data-act="go-due"', hue: "bad" },
        { label: "Low stock", value: low.length, hint: low.length ? "at or below reorder · filter" : "nothing to reorder · filter", attr: 'data-act="go-low"', hue: "warn" },
        { label: "Expiring", value: expiring.length, hint: expiring.length ? "within " + warnDays + " days · filter" : "nothing expiring · filter", attr: 'data-act="go-exp"', hue: "warn" }
      ]) +

      '<div class="grid cols-2 mt">' +
        '<div class="card" data-hue="info"><div class="card-head"><h2>Last 7 days</h2>' +
          '<button class="btn btn-sm btn-ghost" data-go="reports">' + ico("chart") + "Full reports</button></div>" +
          '<div class="bars">' + bars + "</div>" +
          '<div class="spread small muted mt-sm"><span>7-day total <strong>' + U.money(weekTotal) + '</strong></span><span>Best day <strong>' + U.money(maxDay) + "</strong></span></div>" +
        "</div>" +
        '<div class="card"><div class="card-head"><h2>At the counter</h2><span class="sub">Everyday actions</span></div>' +
          '<div class="quick-grid">' +
            qb("sale", "New sale", "Bill a farmer", 'data-go="pos"', "in") +
            qb("truck", "New purchase", "Stock in a load", 'data-go="purchases"', "info") +
            qb("box", "Add product", "Create an item", 'data-act="add-product"') +
            qb("users", "Customer book", "Add or find a farmer", 'data-act="cust-book"') +
            qb("calendar", "Day summary", "Today, printed", 'data-act="day-sum"') +
            qb("card", "Credit dues", "Who owes money", 'data-act="go-due"', "due") +
          "</div>" +
        "</div>" +
      "</div>" +

      '<div class="grid cols-2 mt">' +
        '<div class="card" data-hue="due"><div class="card-head"><div><h2>Reorder now</h2><span class="sub">At or below reorder level</span></div>' +
          '<div style="display:flex;gap:6px">' +
            '<button class="btn btn-sm btn-ghost" id="low-csv" title="Export the reorder list as a spreadsheet">' + ico("download") + "Export</button>" +
            '<button class="btn btn-sm btn-ghost" id="low-print" title="Print a reorder slip to hand to your supplier">' + ico("print") + "Print</button>" +
          "</div></div>" +
          alertTable(low, smap) + "</div>" +
        '<div class="card" data-hue="out"><div class="card-head"><h2>Expiring soon</h2><span class="sub">Within ' + warnDays + " days</span></div>" +
          expiringTable(expiring) + "</div>" +
      "</div>";

    $$("[data-go]", el).forEach(function (b) { b.onclick = function () { ui.setView(b.dataset.go); }; });
    var ap = $('[data-act="add-product"]', el); if (ap) ap.onclick = function () { S.openProductModal(null); };
    var cb = $('[data-act="cust-book"]', el); if (cb) cb.onclick = function () { ui.setView("customers"); };
    var sh = $('[data-act="stock-hist"]', el); if (sh) sh.onclick = function () { ui.setView("stockhist"); };
    var ds = $('[data-act="day-sum"]', el); if (ds) ds.onclick = function () { openDaySummary(); };
    var gl = $('[data-act="go-low"]', el); if (gl) gl.onclick = function () { state.productFilter = { q: "", category: "All", flag: "low" }; ui.setView("products"); };
    exportMenu($("#low-csv", el), {
      title: "reorder list", unit: "product", filename: "reorder-list",
      data: function () {
        function row(r) { return [r.name, r.stock, r.reorder, r.suggest, r.unit, r.costPrice, r.estCost, r.out ? "Out of stock" : "Low"]; }
        return {
          columns: ["Product", "In stock", "Reorder level", "Suggested qty", "Unit", "Cost price", "Est. cost", "Status"],
          rows: low.map(row)
        };
      }
    });
    var lp = $("#low-print", el); if (lp) lp.onclick = function () { printReorderSlip(low); };
    var ge = $('[data-act="go-exp"]', el); if (ge) ge.onclick = function () { state.productFilter = { q: "", category: "All", flag: "expiring" }; ui.setView("products"); };
    var gd = $('[data-act="go-due"]', el); if (gd) gd.onclick = function () { ui.setView("credit"); };
    $$("tr[data-pid]", el).forEach(function (tr) { tr.onclick = function () { S.openProductDetail(tr.dataset.pid); }; });
  };

  function alertTable(rows, smap) {
    if (!rows.length) return '<div class="empty-state">' + ico("check") + '<div>Nothing to reorder — stock is healthy.</div></div>';
    var tr = rows.slice(0, 8).map(function (p) {
      return '<tr data-pid="' + p.id + '"><td>' + h(p.name) + '</td><td class="num">' + U.qty(p.stock) + " " + h(p.unit || "") +
        '</td><td class="num muted">' + U.qty(p.reorder) + '</td><td class="num"><strong>' + U.qty(p.suggest) + "</strong></td></tr>";
    }).join("");
    return '<div class="table-wrap"><table class="data"><thead><tr><th>Product</th><th class="num">In stock</th><th class="num">Reorder</th><th class="num">Order</th></tr></thead><tbody>' + tr + "</tbody></table></div>";
  }

  function printReorderSlip(rows) {
    if (!rows.length) { toast("Nothing to reorder — stock is healthy", "warn"); return; }
    var s = state.settings;
    var tot = U.roundMoney(rows.reduce(function (a, r) { return a + r.estCost; }, 0));
    var body = rows.map(function (r) {
      return "<tr><td>" + h(r.name) + "</td><td class='num'>" + U.qty(r.stock) + "</td><td class='num'>" + U.qty(r.reorder) +
        "</td><td class='num'><strong>" + U.qty(r.suggest) + "</strong></td><td>" + h(r.unit || "") + "</td><td class='num'>" + U.money(r.estCost) + "</td></tr>";
    }).join("");
    var area = $("#print-area");
    area.className = "print-area";
    H.setPrintPage(true); // six columns — landscape, and never the previous job's page style
    area.innerHTML =
      '<div class="invoice">' +
        '<div class="inv-copy">Reorder Slip</div>' +
        '<div class="inv-head"><div class="inv-shop"><div>' +
          "<h2>" + h(s.shopName || "Shop") + "</h2>" +
          '<div class="small">Stock reorder list — ' + U.fmtDate(U.todayISO()) + "</div>" +
        "</div></div>" +
        '<div class="inv-meta"><div style="font-size:16px;font-weight:700;color:#111">' + rows.length + " item(s)</div>" +
          "<div>Est. total " + U.money(tot) + "</div></div></div>" +
        '<table class="inv"><thead><tr><th>Product</th><th class="num">In stock</th><th class="num">Reorder</th><th class="num">Order qty</th><th>Unit</th><th class="num">Est. cost</th></tr></thead><tbody>' +
          body +
          '<tr class="total-row"><td>Total</td><td></td><td></td><td></td><td></td><td class="num">' + U.money(tot) + "</td></tr>" +
        "</tbody></table>" +
        '<div class="inv-foot">Hand this slip to your supplier or use it to raise a purchase.</div>' +
      "</div>";
    setTimeout(function () { window.print(); }, 60);
  }

  function expiringTable(rows) {
    if (!rows.length) return '<div class="muted small">No stock expiring soon.</div>';
    var tr = rows.slice(0, 8).map(function (b) {
      var p = state.pmap[b.productId] || {};
      return '<tr data-pid="' + b.productId + '"><td>' + h(p.name || "?") + '<div class="small muted">' + h(b.batchNo || "no batch") + "</div></td>" +
        "<td>" + expiryBadge(b.expiryDate) + '</td><td class="num">' + U.qty(b.quantity) + "</td></tr>";
    }).join("");
    return '<div class="table-wrap"><table class="data"><thead><tr><th>Product</th><th>Expiry</th><th class="num">Qty</th></tr></thead><tbody>' + tr + "</tbody></table></div>";
  }


  /* =========================== Day summary (end-of-day) =========================== */
  function daySummaryData(date) {
    var sales = (state.sales || []).filter(function (s) { return s.date === date; });
    var revenue = U.roundMoney(sales.reduce(function (a, s) { return a + Number(s.total || 0); }, 0));
    var collected = U.roundMoney(sales.reduce(function (a, s) { return a + Number(s.paid || 0); }, 0));
    var due = U.roundMoney(sales.reduce(function (a, s) { return a + store.saleDue(s); }, 0));
    var items = U.roundQty(sales.reduce(function (a, s) {
      return a + (s.items || []).reduce(function (x, it) { return x + Number(it.quantity || 0); }, 0);
    }, 0));
    var pay = {};
    sales.forEach(function (s) {
      var m = s.paymentMethod || "Cash";
      pay[m] = pay[m] || { count: 0, amount: 0 };
      pay[m].count++; pay[m].amount = U.roundMoney(pay[m].amount + Number(s.total || 0));
    });
    var payRows = Object.keys(pay).sort().map(function (m) { return { method: m, count: pay[m].count, amount: pay[m].amount }; });
    return {
      sales: sales, revenue: revenue, collected: collected, due: due, items: items,
      payRows: payRows, top: store.topProducts(sales, true, 5),
      count: sales.length, avg: sales.length ? U.roundMoney(revenue / sales.length) : 0
    };
  }

  function openDaySummary() {
    var date = U.todayISO();
    function bodyHTML(d) {
      var payTbl = d.payRows.length
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>Payment</th><th class="num">Invoices</th><th class="num">Amount</th></tr></thead><tbody>' +
          d.payRows.map(function (r) { return "<tr><td>" + h(r.method) + '</td><td class="num">' + r.count + '</td><td class="num">' + U.money(r.amount) + "</td></tr>"; }).join("") +
          "</tbody></table></div>"
        : '<div class="muted small">No payments recorded.</div>';
      var topTbl = d.top.length
        ? '<div class="table-wrap"><table class="data"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Revenue</th></tr></thead><tbody>' +
          d.top.map(function (t) { var p = state.pmap[t.productId] || {}; return "<tr><td>" + h(p.name || "?") + '</td><td class="num">' + U.qty(U.roundQty(t.qty)) + '</td><td class="num">' + U.money(t.revenue) + "</td></tr>"; }).join("") +
          "</tbody></table></div>"
        : '<div class="muted small">No items sold.</div>';
      return metrics([
          { label: "Invoices", value: d.count, hint: d.count ? "avg " + U.money(d.avg) : "no sales" },
          { label: "Revenue", value: U.money(d.revenue), hint: U.qty(d.items) + " item(s) sold" },
          { label: "Collected", value: U.money(d.collected), hint: "received today", hue: "in" },
          { label: "Outstanding", value: U.money(d.due), hint: d.due > 0 ? "to collect later" : "nothing pending", hue: d.due > 0 ? "bad" : "" }
        ]) +
        '<div class="grid cols-2 mt"><div><div class="section-title">Payment split</div>' + payTbl + "</div>" +
        '<div><div class="section-title">Top items</div>' + topTbl + "</div></div>";
    }
    modal({
      title: "Day summary", icon: "chart", hue: "info", size: "wide",
      body: '<div class="field" style="max-width:200px;margin-bottom:12px"><label>Date</label><input class="input" type="date" id="ds-date" value="' + h(date) + '"></div><div id="ds-body"></div>',
      footer: '<button class="btn" data-close>Close</button><button class="btn btn-primary" id="ds-print">' + ico("print") + ' Export PDF</button>',
      onMount: function (el, close) {
        function paint() { $("#ds-body", el).innerHTML = bodyHTML(daySummaryData(date)); }
        $("#ds-date", el).onchange = function (e) { date = e.target.value || U.todayISO(); paint(); };
        $("#ds-print", el).onclick = function () { close(); printDaySummary(date); };
        paint();
      }
    });
  }

  function printDaySummary(date) {
    var d = daySummaryData(date);
    var M = function (v) { return U.money(v || 0); };
    var blocks = [{ caption: "Overview", kv: [["Invoices", String(d.count)], ["Revenue", M(d.revenue)], ["Collected", M(d.collected)], ["Outstanding", M(d.due)], ["Items sold", U.qty(d.items)]] }];
    if (d.payRows.length) blocks.push({ caption: "Payment split", columns: ["Payment", "Invoices", "Amount"], numCols: [1, 2], rows: d.payRows.map(function (r) { return [r.method, r.count, M(r.amount)]; }) });
    if (d.top.length) blocks.push({ caption: "Top items", columns: ["Item", "Qty", "Revenue"], numCols: [1, 2], rows: d.top.map(function (t) { var p = state.pmap[t.productId] || {}; return [p.name || "?", U.qty(U.roundQty(t.qty)), M(t.revenue)]; }) });
    H.printDoc({ title: "Day Summary", subtitle: U.fmtDate(date), blocks: blocks });
  }
})(window.FS);
