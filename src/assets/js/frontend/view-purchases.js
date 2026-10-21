/* =========================================================
   view-purchases.js — purchases and stock-in
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
  var foldMarkup = S.foldMarkup, foldClose = S.foldClose, wireFold = S.wireFold, enterWalk = S.enterWalk;

  /* =========================== PURCHASES =========================== */
  V.purchases = function (el) {
    el.dataset.hue = "in";
    setPage("Purchases", state.purchases.length + " record(s)");
    var sgCount = computeSuggestions(30).length;
    var mSpend = 0, mCount = 0, oweAll = 0;
    var pm = U.todayISO().slice(0, 7);
    state.purchases.forEach(function (p) {
      oweAll += store.purchaseDue(p);
      if ((p.date || "").slice(0, 7) === pm) { mCount++; mSpend += Number(p.totalAmount || 0); }
    });
    el.innerHTML =
      metrics([
        { label: "This month", value: U.money(mSpend), hint: mCount + " purchase bill(s)" },
        { label: "Owed to suppliers", value: U.money(oweAll), hint: oweAll > 0 ? "Payables has the bills" : "everything is paid", hue: oweAll > 0 ? "bad" : "" },
        { label: "To reorder", value: sgCount, hint: sgCount ? "30 days of cover is short" : "stock covers recent sales", hue: sgCount ? "warn" : "" },
        { label: "All bills", value: state.purchases.length, hint: "since you started" }
      ]) +
      '<div class="toolbar">' +
        '<div class="search">' + ico("search","s-ico") + '<input id="pu-search" placeholder="Search invoice or supplier…"><button class="s-clear" type="button" tabindex="-1" aria-label="Clear search">' + ico("close") + '</button></div>' +
        '<button class="btn" id="pu-sugg">' + ico("bulb") + ' Suggestions' + (sgCount ? ' <span class="badge amber">' + sgCount + "</span>" : "") + "</button>" +
        '<button class="btn" id="pu-csv" title="Export these purchases as a spreadsheet">' + ico("download") + ' Export</button>' +
        '<button class="btn btn-primary" id="pu-new">' + ico("plus") + ' New Purchase</button>' +
      "</div>" +
      '<div id="pur-table"></div>';

    $("#pu-new", el).onclick = function () { openPurchaseModal(); };
    $("#pu-sugg", el).onclick = function () { openSuggestions(); };
    var s = $("#pu-search", el);
    s.addEventListener("input", U.debounce(function () { paint(); }, 180));

    function purchaseNames(p) {
      return (p.items || []).map(function (it) { var pr = state.pmap[it.productId] || {}; return pr.name || "?"; });
    }
    function filtered() {
      var q = (s.value || "").trim().toLowerCase();
      return state.purchases.filter(function (p) {
        if (!q) return true;
        var sup = state.smapSup[p.supplierId] || {};
        return (p.invoiceNo || "").toLowerCase().indexOf(q) >= 0 ||
          (sup.name || "").toLowerCase().indexOf(q) >= 0 ||
          purchaseNames(p).some(function (n) { return n.toLowerCase().indexOf(q) >= 0; });
      });
    }

    exportMenu($("#pu-csv", el), {
      title: "purchases", unit: "purchase", filename: "purchases",
      data: function () {
        function row(p) {
          var sup = state.smapSup[p.supplierId] || {};
          return [p.invoiceNo || "", p.date || "", sup.name || "", sup.phone || "", purchaseNames(p).join("; "),
            U.roundQty((p.items || []).reduce(function (a, it) { return a + Number(it.quantity || 0); }, 0)),
            p.totalAmount || 0, p.bill ? "Yes" : ""];
        }
        return {
          columns: ["Invoice", "Date", "Supplier", "Supplier phone", "Items", "Qty", "Total", "Bill attached"],
          rows: filtered().map(row),
          all: state.purchases.map(row)
        };
      }
    });

    function paint() {
      var rows = filtered();
      var body = rows.length ? rows.map(function (p) {
        var sup = state.smapSup[p.supplierId] || {};
        var names = purchaseNames(p);
        return "<tr>" +
          "<td><strong>" + h(p.invoiceNo) + "</strong></td>" +
          "<td>" + U.fmtDate(p.date) + "</td>" +
          "<td>" + h(sup.name || "—") + "</td>" +
          '<td class="small">' + h(names.slice(0, 3).join(", ") + (names.length > 3 ? " +" + (names.length - 3) : "")) + "</td>" +
          '<td class="num">' + U.money(p.totalAmount) + "</td>" +
          '<td><div class="actions">' +
            (p.bill ? '<button class="btn btn-sm" data-bill="' + p.id + '" title="View supplier bill">' + ico("clip") + '</button>' : "") +
            '<button class="btn btn-sm" data-view="' + p.id + '">View</button>' +
            '<button class="btn btn-sm btn-danger" data-del="' + p.id + '">Del</button>' +
          "</div></td></tr>";
      }).join("") : (state.purchases.length
        ? emptyRow(6, "search", "No purchase matches this search", "Try the supplier name or the bill number.")
        : emptyRow(6, "factory", "No purchases recorded yet", "Add a purchase when goods arrive from a company."));

      $("#pur-table", el).innerHTML =
        '<div class="table-wrap"><table class="data"><thead><tr><th>Invoice</th><th>Date</th><th>Supplier</th><th>Items</th><th class="num">Total</th><th></th></tr></thead><tbody>' + body + "</tbody></table></div>";

      $all("[data-view]", el).forEach(function (b) { b.onclick = function () { viewPurchase(b.dataset.view); }; });
      $all("[data-del]", el).forEach(function (b) { b.onclick = function () { delPurchase(b.dataset.del); }; });
      $all("[data-bill]", el).forEach(function (b) { b.onclick = function () { openBill(b.dataset.bill); }; });
    }
    paint();
  };

  function viewPurchase(id) {
    var p = state.purchases.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    var sup = state.smapSup[p.supplierId] || {};
    var due = store.purchaseDue(p);
    var rows = (p.items || []).map(function (it) {
      var pr = state.pmap[it.productId] || {};
      return "<tr><td>" + h(pr.name || "?") + "</td><td>" + h(it.batchNo || "—") + (it.mfgDate ? '<div class="small muted">mfg ' + h(U.fmtDate(it.mfgDate)) + "</div>" : "") + "</td><td>" + (it.expiryDate ? U.fmtDate(it.expiryDate) : "—") +
        "</td><td class='num'>" + U.qty(it.quantity) + " " + h(pr.unit || "") + "</td><td class='num'>" + U.money(it.unitCost) +
        "</td><td class='num'>" + U.money(it.quantity * it.unitCost) + "</td></tr>";
    }).join("");
    var pays = p.payments || [];
    var ledger = pays.length
      ? '<div class="section-title mt">Payments</div><div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th class="num">Amount</th><th>Method / note</th></tr></thead><tbody>' +
        pays.map(function (x) {
          return "<tr><td>" + U.fmtDate(x.date) + '</td><td class="num">' + U.money(x.amount) + '</td><td class="small muted">' + h(x.method || x.note || "") + "</td></tr>";
        }).join("") + "</tbody></table></div>"
      : "";
    modal({
      title: "Purchase " + p.invoiceNo, size: "wide",
      body:
        '<div class="kv">' +
          '<div class="k">Supplier</div><div class="v">' + h(sup.name || "—") + "</div>" +
          '<div class="k">Date</div><div class="v">' + U.fmtDate(p.date) + "</div>" +
          '<div class="k">Payment</div><div class="v">' + h(p.paymentMethod || "Cash") + "</div>" +
          (p.bill ? '<div class="k">Supplier bill</div><div class="v">' + ico("clip") + ' ' + h(p.bill.name) + "</div>" : "") +
          (p.notes ? '<div class="k">Notes</div><div class="v">' + h(p.notes) + "</div>" : "") +
        "</div>" +
        '<div class="table-wrap mt"><table class="data"><thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Amount</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
        '<div class="spread mt"><span class="muted">Total</span><strong style="font-size:18px">' + U.money(p.totalAmount) + "</strong></div>" +
        '<div class="spread mt-sm"><span class="muted">Paid</span><strong>' + U.money(Number(p.paid || 0)) + "</strong></div>" +
        '<div class="spread mt-sm"><span class="muted">' + (due > 0 ? "Payable (due)" : "Settled") + "</span>" +
          '<strong style="font-size:18px;color:' + (due > 0 ? "var(--danger)" : "var(--brand-dark)") + '">' + U.money(due) + "</strong></div>" +
        ledger,
      footer: (due > 0 ? '<button class="btn btn-primary" id="pv-pay">Record payment</button>' : "") +
        (p.bill ? '<button class="btn" id="pv-bill">' + ico("clip") + ' View bill</button>' : "") + '<button class="btn" data-close>Close</button>',
      onMount: function (el, close) {
        var vb = $("#pv-bill", el);
        if (vb) vb.onclick = function () { openBill(p.id); };
        var pb = $("#pv-pay", el);
        if (pb) pb.onclick = function () { close(); openPaySupplierModal(p.id); };
      }
    });
  }

  function openPaySupplierModal(id) {
    store.getPurchase(id).then(function (p) {
      if (!p || p.id !== id) { toast("Purchase not found", "error"); return; }
      var due = store.purchaseDue(p);
      if (!(due > 0)) { toast("No outstanding payable on this purchase", "warn"); return; }
      var sup = state.smapSup[p.supplierId] || {};
      modal({
        title: "Pay supplier — " + p.invoiceNo,
        size: "narrow",
        body:
          '<div class="form-grid" style="grid-template-columns:1fr">' +
            '<div class="field"><label>Supplier</label><div class="input" style="background:var(--panel-2)">' + h(sup.name || "—") + "</div></div>" +
            '<div class="field"><label>Outstanding payable</label><div class="input" style="background:var(--panel-2)">' + U.money(due) + "</div></div>" +
            '<div class="field"><label>Amount paid *</label><input class="input" type="number" step="0.01" min="0.01" max="' + due + '" id="ps-amt" value="' + due + '"></div>' +
            '<div class="field"><label>Note (optional)</label><input class="input" id="ps-note" placeholder="e.g. paid by UPI / cheque no."></div>' +
          "</div>",
        footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="ps-save">Record payment</button>',
        onMount: function (el, close) {
          $("#ps-save", el).onclick = function () {
            var amt = U.num($("#ps-amt", el).value);
            store.paySupplier(id, amt, $("#ps-note", el).value.trim()).then(function () {
              close(); return refresh();
            }).then(function () { toast("Payment to supplier recorded"); })
              .catch(function (e) { toast(e.message || "Could not record payment", "error"); });
          };
        }
      });
    }).catch(function (e) { toast(e.message || "Could not open purchase", "error"); });
  }

  function openBill(purchaseId) {
    var p = state.purchases.filter(function (x) { return x.id === purchaseId; })[0];
    if (!p || !p.bill) { toast("No bill attached", "warn"); return; }
    db.get("files", p.bill.id).then(function (f) {
      if (!f || !f.dataUrl) { toast("Bill file not found", "error"); return; }
      // Only allow locally-generated file URLs; block javascript:/attribute-breakout
      // from a hand-crafted backup, then escape for safe use inside src/href.
      var raw = String(f.dataUrl);
      if (!/^(?:data:|blob:)/i.test(raw)) { toast("This bill link is not a valid file", "error"); return; }
      var url = h(raw);
      var type = f.type || "";
      var preview = type.indexOf("image/") === 0
        ? '<img src="' + url + '" alt="bill" style="max-width:100%;border:1px solid var(--border);border-radius:8px">'
        : (type === "application/pdf"
            ? '<iframe src="' + url + '" style="width:100%;height:60vh;border:1px solid var(--border);border-radius:8px"></iframe>'
            : '<div class="alert blue">No inline preview for this file type — use Download to open it.</div>');
      modal({
        title: "Supplier bill", size: "wide",
        body: '<div class="small muted" style="margin-bottom:10px">' + h(f.name || "bill") + " · " + Math.round((f.size || 0) / 1024) + " KB</div>" + preview,
        footer: '<a class="btn btn-primary" href="' + url + '" download="' + h(f.name || "bill") + '">' + ico("download") + ' Download</a><button class="btn" data-close>Close</button>'
      });
    });
  }

  function delPurchase(id) {
    var p = state.purchases.filter(function (x) { return x.id === id; })[0] || {};
    confirm({
      title: "Delete purchase?", danger: true, okText: "Delete",
      message: "Delete purchase <strong>" + h(p.invoiceNo || "") + "</strong> and remove the stock it added?"
    }).then(function (yes) {
      if (!yes) return;
      store.deletePurchase(id).then(refresh).then(function () { toast("Purchase deleted"); })
        .catch(function (e) { toast(e.message || "Delete failed", "error"); });
    });
  }


  /* ============ Purchase suggestions from sales velocity ============ */
  function lastCost(pid) {
    var best = null;
    (state.purchases || []).forEach(function (pu) {
      (pu.items || []).forEach(function (it) {
        if (it.productId !== pid) return;
        if (!best || (pu.date || "") >= (best.date || "")) best = { date: pu.date, cost: Number(it.unitCost) || 0 };
      });
    });
    if (best && best.cost > 0) return best.cost;
    return Number((state.pmap[pid] || {}).costPrice) || 0;
  }

  // Products whose stock covers less than `days` of their recent sales rate

  function computeSuggestions(days) {
    days = days || 30;
    var from = U.toISODate(new Date(Date.now() - days * 86400000));
    var sold = {};
    (state.sales || []).forEach(function (s) {
      if (!s.date || s.date < from) return;
      (s.items || []).forEach(function (it) {
        // quantity is in selling units; convert to base units for stock maths
        sold[it.productId] = U.roundQty((sold[it.productId] || 0) + (Number(it.quantity) || 0) * (Number(it.unitFactor) || 1));
      });
    });
    var rows = Object.keys(sold).map(function (pid) {
      var p = state.pmap[pid];
      if (!p || p.active === false) return null;
      var q = sold[pid];
      if (!(q > 0)) return null;
      var rate = q / days, st = stock(pid);
      var cover = st / rate;
      if (cover >= days && st > (Number(p.reorderLevel) || 0)) return null;
      return {
        pid: pid, name: p.name, unit: p.unit || "",
        sold: q, rate: rate, st: st, cover: cover,
        suggest: Math.max(1, Math.ceil(rate * days - st)),
        cost: lastCost(pid)
      };
    }).filter(Boolean);
    rows.sort(function (a, b) { return a.cover - b.cover; });
    return rows;
  }

  function openSuggestions() {
    var rows = computeSuggestions(30);
    if (!rows.length) { toast("No purchase suggestions — current stock covers the last 30 days of sales", "warn"); return; }
    var m;
    m = modal({
      title: "Suggested purchases", icon: "bulb", hue: "due", size: "wide",
      body:
        '<div class="small muted" style="margin-bottom:10px">Based on what sold in the last 30 days. "Days left" = current stock ÷ average daily sale; suggested qty tops you back up to 30 days of cover.</div>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th></th><th>Product</th><th class="num">Sold 30d</th><th class="num">Avg/day</th><th class="num">In stock</th><th class="num">Days left</th><th class="num">Suggest</th><th class="num">Est. cost</th></tr></thead><tbody>' +
        rows.map(function (r, i) {
          return "<tr>" +
            '<td><input type="checkbox" data-sg="' + i + '" checked></td>' +
            "<td>" + h(r.name) + (r.unit ? ' <span class="small muted">' + h(r.unit) + "</span>" : "") + "</td>" +
            '<td class="num">' + U.qty(r.sold) + "</td>" +
            '<td class="num">' + U.qty(U.roundQty(r.rate * 100) / 100) + "</td>" +
            '<td class="num">' + U.qty(r.st) + "</td>" +
            '<td class="num"><span class="badge ' + (r.cover < 7 ? "red" : r.cover < 15 ? "amber" : "gray") + '">' + Math.floor(r.cover) + "</span></td>" +
            '<td class="num"><strong>' + U.qty(r.suggest) + "</strong></td>" +
            '<td class="num muted">' + U.money(U.roundMoney(r.suggest * r.cost)) + "</td></tr>";
        }).join("") +
        "</tbody></table></div>",
      footer: '<button class="btn" data-close>Close</button><button class="btn btn-primary" id="sg-make">' + ico("edit") + ' Create purchase from selected</button>',
      onMount: function (el) {
        $("#sg-make", el).onclick = function () {
          var sel = $all("[data-sg]", el).filter(function (c) { return c.checked; })
            .map(function (c) { return rows[+c.dataset.sg]; });
          if (!sel.length) { toast("Tick at least one item first", "warn"); return; }
          m.close();
          openPurchaseModal(sel.map(function (r) {
            return { productId: r.pid, quantity: r.suggest, unitCost: r.cost };
          }));
        };
      }
    });
  }

  function openPurchaseModal(prefill) {
    if (!state.products.length) { toast("Add a product first", "warn"); return; }
    var last = state.purchasePick || {};
    function supOptions() {
      return '<option value="">— None —</option>' + state.suppliers.map(function (s) {
        return '<option value="' + s.id + '">' + h(s.name) + "</option>";
      }).join("") + '<option value="__new">+ New supplier…</option>';
    }
    function prodOptions() {
      return '<option value="">Select product…</option>' + state.products.map(function (p) {
        return '<option value="' + p.id + '" data-cost="' + (p.costPrice || 0) + '">' + h(p.name) + " (" + h(p.unit || "") + ")</option>";
      }).join("") + '<option value="__new">+ New product…</option>';
    }
    var body =
      '<form id="puf"><div class="form-grid">' +
        '<div class="field"><label>Supplier</label><select class="select" name="supplierId">' + supOptions() + "</select></div>" +
        '<div class="field" id="pu-newsup-wrap" style="display:none"><label>New supplier name *</label><input class="input" name="newSupplier" placeholder="e.g. IFFCO distributor"></div>' +
        '<div class="field"><label>Date</label><input class="input" type="date" name="date" value="' + U.todayISO() + '"></div>' +
        '<div class="field"><label>Invoice no.</label><input class="input" name="invoiceNo" autocomplete="off" placeholder="auto"></div>' +
        '<div class="field"><label>Payment</label><select class="select" name="paymentMethod">' +
          PAYMENTS.map(function (pm) { return '<option value="' + h(pm) + '"' + (pm === (last.paymentMethod || "Cash") ? " selected" : "") + ">" + h(pm) + "</option>"; }).join("") +
        "</select></div>" +
        '<div class="field"><label>&nbsp;</label><div class="small muted">Credit keeps the amount owing under Payables.</div></div>' +
      "</div>" +
      '<div class="mt"><div class="section-title">Items</div><div id="pu-rows"></div>' +
        '<button class="btn btn-sm" type="button" id="pu-addr">' + ico("plus") + ' Add row</button></div>' +
      '<div class="spread mt"><span class="muted">Total</span><strong id="pu-total" style="font-size:18px">' + U.money(0) + "</strong></div>" +
      foldMarkup("pu-more", "attach the supplier bill, notes", "form-grid") +
        '<div class="field full"><label>Attach supplier bill (PDF / photo / any file)</label>' +
          '<div class="row"><input type="file" id="pu-bill"><span class="small muted" id="pu-bill-name"></span></div>' +
          '<div class="hint">Stored with the purchase so you can reopen the original bill anytime.</div></div>' +
        '<div class="field full"><label>Notes</label><input class="input" name="notes" autocomplete="off"></div>' +
      foldClose() +
      "</form>";

    modal({
      title: "New Purchase", icon: "truck", size: "wide", body: body, autofocus: false,
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="pu-save">Save Purchase</button>',
      onMount: function (el, close) {
        var f0 = $("#puf", el), rowsEl = $("#pu-rows", el);
        wireFold($("#pu-more", el));
        function rowHTML() {
          return '<div class="pu-row" data-row>' +
            '<div class="field pu-prod"><label>Product</label><select class="select" name="productId">' + prodOptions() + "</select></div>" +
            '<div class="field"><label>Batch</label><input class="input" name="batchNo" autocomplete="off" placeholder="lot no."></div>' +
            '<div class="field"><label>Mfg date</label><input class="input" type="date" name="mfgDate"></div>' +
            '<div class="field"><label>Expiry</label><input class="input" type="date" name="expiryDate"></div>' +
            '<div class="field"><label>Qty</label><input class="input" type="number" step="0.001" min="0" inputmode="decimal" name="quantity" placeholder="0" value="1"></div>' +
            '<div class="field"><label>Unit cost</label><input class="input" type="number" step="0.01" min="0" inputmode="decimal" name="unitCost" placeholder="0"></div>' +
            '<button class="icon-btn" type="button" data-rmrow title="Remove row">' + ico("trash") + "</button>" +
          "</div>";
        }
        // A product that is not on the shelf yet gets made here and then, rather
        // than sending the counter off to Products and back again.
        function refreshProductSelects() {
          $all("[data-row]", rowsEl).forEach(function (r) {
            var s = $('[name=productId]', r), keep = s.value;
            s.innerHTML = prodOptions();
            s.value = keep;
          });
        }
        function bindRow(row) {
          var sel = $('[name=productId]', row);
          sel.onchange = function () {
            if (sel.value === "__new") {
              sel.value = "";
              S.openProductModal(null, { onSaved: function (created) {
                if (!created) return;
                refreshProductSelects();
                sel.value = created.id;
                if (Number(created.costPrice) > 0) $('[name=unitCost]', row).value = created.costPrice;
                $('[name=quantity]', row).focus();
                total();
              } });
              return;
            }
            var opt = sel.options[sel.selectedIndex];
            var cost = opt && opt.dataset ? opt.dataset.cost : null;
            if (cost != null) $('[name=unitCost]', row).value = cost;
            total();
          };
          $('[name=quantity]', row).addEventListener("input", total);
          $('[name=unitCost]', row).addEventListener("input", total);
          $('[data-rmrow]', row).onclick = function () { row.remove(); total(); };
        }
        function addRow() {
          var d = document.createElement("div");
          d.innerHTML = rowHTML();
          var row = d.firstElementChild;
          rowsEl.appendChild(row);
          bindRow(row);
          return row;
        }
        function total() {
          var t = 0;
          $all("[data-row]", rowsEl).forEach(function (r) {
            t += U.num($('[name=quantity]', r).value) * U.num($('[name=unitCost]', r).value);
          });
          $("#pu-total", el).textContent = U.money(U.roundMoney(t));
        }
        $("#pu-addr", el).onclick = function () { $('[name=batchNo]', addRow()).focus(); };
        if (prefill && prefill.length) {
          prefill.forEach(function (it) {
            var row = addRow();
            $('[name=productId]', row).value = it.productId;
            $('[name=quantity]', row).value = it.quantity;
            $('[name=unitCost]', row).value = it.unitCost != null ? it.unitCost : 0;
          });
          total();
        } else addRow();

        var supSel = $('[name=supplierId]', f0);
        if (last.supplierId) supSel.value = last.supplierId;
        supSel.onchange = function () {
          $("#pu-newsup-wrap", el).style.display = (supSel.value === "__new") ? "" : "none";
        };

        var billInput = $("#pu-bill", el);
        billInput.onchange = function () {
          var f = billInput.files && billInput.files[0];
          var label = $("#pu-bill-name", el);
          label.textContent = f ? (f.name + " · " + Math.max(1, Math.round(f.size / 1024)) + " KB — will attach") : "";
        };

        enterWalk(f0, function () { $("#pu-save", el).click(); });
        var start = $('[name=productId]', rowsEl.firstElementChild);
        if (start) start.focus();

        $("#pu-save", el).onclick = function () {
          var items = [];
          $all("[data-row]", rowsEl).forEach(function (r) {
            var pid = $('[name=productId]', r).value;
            var q = U.num($('[name=quantity]', r).value);
            if (!pid || pid === "__new" || !(q > 0)) return;
            items.push({
              productId: pid, batchNo: $('[name=batchNo]', r).value.trim(),
              mfgDate: $('[name=mfgDate]', r).value, expiryDate: $('[name=expiryDate]', r).value,
              quantity: q, unitCost: Math.max(0, U.num($('[name=unitCost]', r).value))
            });
          });
          if (!items.length) { toast("Add at least one item with a product and quantity", "error"); return; }

          var supSel = $('[name=supplierId]', el);
          var billFile = ($("#pu-bill", el).files || [])[0] || null;
          var payload = {
            date: $('[name=date]', el).value || U.todayISO(),
            invoiceNo: $('[name=invoiceNo]', el).value.trim(),
            prefix: state.settings.purchasePrefix || "PUR",
            notes: $('[name=notes]', el).value,
            paymentMethod: $('[name=paymentMethod]', el).value || "Cash",
            items: items
          };

          function doCreate(supplierId) {
            payload.supplierId = supplierId;
            var withBill = billFile
              ? U.readFileDataURL(billFile).then(function (du) {
                  payload.bill = { name: billFile.name, type: billFile.type, size: billFile.size, dataUrl: du };
                })
              : Promise.resolve();
            return withBill.then(function () { return store.createPurchase(payload); });
          }
          function finish(p) {
            state.purchasePick = { supplierId: payload.supplierId, paymentMethod: payload.paymentMethod };
            close();
            return refresh().then(function () { toast("Purchase " + p.invoiceNo + " saved — stock added"); });
          }

          if (supSel.value === "__new") {
            var nm = $('[name=newSupplier]', el).value.trim();
            if (!nm) { toast("Enter the new supplier name", "error"); return; }
            var ns = { id: U.uid("sup"), name: nm };
            store.saveSupplier(ns).then(function () { return doCreate(ns.id); })
              .then(finish).catch(function (e) { toast(e.message || "Save failed", "error"); });
          } else {
            doCreate(supSel.value).then(finish).catch(function (e) { toast(e.message || "Save failed", "error"); });
          }
        };
      }
    });
  }
  Object.assign(FS.ui._shared, {
    viewPurchase: viewPurchase, openPaySupplierModal: openPaySupplierModal });
})(window.FS);
