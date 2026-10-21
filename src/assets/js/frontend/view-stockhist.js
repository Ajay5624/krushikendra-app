/* =========================================================
   view-stockhist.js — the stock ledger
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

  /* =========================== STOCK HISTORY =========================== */
  V.stockhist = function (el) {
    el.dataset.hue = "info";
    state.stockHist = state.stockHist || { product: "", reason: "", from: "", to: "", q: "" };
    var F = state.stockHist;
    setPage("Stock History", "Every stock in & out, with running balance");
    store.listMovements().then(function (all) {
      all.slice().sort(function (a, b) { return (a.ts || "").localeCompare(b.ts || ""); }).forEach(function (m) {
        var acc = (this[m.productId] = this[m.productId] || { bal: 0 });
        acc.bal = U.roundQty(acc.bal + m.qty);
        m._bal = acc.bal;
      }, {});
      var reasons = [];
      all.forEach(function (m) { if (reasons.indexOf(m.reason) < 0) reasons.push(m.reason); });
      reasons.sort();
      setPage("Stock History", all.length + " movement(s) recorded · newest first");

      function timeOf(ts) {
        var d = ts ? new Date(ts) : null;
        if (!d || isNaN(d)) return "";
        var hh = d.getHours(), mm = ("0" + d.getMinutes()).slice(-2), ap = hh >= 12 ? "PM" : "AM";
        hh = hh % 12; if (hh === 0) hh = 12;
        return hh + ":" + mm + " " + ap;
      }

      el.innerHTML =
        '<div id="sh-sum"></div>' +
      '<div class="toolbar">' +
          '<div class="search">' + ico("search","s-ico") + '<input id="sh-q" placeholder="Search batch or invoice ref…" value="' + h(F.q) + '"><button class="s-clear" type="button" tabindex="-1" aria-label="Clear search">' + ico("close") + '</button></div>' +
          '<select class="select" id="sh-prod" style="max-width:200px" title="Product"><option value="">All products</option>' +
            state.products.map(function (p) { return '<option value="' + p.id + '"' + (F.product === p.id ? " selected" : "") + ">" + h(p.name) + "</option>"; }).join("") +
          "</select>" +
          '<select class="select" id="sh-reason" style="max-width:170px" title="Reason"><option value="">All reasons</option>' +
            reasons.map(function (r) { return '<option value="' + h(r) + '"' + (F.reason === r ? " selected" : "") + ">" + h(r) + "</option>"; }).join("") +
          "</select>" +
          '<input class="input" type="date" id="sh-from" value="' + h(F.from) + '" title="From date" style="max-width:155px">' +
          '<input class="input" type="date" id="sh-to" value="' + h(F.to) + '" title="To date" style="max-width:155px">' +
          '<select class="select" id="sh-sort" style="max-width:175px" title="Sort order">' +
            '<option value=""' + (F.sort ? "" : " selected") + ">Newest first</option>" +
            '<option value="old"' + (F.sort === "old" ? " selected" : "") + ">Oldest first</option>" +
            '<option value="big"' + (F.sort === "big" ? " selected" : "") + ">Biggest change first</option>" +
          "</select>" +
          '<button class="btn" id="sh-csv" title="Export this stock history as a spreadsheet">' + ico("download") + ' Export</button>' +
        "</div>" +
          '<div id="sh-table" class="mt"></div>';

      function filtered() {
        var q = (F.q || "").trim().toLowerCase();
        return all.filter(function (m) {
          if (F.product && m.productId !== F.product) return false;
          if (F.reason && m.reason !== F.reason) return false;
          if (F.dir === "in" && m.qty <= 0) return false;
          if (F.dir === "out" && m.qty >= 0) return false;
          if (F.from && (m.date || "") < F.from) return false;
          if (F.to && (m.date || "") > F.to) return false;
          if (q && ((m.batchNo || "") + " " + (m.ref || "")).toLowerCase().indexOf(q) < 0) return false;
          return true;
        });
      }
      function sorted(rows) {
        return rows.slice().sort(function (a, b) {
          if (F.sort === "old") return (a.ts || "").localeCompare(b.ts || "");
          if (F.sort === "big") return Math.abs(b.qty || 0) - Math.abs(a.qty || 0);
          return (b.ts || "").localeCompare(a.ts || "");
        });
      }

      function paint() {
        var rows = filtered();
        var ins = rows.filter(function (m) { return m.qty > 0; });
        var outs = rows.filter(function (m) { return m.qty < 0; });
        var prods = {}; rows.forEach(function (m) { prods[m.productId] = 1; });
        var unit = F.product ? ((state.pmap[F.product] || {}).unit || "") : "";
        var inQty = U.roundQty(ins.reduce(function (s, m) { return s + m.qty; }, 0));
        var outQty = U.roundQty(outs.reduce(function (s, m) { return s + m.qty; }, 0));
        var net = U.roundQty(rows.reduce(function (s, m) { return s + m.qty; }, 0));

        function dirCard(label, qtyText, hint, dir, hue) {
          var on = F.dir === dir;
          return mseg({
            label: label, value: qtyText, hue: hue, hint: on ? "filtering — tap to clear" : hint,
            attr: 'data-act="' + dir + '" aria-pressed="' + on + '" title="Tap to ' + (on ? "clear this filter" : "show only stock " + dir) + '"'
          });
        }
        $("#sh-sum", el).innerHTML = all.length ? metrics([
          { label: "Movements", value: rows.length, hint: Object.keys(prods).length + " product(s) in view" },
          dirCard("Stock in", (inQty > 0 ? "+" : "") + U.qty(inQty) + (unit ? " " + unit : ""), ins.length + " entry(ies) — tap to filter", "in", "in"),
          dirCard("Stock out", U.qty(outQty) + (unit ? " " + unit : ""), outs.length + " entry(ies) — tap to filter", "out", "out"),
          { label: "Net change", value: (net > 0 ? "+" : "") + U.qty(net) + (unit ? " " + unit : ""), hint: F.product ? "now " + U.qty(state.stockMap[F.product] || 0) + " " + unit + " in stock" : "across filtered products", hue: "warn" }
        ]) : "";

        var show = sorted(rows).slice(0, 300);
        var body = show.length ? show.map(function (m) {
          var p = state.pmap[m.productId] || {};
          return '<tr data-pid="' + m.productId + '">' +
            "<td>" + U.fmtDate(m.date) + '<div class="small muted">' + timeOf(m.ts) + "</div></td>" +
            '<td><a href="#" data-pd="' + m.productId + '" style="font-weight:600;text-decoration:none">' + h(p.name || "?") + "</a></td>" +
            '<td class="num"><strong style="color:' + (m.qty >= 0 ? "var(--brand-dark)" : "var(--danger)") + '">' + (m.qty > 0 ? "+" : "") + U.qty(m.qty) + "</strong></td>" +
            '<td class="num muted">' + U.qty(m._bal) + "</td>" +
            '<td class="small">' + h(m.batchNo || "—") + "</td>" +
            "<td>" + h(m.reason || "") + "</td>" +
            '<td class="small muted">' + h(m.ref || "") + "</td></tr>";
        }).join("") : (all.length
          ? emptyRow(7, "search", "No movement matches these filters", "Clear the search, or widen the dates.")
          : emptyRow(7, "clock", "No stock movements yet", "Every in, out and correction is written here from now on."));

        $("#sh-table", el).innerHTML =
          '<div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Product</th><th class="num">Change</th><th class="num">Balance</th><th>Batch</th><th>Reason</th><th>Ref</th></tr></thead><tbody>' +
          body + "</tbody></table></div>" +
          (rows.length > show.length ? '<div class="small muted mt-sm">Showing the first ' + show.length + " of " + rows.length + " filtered movements — narrow the filters, or export CSV for the full list.</div>" : "") +
          (all.length ? '<div class="small muted mt-sm">Balance counts from when this ledger started; stock received earlier is not included.</div>' : "");

        $all("[data-pd]", el).forEach(function (a) {
          a.onclick = function (e) { e.preventDefault(); FS.ui._shared.openProductDetail(a.dataset.pd); };
        });
        $all("#sh-sum [data-act]", el).forEach(function (c) {
          c.onclick = function () { F.dir = F.dir === c.dataset.act ? "" : c.dataset.act; ui.setView("stockhist"); };
        });
        $all("#sh-table tbody tr[data-pid]", el).forEach(function (tr) {
          tr.onclick = function (e) { if (e.target.closest("a")) return; FS.ui._shared.openProductDetail(tr.dataset.pid); };
        });
      }

      $("#sh-q", el).addEventListener("input", U.debounce(function () { F.q = $("#sh-q", el).value; paint(); }, 180));
      $("#sh-prod", el).onchange = function (e) { F.product = e.target.value; paint(); };
      $("#sh-reason", el).onchange = function (e) { F.reason = e.target.value; paint(); };
      $("#sh-from", el).onchange = function (e) { F.from = e.target.value; paint(); };
      $("#sh-to", el).onchange = function (e) { F.to = e.target.value; paint(); };
      $("#sh-sort", el).onchange = function (e) { F.sort = e.target.value || ""; paint(); };
      exportMenu($("#sh-csv", el), {
        title: "stock history", unit: "movement", filename: "stock-history",
        data: function () {
          function row(m) {
            var p = state.pmap[m.productId] || {};
            return [m.date || "", timeOf(m.ts), p.name || "", p.unit || "", m.qty, m._bal, m.batchNo || "", m.reason || "", m.ref || ""];
          }
          return {
            columns: ["Date", "Time", "Product", "Unit", "Change", "Balance", "Batch", "Reason", "Ref"],
            rows: sorted(filtered()).map(row),
            all: sorted(all).map(row)
          };
        }
      });
      paint();
      reveal(el);
    });
  };
})(window.FS);
