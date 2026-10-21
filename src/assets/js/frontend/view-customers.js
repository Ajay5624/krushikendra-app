/* =========================================================
   view-customers.js — the customer book
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

  /* =========================== CUSTOMERS (full page) =========================== */
  V.customers = function (el) {
    el.dataset.hue = "in";
    state.custHist = state.custHist || { q: "", dueOnly: false, sel: null, from: "", to: "", status: "", sq: "" };
    var F = state.custHist;
    var list = customerList();
    if (F.sel) { renderCustomerDetail(el, list, F); return; }

    setPage("Customers", list.length + " customer(s)");
    el.innerHTML =
      '<div id="cu-sum"></div>' +
    '<div class="toolbar">' +
        '<div class="search">' + ico("search","s-ico") + '<input id="cu-q" placeholder="Search name or phone…" value="' + h(F.q) + '"><button class="s-clear" type="button" tabindex="-1" aria-label="Clear search">' + ico("close") + '</button></div>' +
        '<button class="chip' + (F.dueOnly ? " active" : "") + '" id="cu-due" title="Show only customers with outstanding credit">With dues</button>' +
        '<div class="grow"></div>' +
        '<button class="btn" id="cu-csv" title="Export the customer book as a spreadsheet">' + ico("download") + ' Export</button>' +
      "</div>" +
      '<div id="cu-table" class="mt"></div>';

    function filtered() {
      var q = (F.q || "").trim().toLowerCase();
      return list.filter(function (c) {
        if (F.dueOnly && c.due <= 0) return false;
        if (!q) return true;
        return c.name.toLowerCase().indexOf(q) >= 0 || (c.phone || "").indexOf(q) >= 0;
      });
    }
    function paint() {
      var rows = filtered();
      var totSpent = U.roundMoney(rows.reduce(function (a, c) { return a + c.spent; }, 0));
      var totDue = U.roundMoney(rows.reduce(function (a, c) { return a + c.due; }, 0));
      var totSales = rows.reduce(function (a, c) { return a + c.count; }, 0);
      $("#cu-sum", el).innerHTML = list.length ? metrics([
        { label: "Customers", value: rows.length, hint: F.dueOnly ? "with outstanding dues" : "named customers" },
        { label: "Invoices", value: totSales, hint: "across shown customers" },
        { label: "Total spent", value: U.money(totSpent), hint: "lifetime value" },
        { label: "Outstanding", value: U.money(totDue), hint: "credit still to collect", hue: "bad" }
      ]) : "";

      var body = rows.length ? rows.map(function (c) {
        return '<tr data-ck="' + h(c.key) + '" style="cursor:pointer">' +
          "<td><strong>" + h(c.name) + "</strong>" + (c.phone ? '<div class="small muted">' + h(c.phone) + "</div>" : "") + "</td>" +
          '<td class="num">' + c.count + "</td>" +
          '<td class="num">' + U.money(c.spent) + "</td>" +
          '<td class="num">' + (c.due > 0 ? '<span class="badge red">Due ' + U.money(c.due) + "</span>" : '<span class="badge green">Clear</span>') + "</td>" +
          "<td>" + U.fmtDate(c.last) + "</td>" +
          '<td><button class="btn btn-sm" data-ch="' + h(c.key) + '">History</button></td></tr>';
      }).join("") : (list.length
        ? emptyRow(6, "search", "No customer matches these filters", "Clear the search, or check the spelling of the name.")
        : emptyRow(6, "users", "No named customers yet", "Type a farmer's name on a sale and it appears here automatically."));

      $("#cu-table", el).innerHTML =
        '<div class="table-wrap"><table class="data"><thead><tr><th>Customer</th><th class="num">Invoices</th><th class="num">Spent</th><th>Status</th><th>Last visit</th><th></th></tr></thead><tbody>' +
        body + "</tbody></table></div>";

      function open(cKey) { F.sel = cKey; ui.setView("customers"); }
      $$("[data-ch]", el).forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); open(b.dataset.ch); }; });
      $$("tr[data-ck]", el).forEach(function (tr) { tr.onclick = function () { open(tr.dataset.ck); }; });
    }

    $("#cu-q", el).addEventListener("input", U.debounce(function () { F.q = $("#cu-q", el).value; paint(); }, 180));
    $("#cu-due", el).onclick = function () { F.dueOnly = !F.dueOnly; ui.setView("customers"); };
    exportMenu($("#cu-csv", el), {
      title: "customers", unit: "customer", filename: "customers",
      data: function () {
        function row(c) {
          var rec = state.custmap[c.key] || {};
          return [c.name, c.phone || "", c.count, c.spent, c.due, U.num(rec.creditLimit) || "", c.last || "", c.due > 0 ? "Due" : "Clear"];
        }
        return {
          columns: ["Name", "Phone", "Invoices", "Spent", "Outstanding", "Credit limit", "Last visit", "Status"],
          rows: filtered().map(row),
          all: list.map(row)
        };
      }
    });
    paint();
  };

  function renderCustomerDetail(el, list, F) {
    var c = list.filter(function (x) { return x.key === F.sel; })[0];
    if (!c) { F.sel = null; V.customers(el); return; }
    var rec = state.custmap[c.key] || {};
    setPage(c.name, (c.phone ? c.phone + " · " : "") + c.count + " invoice(s)");

    el.innerHTML =
      '<div class="toolbar">' +
        '<button class="btn" id="cd-back">' + ico("back") + ' All customers</button>' +
        '<div class="search">' + ico("search","s-ico") + '<input id="cd-sq" placeholder="Search invoice or item…" value="' + h(F.sq) + '"><button class="s-clear" type="button" tabindex="-1" aria-label="Clear search">' + ico("close") + '</button></div>' +
        '<select class="select" id="cd-status" style="max-width:150px" title="Payment status">' +
          '<option value="">All statuses</option><option value="paid"' + (F.status === "paid" ? " selected" : "") + ">Paid</option>" +
          '<option value="due"' + (F.status === "due" ? " selected" : "") + ">Due</option></select>" +
        '<input class="input" type="date" id="cd-from" value="' + h(F.from) + '" title="From date" style="max-width:155px">' +
        '<input class="input" type="date" id="cd-to" value="' + h(F.to) + '" title="To date" style="max-width:155px">' +
        '<div class="grow"></div>' +
        (c.due > 0 ? '<button class="btn" id="cd-wa" title="Send a WhatsApp payment reminder">' + ico("chat") + ' WhatsApp</button>' : "") +
        '<button class="btn" id="cd-credit-btn" title="Set credit limit, UPI & notes">' + ico("card") + ' Credit</button>' +
        '<button class="btn" id="cd-edit" title="Edit this customer\'s name and phone">' + ico("edit") + ' Edit</button>' +
        '<button class="btn" id="cd-csv" title="Export this customer\'s invoices as a spreadsheet">' + ico("download") + ' Export</button>' +
      "</div>" +
      '<div id="cd-credit"></div>' +
      '<div id="cd-sum"></div>' +
      '<div id="cd-seasons" class="mt"></div>' +
      '<div id="cd-table" class="mt"></div>';

    function saleItems(s) {
      return (s.items || []).map(function (it) { var p = state.pmap[it.productId] || {}; return p.name || "?"; });
    }
    function filtered() {
      var q = (F.sq || "").trim().toLowerCase();
      return c.sales.filter(function (s) {
        var due = store.saleDue(s);
        if (F.status === "paid" && due > 0) return false;
        if (F.status === "due" && due <= 0) return false;
        if (F.from && (s.date || "") < F.from) return false;
        if (F.to && (s.date || "") > F.to) return false;
        if (q) {
          var hay = (s.invoiceNo + " " + saleItems(s).join(" ")).toLowerCase();
          if (hay.indexOf(q) < 0) return false;
        }
        return true;
      });
    }
    function paint() {
      var rows = filtered();
      var spent = U.roundMoney(rows.reduce(function (a, s) { return a + Number(s.total || 0); }, 0));
      var due = U.roundMoney(rows.reduce(function (a, s) { return a + store.saleDue(s); }, 0));
      var items = rows.reduce(function (a, s) { return a + (s.items || []).reduce(function (x, it) { return x + Number(it.quantity || 0); }, 0); }, 0);
      $("#cd-sum", el).innerHTML = metrics([
        { label: "Invoices", value: rows.length, hint: "of " + c.count + " total" },
        { label: "Spent", value: U.money(spent), hint: U.qty(U.roundQty(items)) + " item(s) in view" },
        { label: "Outstanding", value: U.money(due), hint: due > 0 ? "credit to collect" : "fully settled", hue: due > 0 ? "bad" : "" },
        { label: "Last visit", value: c.last ? U.fmtDate(c.last) : "—", hint: "most recent invoice" }
      ]);

      // Credit-limit status
      var limit = U.num(rec.creditLimit);
      var cbox = $("#cd-credit", el);
      if (cbox) {
        if (limit > 0) {
          var over = c.due > limit;
          var pct = Math.max(0, Math.min(100, Math.round(c.due / limit * 100)));
          var cls = over ? "red" : (pct >= 80 ? "warn" : "green");
          cbox.innerHTML =
            '<div class="alert ' + cls + ' mt" style="display:block">' +
              '<div class="spread"><strong>Credit limit ' + U.money(limit) + "</strong>" +
              "<span>Outstanding " + U.money(c.due) + " · " + pct + "% used</span></div>" +
              '<div class="credit-bar"><span style="width:' + pct + '%"></span></div>' +
              (over ? '<div class="small" style="margin-top:6px">' + ico("alert") + ' Over limit by ' + U.money(c.due - limit) + " — new credit sales will warn at billing.</div>" : "") +
            "</div>";
        } else {
          cbox.innerHTML = '<div class="small muted mt">No credit limit set for this farmer. Tap <strong>Credit</strong> to add a limit and UPI ID, and get over-limit warnings at billing.</div>';
        }
      }

      // Season-wise khata (Kharif / Rabi)
      var sbox = $("#cd-seasons", el);
      if (sbox) {
        var byS = {};
        (c.sales || []).forEach(function (s) {
          var so = U.seasonOf(s.date);
          var g = byS[so.key] || (byS[so.key] = { label: so.label, sort: so.sort, billed: 0, bal: 0, n: 0 });
          g.billed = U.roundMoney(g.billed + Number(s.total || 0));
          g.bal = U.roundMoney(g.bal + store.saleDue(s));
          g.n++;
        });
        var srows = Object.keys(byS).map(function (k) { return byS[k]; }).sort(function (a, b) { return b.sort - a.sort; });
        sbox.innerHTML = srows.length
          ? '<div class="section-title" style="margin:0">Season-wise khata</div>' +
            '<div class="table-wrap mt-sm"><table class="data"><thead><tr><th>Season</th><th class="num">Invoices</th><th class="num">Billed</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead><tbody>' +
            srows.map(function (g) {
              var paid = U.roundMoney(g.billed - g.bal);
              return "<tr><td><strong>" + h(g.label) + '</strong></td><td class="num">' + g.n + "</td>" +
                '<td class="num">' + U.money(g.billed) + '</td><td class="num">' + U.money(paid) + "</td>" +
                '<td class="num">' + (g.bal > 0 ? '<span class="badge red">' + U.money(g.bal) + '</span>' : '<span class="badge green">Clear</span>') + "</td></tr>";
            }).join("") + "</tbody></table></div>"
          : "";
      }

      var body = rows.length ? rows.map(function (s) {
        var d = store.saleDue(s);
        var names = saleItems(s);
        return "<tr>" +
          "<td>" + U.fmtDate(s.date) + "</td>" +
          "<td><strong>" + h(s.invoiceNo) + "</strong></td>" +
          '<td class="small">' + h(names.slice(0, 3).join(", ")) + (names.length > 3 ? " +" + (names.length - 3) : "") + "</td>" +
          '<td class="num">' + U.money(s.total) + "</td>" +
          '<td><span class="badge gray">' + h(s.paymentMethod || "Cash") + "</span></td>" +
          '<td><span class="badge ' + (d > 0 ? "red" : "green") + '">' + (d > 0 ? "Due " + U.money(d) : "Paid") + "</span></td>" +
          '<td><button class="btn btn-sm" data-vi="' + s.id + '">View</button></td></tr>';
      }).join("") : emptyRow(7, "search", "No invoices match these filters", "Clear the search or widen the date range.");

      $("#cd-table", el).innerHTML =
        '<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Invoice</th><th>Items</th><th class="num">Total</th><th>Payment</th><th>Status</th><th></th></tr></thead><tbody>' +
        body + "</tbody></table></div>";

      $$("[data-vi]", el).forEach(function (b) { b.onclick = function () { FS.ui._shared.viewSale(b.dataset.vi); }; });
    }

    $("#cd-back", el).onclick = function () { F.sel = null; ui.setView("customers"); };
    var waBtn = $("#cd-wa", el); if (waBtn) waBtn.onclick = function () { waCustomerReminder(c); };
    $("#cd-credit-btn", el).onclick = function () { openCustomerCredit(c); };
    $("#cd-edit", el).onclick = function () { openCustomerEdit(c, F); };
    $("#cd-sq", el).addEventListener("input", U.debounce(function () { F.sq = $("#cd-sq", el).value; paint(); }, 180));
    $("#cd-status", el).onchange = function (e) { F.status = e.target.value; paint(); };
    $("#cd-from", el).onchange = function (e) { F.from = e.target.value; paint(); };
    $("#cd-to", el).onchange = function (e) { F.to = e.target.value; paint(); };
    exportMenu($("#cd-csv", el), {
      title: c.name + " — invoices", unit: "invoice", filename: "customer-" + U.safeName(c.name),
      data: function () {
        function row(s) {
          var due = store.saleDue(s);
          return [s.date || "", s.invoiceNo || "", saleItems(s).join("; "),
            U.roundQty((s.items || []).reduce(function (a, it) { return a + Number(it.quantity || 0); }, 0)),
            s.total || 0, s.paymentMethod || "Cash", due, due > 0 ? "Due" : "Paid"];
        }
        return {
          columns: ["Date", "Invoice", "Items", "Qty", "Total", "Payment", "Outstanding", "Status"],
          rows: filtered().map(row),
          all: c.sales.map(row)
        };
      }
    });
    paint();
  }

  function openCustomerCredit(c) {
    var rec = state.custmap[c.key] || {};
    var body =
      '<form id="ccf"><div class="form-grid">' +
        '<div class="field full"><label>Credit limit (₹, 0 = no limit)</label><input class="input" type="number" step="1" min="0" name="creditLimit" value="' + (U.num(rec.creditLimit) || "") + '" placeholder="e.g. 50000"></div>' +
        '<div class="field full"><label>UPI ID (for WhatsApp reminders)</label><input class="input" name="upi" value="' + h(rec.upi || "") + '" placeholder="e.g. 9876543210@upi"></div>' +
        '<div class="field full"><label>Notes</label><textarea class="textarea" name="notes">' + h(rec.notes || "") + "</textarea></div>" +
      "</div>" +
      '<p class="small muted mt">Current outstanding: <strong>' + U.money(c.due) + "</strong>. Saved with this farmer (by " + (c.phone ? "phone" : "name") + ").</p></form>";
    modal({
      title: "Credit settings — " + c.name, body: body,
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ccf-save">Save</button>',
      onMount: function (el, close) {
        $("#ccf-save", el).onclick = function () {
          var d = formData($("#ccf", el));
          store.saveCustomer(c.key, {
            name: c.name, phone: c.phone || "",
            creditLimit: U.num(d.creditLimit), upi: (d.upi || "").trim(), notes: d.notes || ""
          }).then(function () { close(); return refresh(); }).then(function () { toast("Credit settings saved"); })
            .catch(function (e) { toast(e.message || "Could not save", "error"); });
        };
      }
    });
  }

  function openCustomerEdit(c, F) {
    var body =
      '<form id="cef"><div class="form-grid">' +
        '<div class="field full"><label>Name *</label><input class="input" name="name" required value="' + h(c.name || "") + '"></div>' +
        '<div class="field full"><label>Phone</label><input class="input" name="phone" value="' + h(c.phone || "") + '"></div>' +
      "</div>" +
      '<p class="small muted mt">This updates the name and phone on all ' + c.count + " of this customer's invoice(s).</p></form>";
    modal({
      title: "Edit Customer", body: body,
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="cef-save">Save</button>',
      onMount: function (el, close) {
        $("#cef-save", el).onclick = function () {
          var f = $("#cef", el), d = formData(f);
          var name = (d.name || "").trim(), phone = (d.phone || "").trim();
          if (!name) { fieldError(f, "name", "Customer name is required"); return; }
          var ids = (c.sales || []).map(function (s) { return s.id; });
          store.updateCustomerDetails(ids, name, phone)
            .then(function () {
              // Keep the detail view open on the (possibly re-keyed) customer.
              if (F) F.sel = phone ? "p:" + phone : "n:" + name.toLowerCase();
              close(); return refresh();
            })
            .then(function () { toast("Customer updated"); })
            .catch(function (e) { toast(e.message || "Could not save", "error"); });
        };
      }
    });
  }
})(window.FS);
