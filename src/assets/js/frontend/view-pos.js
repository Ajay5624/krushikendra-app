/* =========================================================
   view-pos.js — point of sale
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
  var _paintCart = null;


  /* =========================== POINT OF SALE =========================== */
  V.pos = function (el) {
    el.dataset.hue = "in";
    setPage("Point of Sale", "Create a new customer invoice");
    if (!state.posMeta) state.posMeta = { customerName: "", customerPhone: "", discount: 0, discountType: "amt", taxRate: state.settings.taxRate || 0, paymentMethod: "Cash" };

    el.innerHTML =
      '<div class="pos">' +
        '<div class="card pos-catalog">' +
          '<div class="pos-topbar" id="pos-topbar">' +
            '<span class="ptb-count" id="ptb-count">0 item(s)</span>' +
            '<span class="ptb-total">Total <strong id="ptb-total">' + U.money(0) + '</strong></span>' +
            '<button class="btn btn-primary btn-sm" id="ptb-pay" disabled>Pay</button>' +
          '</div>' +
          '<div class="search" style="margin-bottom:12px">' + ico("search", "s-ico") + '<input id="pos-search" placeholder="Search product to add…" value="' + h(state.posSearch) + '"><button class="s-clear" type="button" tabindex="-1" aria-label="Clear search">' + ico("close") + "</button></div>" +
          '<div class="cat-chips" id="pos-chips"></div>' +
          '<div class="prod-grid" id="pos-cards"></div>' +
        "</div>" +
        '<div id="pos-cart"></div>' +
      "</div>";

    var ptbPay = $("#ptb-pay", el);
    if (ptbPay) ptbPay.onclick = function () { checkout(); };

    // chips
    var allCats = ["All"].concat(cats());
    var pcCounts = {};
    state.products.forEach(function (p) { if (p.active !== false && p.category) pcCounts[p.category] = (pcCounts[p.category] || 0) + 1; });
    $("#pos-chips", el).innerHTML = allCats.map(function (c) {
      var on = state.posCategory === c;
      return '<button class="cchip' + (on ? " active" : "") + '" data-cat="' + h(c) + '" aria-pressed="' + on + '">' +
        (c === "All" ? "" : '<span class="cdot"></span>') + h(c) +
        '<span class="cn">' + (c === "All" ? state.products.filter(function (p) { return p.active !== false; }).length : (pcCounts[c] || 0)) + "</span></button>";
    }).join("");
    $$("#pos-chips .cchip", el).forEach(function (b) { b.onclick = function () { state.posCategory = b.dataset.cat; V.pos(el); }; });

    var searchEl = $("#pos-search", el);
    searchEl.addEventListener("input", U.debounce(function () { state.posSearch = searchEl.value; paintCards(); }, 180));

    function paintCards() {
      var q = (state.posSearch || "").trim().toLowerCase(), c = state.posCategory;
      var rows = state.products.filter(function (p) {
        if (p.active === false) return false;
        if (c !== "All" && p.category !== c) return false;
        if (!q) return true;
        return (p.name + " " + (p.brand || "") + " " + (p.npk || "") + " " + (p.localName || "") + " " + (p.activeIngredient || "")).toLowerCase().indexOf(q) >= 0;
      });
      $("#pos-cards", el).innerHTML = rows.length ? rows.map(function (p) {
        var s = stock(p.id), out = s <= 0;
        var thumb = U.safeImgSrc(p.image && p.image.thumb);
        return '<div class="prod-card' + (out ? " out" : "") + '" data-add="' + p.id + '">' +
          (thumb ? '<img class="pcard-thumb" src="' + thumb + '" alt="">' : '<span class="pcard-thumb none">' + ico("leaf") + "</span>") +
          '<div class="p-name">' + h(p.name) + "</div>" +
          '<div class="p-meta">' + typeBadge(p.type) + h(p.brand || "") + (p.npk ? " · " + h(p.npk) : "") + (p.activeIngredient ? " · " + h(p.activeIngredient) : "") + "</div>" +
          '<div class="p-bot"><span class="p-price">' + cardPriceLabel(p) + "</span>" +
          '<span class="badge ' + (out ? "red" : s <= (p.reorderLevel || 0) ? "amber" : "gray") + '">' + U.qty(s) + " " + h(p.unit || "") + "</span></div></div>";
      }).join("") : '<div class="muted small">No products match.</div>';
      $$("#pos-cards [data-add]", el).forEach(function (card) {
        card.onclick = function () { addToCart(card.dataset.add); };
      });
      var sr = $("#pos-search"); if (sr) { sr.focus(); }
    }

    function paintCart() {
      var t = cartTotals();
      var pc = $("#ptb-count", el); if (pc) pc.textContent = state.cart.length + " item(s)";
      var pt = $("#ptb-total", el); if (pt) pt.textContent = U.money(t.total);
      var pp = $("#ptb-pay", el); if (pp) { pp.disabled = !state.cart.length; pp.textContent = state.cart.length ? ("Pay " + U.money(t.total)) : "Pay"; }
      var lines = state.cart.length ? state.cart.map(function (l, i) {
        var p = state.pmap[l.productId] || {};
        var f = l.unitFactor || 1;
        var stockTxt = f > 1 ? U.qty(Math.floor(stock(l.productId) / f)) + " " + h(l.unitName || "")
                             : U.qty(stock(l.productId)) + " " + h(p.unit || "");
        return '<div class="cart-line" data-i="' + i + '">' +
          '<div class="cl-info">' +
            '<div class="cl-name">' + h(p.name || "Item") + (l.unitName ? ' <span class="small muted">· ' + h(l.unitName) + "</span>" : "") + "</div>" +
            '<div class="cl-meta">' + U.money(l.price) + " · stock " + stockTxt + "</div>" +
            '<div class="cl-ctl">' +
              '<button class="icon-btn" data-dec="' + i + '" aria-label="Reduce quantity">' + ico("minus") + "</button>" +
              '<input class="input qty-input" type="number" step="' + (f > 1 ? 1 : 0.001) + '" min="0" data-qty="' + i + '" value="' + l.qty + '">' +
              '<button class="icon-btn" data-inc="' + i + '" aria-label="Increase quantity">' + ico("plus") + "</button>" +
            "</div>" +
          "</div>" +
          '<div class="cl-right">' +
            '<div class="cl-total">' + U.money(l.qty * l.price) + "</div>" +
            '<button class="icon-btn" data-rm="' + i + '" title="Remove line" aria-label="Remove line">' + ico("trash") + "</button>" +
          "</div>" +
        "</div>";
      }).join("") : '<div class="cart-empty">Cart is empty.<br><span class="small">Click a product to add it.</span></div>';

      var m = state.posMeta;
      $("#pos-cart", el).innerHTML =
        '<div class="cart">' +
          '<div class="cart-head"><span>Current Sale</span><span class="row" style="gap:8px"><span class="badge blue">' + state.cart.length + ' item(s)</span><button class="btn btn-sm btn-ghost" id="cart-clear"' + (state.cart.length ? "" : " disabled") + ">Clear</button></span></div>" +
          '<div class="cart-items">' + lines + "</div>" +
          '<div class="cart-foot">' +
            '<div class="form-grid" style="grid-template-columns:1fr 1fr;gap:8px">' +
              '<div class="field"><label>Customer <button type="button" class="link-btn" id="cust-pick" title="Pick a previous customer">' + ico("users") + ' pick</button></label><input class="input" name="customerName" placeholder="Walk-in" value="' + h(m.customerName) + '"></div>' +
              '<div class="field"><label>Phone</label><input class="input" name="customerPhone" value="' + h(m.customerPhone) + '"></div>' +
            "</div>" +
            '<div class="form-grid mt-sm" style="grid-template-columns:1fr 1fr 1fr;gap:8px">' +
              '<div class="field"><label>Discount</label><input class="input" type="number" step="0.01" min="0" name="discount" value="' + (m.discount || 0) + '"></div>' +
              '<div class="field"><label>Type</label><select class="select" name="discountType"><option value="amt"' + (m.discountType === "amt" ? " selected" : "") + ">Amount</option><option value=\"pct\"" + (m.discountType === "pct" ? " selected" : "") + ">%</option></select></div>" +
              '<div class="field"><label>Tax %</label><input class="input" type="number" step="0.01" min="0" name="taxRate" value="' + (m.taxRate || 0) + '"></div>' +
            "</div>" +
            '<div class="mt-sm">' +
              '<div class="sum-line"><span class="muted">Subtotal</span><span>' + U.money(t.sub) + "</span></div>" +
              '<div class="sum-line"><span class="muted">Discount</span><span>− ' + U.money(t.disc) + "</span></div>" +
              '<div class="sum-line"><span class="muted">Tax (' + t.taxRate + "%)</span><span>" + U.money(t.tax) + "</span></div>" +
              '<div class="sum-line total"><span>Total</span><span>' + U.money(t.total) + "</span></div>" +
            "</div>" +
            '<div class="field mt-sm"><label>Payment</label><div class="row" style="gap:6px" id="pay-chips">' +
              PAYMENTS.map(function (pm) { return '<button type="button" class="chip' + (m.paymentMethod === pm ? " active" : "") + '" data-pay="' + h(pm) + '">' + h(pm) + "</button>"; }).join("") +
            "</div></div>" +
            '<div id="pos-credit-warn"></div>' +
            '<button class="btn btn-primary btn-pay mt-sm" id="cart-pay" style="width:100%"' + (state.cart.length ? "" : " disabled") + ">Complete Sale</button>" +
          "</div>" +
        "</div>";

      // bind cart controls
      $$("#pos-cart [data-inc]", el).forEach(function (b) { b.onclick = function () { chgQty(+b.dataset.inc, 1); }; });
      $$("#pos-cart [data-dec]", el).forEach(function (b) { b.onclick = function () { chgQty(+b.dataset.dec, -1); }; });
      $$("#pos-cart [data-rm]", el).forEach(function (b) { b.onclick = function () { state.cart.splice(+b.dataset.rm, 1); paintCart(); }; });
      $$("#pos-cart [data-qty]", el).forEach(function (inp) {
        inp.onchange = function () { setQty(+inp.dataset.qty, U.num(inp.value)); };
      });
      ["customerName", "customerPhone", "discount", "discountType", "taxRate"].forEach(function (nm) {
        var f = $('#pos-cart [name="' + nm + '"]', el);
        if (f) f.addEventListener("input", function () {
          state.posMeta[nm] = f.value;
          if (nm === "discount" || nm === "taxRate") updateTotalsOnly();
          if (nm === "customerName" || nm === "customerPhone") updateCreditWarn();
        });
        if (f && nm === "discountType") f.addEventListener("change", function () { state.posMeta[nm] = f.value; updateTotalsOnly(); });
      });
      $$("#pay-chips .chip", el).forEach(function (b) {
        b.onclick = function () {
          state.posMeta.paymentMethod = b.dataset.pay;
          $$("#pay-chips .chip", el).forEach(function (x) { x.classList.toggle("active", x === b); });
          updateCreditWarn();
        };
      });
      $("#cart-clear", el).onclick = function () { state.cart = []; state.posMeta.discount = 0; paintCart(); };
      var cp = $("#cust-pick", el); if (cp) cp.onclick = function () { openCustomerPick(true); };
      var pay = $("#cart-pay", el); if (pay) pay.onclick = checkout;
      updateCreditWarn();
    }

    function updateCreditWarn() {
      var box = $("#pos-credit-warn", el); if (!box) return;
      var chk = posCreditCheck();
      box.innerHTML = (chk && chk.over)
        ? '<div class="alert red mt-sm" style="display:block">' + ico("alert") + ' <strong>' + h(chk.name || "This customer") + "</strong> would exceed their credit limit." +
          '<div class="small" style="margin-top:4px">Limit ' + U.money(chk.limit) + " · already due " + U.money(chk.existing) + " · this sale " + U.money(chk.total) + " → <strong>" + U.money(chk.projected) + "</strong></div></div>"
        : "";
    }

    function updateTotalsOnly() {
      var t = cartTotals();
      var foot = $("#pos-cart .cart-foot", el); if (!foot) return;
      var lines = foot.querySelectorAll(".sum-line");
      if (lines.length >= 4) {
        lines[0].lastChild.textContent = U.money(t.sub);
        lines[1].lastChild.textContent = "− " + U.money(t.disc);
        lines[2].firstChild.textContent = "Tax (" + t.taxRate + "%)";
        lines[2].lastChild.textContent = U.money(t.tax);
        lines[3].lastChild.textContent = U.money(t.total);
      }
    }

    _paintCart = paintCart;
    paintCards();
    paintCart();
  };

  function cartTotals() {
    var sub = 0; state.cart.forEach(function (l) { sub += Number(l.qty) * Number(l.price); });
    sub = U.roundMoney(sub);
    var m = state.posMeta || {};
    var disc = store.computeDiscount(sub, m.discount, m.discountType);
    var base = U.roundMoney(sub - disc);
    var taxRate = U.num(m.taxRate);
    var tax = U.roundMoney(base * taxRate / 100);
    var total = U.roundMoney(base + tax);
    return { sub: sub, disc: disc, taxRate: taxRate, tax: tax, total: total };
  }

  // Credit-limit check for the current POS cart. Returns null when it does not
  // apply (not a Credit sale, no named customer, or that farmer has no limit set).

  function posCreditCheck() {
    var m = state.posMeta || {};
    if (m.paymentMethod !== "Credit") return null;
    var key = store.customerKey(m.customerName, m.customerPhone);
    if (!key) return null;
    var rec = state.custmap[key];
    var limit = rec ? U.num(rec.creditLimit) : 0;
    if (!(limit > 0)) return null;
    var existing = 0;
    (state.sales || []).forEach(function (s) {
      if (store.customerKey(s.customerName, s.customerPhone) === key) existing += store.saleDue(s);
    });
    existing = U.roundMoney(existing);
    var total = cartTotals().total;
    var projected = U.roundMoney(existing + total);
    return { key: key, name: (rec && rec.name) || (m.customerName || "").trim(), limit: limit, existing: existing, total: total, projected: projected, over: projected > limit };
  }

  // Packs available from a base-unit stock pool (loose units keep decimals).

  function unitAvail(factor, sBase) {
    return factor > 1 ? Math.floor(U.num(sBase) / factor) : U.roundQty(sBase);
  }

  function addToCart(productId) {
    var p = state.pmap[productId]; if (!p) return;
    if (!hasRate(p)) { toast(p.name + " has no selling price yet — set it in Products first", "warn"); return; }
    var s = stock(productId);
    if (s <= 0) { toast("No stock for " + p.name, "warn"); return; }
    var us = store.effectiveUnits(p);
    if (us.length > 1) { openUnitPicker(p, us, s); return; }
    pushUnit(p, us[0]);
  }

  /* An item with no rate would otherwise bill silently at ₹0, so the counter has to
     be told where to fix it instead. */
  function hasRate(p) {
    return store.effectiveUnits(p).some(function (u) { return Number(u.price) > 0; });
  }

  function pushUnit(p, u) {
    var s = stock(p.id);
    if (!(Number(u.price) > 0)) { toast("No price set for " + u.name + " — set it in Products first", "warn"); return; }
    var line = state.cart.filter(function (l) { return l.productId === p.id && (l.unitId || "__base") === u.id; })[0];
    if (line) {
      var f = line.unitFactor || 1;
      if (U.roundQty((line.qty + 1) * f) > s) {
        toast("Only " + U.qty(unitAvail(f, s)) + " " + (line.unitName || p.unit || "") + " in stock", "warn"); return;
      }
      line.qty = U.roundQty(line.qty + 1);
    } else {
      if (u.factor > 1 && U.roundQty(u.factor) > s) {
        toast("Not enough stock for one " + u.name + " (" + U.qty(s) + " " + (p.unit || "") + " available)", "warn"); return;
      }
      state.cart.push({ productId: p.id, unitId: u.id, unitName: u.name, unitFactor: u.factor, qty: 1, price: u.price });
    }
    if (_paintCart) _paintCart();
  }

  function openUnitPicker(p, us, sBase) {
    modal({
      title: "Sell " + p.name, size: "narrow",
      body: '<div class="small muted" style="margin-bottom:10px">In stock: ' + U.qty(sBase) + " " + h(p.unit || "") + " — choose a selling unit</div>" +
        '<div class="row" style="flex-wrap:wrap;gap:8px">' +
        us.map(function (u, i) {
          var av = unitAvail(u.factor, sBase);
          return '<button class="chip" type="button" data-choose-unit="' + i + '"' + (av <= 0 ? ' style="opacity:.45"' : "") + ">" +
            "<strong>" + h(u.name) + "</strong> · " + U.money(u.price) +
            '<span class="small muted"> · ' + U.qty(av) + " avail</span></button>";
        }).join("") + "</div>",
      footer: '<button class="btn" data-close>Cancel</button>',
      onMount: function (el, close) {
        $$("[data-choose-unit]", el).forEach(function (b) {
          b.onclick = function () {
            var u = us[+b.dataset.chooseUnit];
            if (unitAvail(u.factor, sBase) <= 0) { toast("Not enough stock for " + u.name, "warn"); return; }
            close();
            pushUnit(p, u);
          };
        });
      }
    });
  }

  function chgQty(i, delta) {
    var l = state.cart[i]; if (!l) return;
    var s = stock(l.productId);
    var f = l.unitFactor || 1;
    var nq = U.roundQty(Number(l.qty) + delta);
    if (nq <= 0) { state.cart.splice(i, 1); }
    else if (U.roundQty(nq * f) > s) { toast("Only " + U.qty(unitAvail(f, s)) + " in stock", "warn"); return; }
    else l.qty = nq;
    if (_paintCart) _paintCart();
  }

  function setQty(i, val) {
    var l = state.cart[i]; if (!l) return;
    var s = stock(l.productId);
    var max = unitAvail(l.unitFactor || 1, s);
    val = U.roundQty(val);
    if (val > max) { toast("Only " + U.qty(max) + " in stock", "warn"); val = max; }
    if (val <= 0) state.cart.splice(i, 1);
    else l.qty = val;
    // repaint after the current event: a synchronous repaint here destroys the
    // button being pressed (e.g. Complete Sale) before its click dispatches
    requestAnimationFrame(function () { if (_paintCart) _paintCart(); });
  }

  function checkout() {
    if (!state.cart.length) { toast("Cart is empty", "warn"); return; }
    var m = state.posMeta;
    if (m.paymentMethod === "Credit" && !(m.customerName || "").trim()) {
      toast("Credit sale needs a customer name — fill it in the Current Sale panel", "warn");
      return;
    }
    var t = cartTotals();
    var who = (m.customerName || "").trim() || "Walk-in";
    var payLbl = m.paymentMethod === "Credit" ? "Credit — to be collected" : (m.paymentMethod || "Cash");
    var chk = posCreditCheck();
    var baseMsg =
      "Sell <strong>" + state.cart.length + " item(s)</strong> to <strong>" + h(who) + "</strong> for <strong>" + U.money(t.total) + "</strong> (" + h(payLbl) + ")?" +
      '<br><span class="small muted">Subtotal ' + U.money(t.sub) +
      (t.disc ? " · Discount " + U.money(t.disc) : "") +
      (t.tax ? " · Tax " + U.money(t.tax) : "") + "</span>";
    var copts = (chk && chk.over)
      ? {
          title: "Over credit limit", danger: true, okText: "Sell anyway",
          message: '<div class="alert red" style="display:block"><strong>' + h(chk.name || who) + "</strong> is over their credit limit.</div>" +
            '<div class="small mt-sm">Limit ' + U.money(chk.limit) + " · already due " + U.money(chk.existing) + " · this sale " + U.money(t.total) +
            "<br>After this sale: <strong>" + U.money(chk.projected) + "</strong> (over by " + U.money(chk.projected - chk.limit) + ").</div>" +
            '<div class="mt-sm">' + baseMsg + "</div>"
        }
      : { title: "Complete this sale?", okText: "Confirm Sale", message: baseMsg };
    confirm(copts).then(function (yes) {
      if (!yes) return;
      var payload = {
        items: state.cart.map(function (l) { return { productId: l.productId, quantity: l.qty, price: l.price, unitId: l.unitId || "__base", unitName: l.unitName || "", unitFactor: l.unitFactor || 1 }; }),
        customerName: (m.customerName || "").trim() || "Walk-in",
        customerPhone: (m.customerPhone || "").trim(),
        discount: U.num(m.discount), discountType: m.discountType,
        taxRate: U.num(m.taxRate), paymentMethod: m.paymentMethod, date: U.todayISO()
      };
      store.createSale(payload).then(function (sale) {
        state.cart = [];
        state.posSearch = "";
        state.posCategory = "All";
        state.posMeta = { customerName: "", customerPhone: "", discount: 0, discountType: "amt", taxRate: state.settings.taxRate || 0, paymentMethod: m.paymentMethod };
        return ui.reload().then(function () { ui.render(); return sale; });
      }).then(function (sale) {
        showSaleSuccess(sale);
      }).catch(function (e) { toast(e.message || "Sale failed", "error"); });
    });
  }

  function showSaleSuccess(sale) {
    modal({
      title: "Sale completed", icon: "check", hue: "in", size: "narrow",
      body:
        '<div class="center" style="padding:6px 0 2px">' +
          '<div class="small muted">Invoice</div><div style="font-size:20px;font-weight:700">' + h(sale.invoiceNo) + "</div>" +
          '<div class="small muted mt-sm">' + h(sale.customerName) + " · " + U.fmtDate(sale.date) + "</div>" +
          '<div style="font-size:30px;font-weight:800;margin:10px 0">' + U.money(sale.total) + "</div>" +
          '<div class="small muted">' + (sale.items.length) + " item(s) · " + h(sale.paymentMethod) + "</div>" +
        "</div>",
      footer: '<button class="btn" data-close>Close</button><button class="btn" id="ss-new">New Sale</button><button class="btn btn-primary" id="ss-print">' + ico("print") + ' Print Invoice</button>',
      onMount: function (el, close) {
        $("#ss-print", el).onclick = function () { printInvoice(sale); };
        $("#ss-new", el).onclick = function () { close(); var s = $("#pos-search"); if (s) s.focus(); };
      }
    });
  }

  function openCustomerPick(allowPick) {
    var list = customerList();
    if (!list.length) { toast("No named customers yet — add a customer name on a sale first", "warn"); return; }
    var m;
    m = modal({
      title: "Customer book", icon: "users", size: "wide",
      body: '<div class="search" style="margin-bottom:12px">' + ico("search","s-ico") + '' +
        '<input id="cp-q" placeholder="Search name or phone…">' +
        '<button class="s-clear" type="button" tabindex="-1" aria-label="Clear search">' + ico("close") + '</button></div>' +
        '<div id="cp-list"></div>',
      footer: '<button class="btn" data-close>Close</button>',
      onMount: function (el) {
        var q = $("#cp-q", el);
        function paint() {
          var s = (q.value || "").trim().toLowerCase();
          var rows = list.filter(function (c) {
            return !s || c.name.toLowerCase().indexOf(s) >= 0 || (c.phone || "").indexOf(s) >= 0;
          });
          $("#cp-list", el).innerHTML = rows.length ? rows.map(function (c) {
            var i = list.indexOf(c);
            return '<div class="cp-row">' +
              '<div class="cp-main"><strong>' + h(c.name) + "</strong>" +
                (c.phone ? '<div class="small muted">' + h(c.phone) + "</div>" : "") + "</div>" +
              '<div class="cp-meta">' +
                '<span class="badge gray">' + c.count + " sale" + (c.count > 1 ? "s" : "") + "</span>" +
                '<span class="badge blue">' + U.money(c.spent) + "</span>" +
                (c.due > 0 ? '<span class="badge red">Due ' + U.money(c.due) + "</span>" : "") +
                '<span class="small muted">Last ' + U.fmtDate(c.last) + "</span>" +
              "</div>" +
              '<div class="cp-act">' +
                (allowPick ? '<button class="btn btn-sm btn-primary" data-pick="' + i + '">Select</button>' : "") +
                '<button class="btn btn-sm" data-hist="' + i + '">History</button>' +
              "</div></div>";
          }).join("") : '<div class="muted small">No customer matches that search.</div>';

          $$("[data-pick]", el).forEach(function (b) {
            b.onclick = function () {
              var c = list[+b.dataset.pick];
              if (!state.posMeta) state.posMeta = { customerName: "", customerPhone: "", discount: 0, discountType: "amt", taxRate: state.settings.taxRate || 0, paymentMethod: "Cash" };
              state.posMeta.customerName = c.name;
              state.posMeta.customerPhone = c.phone || "";
              m.close();
              if (_paintCart) _paintCart(); else ui.setView("pos");
              toast("Customer set to " + c.name);
            };
          });
          $$("[data-hist]", el).forEach(function (b) {
            b.onclick = function () {
              var c = list[+b.dataset.hist];
              m.close();
              state.custHist = state.custHist || {};
              state.custHist.sel = c.key;
              ui.setView("customers");
            };
          });
        }
        q.addEventListener("input", U.debounce(paint, 150));
        q.focus();
        paint();
      }
    });
  }
})(window.FS);
