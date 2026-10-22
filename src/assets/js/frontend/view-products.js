/* =========================================================
   view-products.js — the product shelf, form and detail
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
  var foldMarkup = S.foldMarkup, foldClose = S.foldClose, wireFold = S.wireFold, enterWalk = S.enterWalk;
  var waPhone = S.waPhone, waOpen = S.waOpen, dueReminderText = S.dueReminderText, invoiceWaLines = S.invoiceWaLines;
  var waSaleReminder = S.waSaleReminder, waCustomerReminder = S.waCustomerReminder;

  /* =========================== PRODUCTS =========================== */
  V.products = function (el) {
    state.productFilter = state.productFilter || { q: "", category: "All" };
    var F = state.productFilter;
    var warnDays = state.settings.expiryWarnDays || 60;

    var valMap = {}, batchSeen = {};
    state.batches.forEach(function (b) {
      batchSeen[b.productId] = 1;
      valMap[b.productId] = (valMap[b.productId] || 0) + Number(b.quantity || 0) * Number(b.unitCost || 0);
    });
    // One expiry rule everywhere: store.expiringSoon skips dates it cannot parse,
    // so the shelf and the dashboard alert can never disagree about a batch.
    var expiringSet = {};
    store.expiringSoon(state.batches, warnDays).forEach(function (b) { expiringSet[b.productId] = 1; });
    function stockVal(p) { return U.roundMoney(valMap[p.id] || 0); }
    function neverStocked(p) { return !batchSeen[p.id]; }
    function isOut(p) { return stock(p.id) <= 0 && !neverStocked(p); }
    // One rule everywhere: store.lowStock already ignores packs the shop never bought.
    var lowSet = {};
    store.lowStock(state.products, state.stockMap, batchSeen).forEach(function (p) { lowSet[p.id] = 1; });
    function isLow(p) { return lowSet[p.id] === 1; }
    function isExpiring(p) { return expiringSet[p.id] === 1; }
    function severity(p) { return isOut(p) ? 0 : (isLow(p) ? 1 : (neverStocked(p) ? 3 : 2)); }

    var costVal = U.roundMoney(state.products.reduce(function (a, p) { return a + stockVal(p); }, 0));
    var retailVal = U.roundMoney(state.products.reduce(function (a, p) { return a + stock(p.id) * (Number(p.sellPrice) || 0); }, 0));
    var catList = cats();
    if (F.category !== "All" && catList.indexOf(F.category) < 0) F.category = "All";
    setPage("Products", state.products.length + " item(s) · stock worth " + U.money(costVal) + " at cost");

    el.innerHTML =
      metrics([
        { label: "Products", value: state.products.length, hint: catList.length + " categories" },
        { label: "Stock value (cost)", value: U.money(costVal), hint: "on " + state.products.length + " item(s)" },
        { label: "Stock value (retail)", value: U.money(retailVal), hint: "margin " + U.money(U.roundMoney(retailVal - costVal)) },
        { label: "Low stock", value: state.products.filter(isLow).length, hint: "at or below reorder", attr: 'data-act="low" aria-pressed="' + (F.flag === "low") + '" title="Tap to filter low stock"', hue: "warn" },
        { label: "Expiring soon", value: state.products.filter(isExpiring).length, hint: "within " + warnDays + " days", attr: 'data-act="expiring" aria-pressed="' + (F.flag === "expiring") + '" title="Tap to filter expiring stock"', hue: "bad" },
      ]) +
      '<div class="filters">' +
        '<div class="search">' + ico("search", "s-ico") + '<input id="p-search" placeholder="Search products, brand, molecule…" value="' + h(F.q) + '"><button class="s-clear" type="button" tabindex="-1" aria-label="Clear search">' + ico("close") + "</button></div>" +
        '<select class="select" id="p-sort" style="max-width:170px" title="Sort order">' +
          '<option value=""' + (F.sort ? "" : " selected") + ">Attention first</option>" +
          '<option value="name"' + (F.sort === "name" ? " selected" : "") + ">Name A–Z</option>" +
          '<option value="stock"' + (F.sort === "stock" ? " selected" : "") + ">Stock low → high</option>" +
          '<option value="value"' + (F.sort === "value" ? " selected" : "") + ">Value high → low</option>" +
        "</select>" +
        '<button class="btn" id="p-rate" title="View, print or export your selling price list">' + ico("tag") + "Rate card</button>" +
        '<button class="btn" id="p-csv" title="Export this list as a spreadsheet">' + ico("download") + "Export</button>" +
        '<button class="btn btn-primary" id="p-add">' + ico("plus") + "Add Product</button>" +
      "</div>" +
      '<div class="cats" id="p-cats"></div>' +
      '<div id="prod-shelves"></div>';

    function paintChips() {
      var counts = {};
      state.products.forEach(function (p) { if (p.category) counts[p.category] = (counts[p.category] || 0) + 1; });
      $("#p-cats", el).innerHTML = ["All"].concat(catList).map(function (c) {
        var on = F.category === c;
        return '<button class="cchip' + (on ? " active" : "") + '" type="button" data-catv="' + h(c) + '"' +
          (c === "All" ? "" : ' data-cat="' + h(c) + '"') + ' aria-pressed="' + on + '">' +
          (c === "All" ? "" : '<span class="cdot"></span>') + h(c) +
          '<span class="cn">' + (c === "All" ? state.products.length : counts[c]) + "</span></button>";
      }).join("");
      $$(".cchip", el).forEach(function (c) {
        c.onclick = function () { F.category = c.dataset.catv; ui.setView("products"); };
      });
    }
    paintChips();

    var searchEl = $("#p-search", el);
    searchEl.addEventListener("input", U.debounce(function () { F.q = searchEl.value; paint(); }, 200));
    $("#p-sort", el).addEventListener("change", function (e) { F.sort = e.target.value || ""; paint(); });
    $("#p-add", el).addEventListener("click", function () { openProductModal(null); });
    $("#p-rate", el).addEventListener("click", function () { openRateCard(); });
    $$("[data-act]", el).forEach(function (c) {
      c.onclick = function () { F.flag = F.flag === c.dataset.act ? "" : c.dataset.act; ui.setView("products"); };
    });
    exportMenu($("#p-csv", el), {
      title: "products", unit: "product", filename: "products",
      data: function () {
        function row(p) {
          var s = stock(p.id);
          return [p.name, p.category || "", p.brand || "", p.npk || "", s, p.unit || "",
            Number(p.costPrice) || 0, Number(p.sellPrice) || 0, stockVal(p),
            neverStocked(p) ? "Not stocked" : (s <= 0 ? "Out of stock" : (isLow(p) ? "Low" : "In stock"))];
        }
        return {
          columns: ["Name", "Category", "Brand", "NPK", "In stock", "Unit", "Cost price", "Sell price", "Stock value", "Status"],
          rows: sorted(filtered()).map(row),
          all: sorted(state.products).map(row)
        };
      }
    });

    function filtered() {
      var q = F.q.trim().toLowerCase(), c = F.category, flag = F.flag;
      return state.products.filter(function (p) {
        if (c !== "All" && p.category !== c) return false;
        if (flag === "low" && !isLow(p)) return false;
        if (flag === "expiring" && !isExpiring(p)) return false;
        if (!q) return true;
        return (p.name + " " + (p.brand || "") + " " + (p.npk || "") + " " + (p.category || "") + " " + (p.type || "") + " " + (p.activeIngredient || "") + " " + (p.localName || "")).toLowerCase().indexOf(q) >= 0;
      });
    }
    function sorted(rows) {
      return rows.slice().sort(function (a, b) {
        if (F.sort === "name") return (a.name || "").localeCompare(b.name || "");
        if (F.sort === "stock") return stock(a.id) - stock(b.id);
        if (F.sort === "value") return stockVal(b) - stockVal(a);
        var d = severity(a) - severity(b);
        return d !== 0 ? d : (a.name || "").localeCompare(b.name || "");
      });
    }
    var BAND_PREF = ["Insecticide", "Fungicide", "Herbicide", "PGR", "Organic"];
    function bandKeys(names) {
      var set = {}; names.forEach(function (c) { set[c] = 1; });
      return Object.keys(set).sort(function (a, b) {
        var ia = BAND_PREF.indexOf(a), ib = BAND_PREF.indexOf(b);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return a.localeCompare(b);
      });
    }
    function tile(p, i) {
      var s = stock(p.id);
      var img = U.safeImgSrc(p.image && p.image.thumb);
      var sub = [p.brand, p.activeIngredient].filter(Boolean).join(" · ");
      var base = Math.max(Number(p.reorderLevel) || 0, 1);
      var out = isOut(p), fresh = neverStocked(p);
      var mw = fresh ? 0 : Math.max(3, Math.min(100, Math.round(s / (base * 2) * 100)));
      return '<div class="ptile' + (out ? " out" : (isLow(p) ? " low" : (fresh ? " fresh" : ""))) + '" data-detail="' + p.id +
        '" role="button" tabindex="0" style="--i:' + Math.min(i, 14) + '">' +
        (out ? '<span class="pflag">Out</span>' : "") +
        '<div class="pk">' +
          (img ? '<img src="' + img + '" alt="" loading="lazy">' : '<span class="noimg">' + ico("box") + '</span>') +
          '<div class="pbody"><div class="pn">' + h(p.name) + "</div>" +
          '<div class="pm">' + h(sub || (p.npk || "no brand / molecule")) + "</div></div>" +
        "</div>" +
        '<div class="pfoot">' + (fresh
          ? '<span class="puom">not stocked yet</span>'
          : '<span class="pstock">' + U.qty(s) + '</span><span class="puom">' + h(p.unit || "") + "</span>") +
          (Number(p.sellPrice) > 0 ? '<span class="pprice">' + U.money(p.sellPrice) + "</span>" : '<span class="pprice need">Set price</span>') +
        "</div>" +
        '<div class="meter" style="--mw:' + mw + '%" title="stock against 2× reorder level"><i></i></div>' +
        '<div class="pquick"><button data-stock="' + p.id + '">+ Stock</button><button data-edit="' + p.id + '">Edit</button></div>' +
      "</div>";
    }
    function paint() {
      var rows = sorted(filtered());
      var box = $("#prod-shelves", el);
      if (!rows.length) {
        box.innerHTML = '<div class="empty-state">' +
          (state.products.length ? "No products match these filters." : "No products yet. Click “Add Product” to create one.") + "</div>";
        return;
      }
      var byCat = {};
      rows.forEach(function (p) { var c = p.category || "Uncategorised"; (byCat[c] = byCat[c] || []).push(p); });
      box.innerHTML = bandKeys(rows.map(function (p) { return p.category || "Uncategorised"; })).map(function (c, bi) {
        var list = byCat[c];
        return '<div class="band" data-cat="' + h(c) + '">' +
          '<div class="band-head" style="--i:' + Math.min(bi, 4) + '"><h2>' + h(c) + '</h2><span class="bh-n">' + list.length + "</span>" +
          '<span class="bh-val">stock value <strong>' + U.money(list.reduce(function (a, p) { return a + (valMap[p.id] || 0); }, 0)) + "</strong></span></div>" +
          '<div class="ptiles">' + list.map(tile).join("") + "</div></div>";
      }).join("");

      $$("[data-detail]", el).forEach(function (t) {
        t.onclick = function (e) { if (e.target.closest("button")) return; openProductDetail(t.dataset.detail); };
        t.onkeydown = function (e) {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openProductDetail(t.dataset.detail); }
        };
      });
      $$("[data-edit]", el).forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); openProductModal(state.pmap[b.dataset.edit]); }; });
      $$("[data-stock]", el).forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); openStockModal(b.dataset.stock); }; });
    }
    paint();
  };

  function delProduct(id) {
    var p = state.pmap[id] || {};
    confirm({
      title: "Delete product?", danger: true, okText: "Delete",
      message: "Delete <strong>" + h(p.name) + "</strong> and all its stock batches? This cannot be undone."
    }).then(function (yes) {
      if (!yes) return;
      store.deleteProduct(id).then(refresh).then(function () { toast("Product deleted"); }).catch(function (e) { toast(e.message, "error"); });
    });
  }

  function openProductModal(p, opts) {
    var isNew = !p;
    var pick = state.prodFormPick || {};
    p = p || {
      unit: pick.unit || "bag", type: pick.type || "Fertilizer", category: pick.category || "",
      trackBatch: true, trackExpiry: true, active: true,
      reorderLevel: pick.reorderLevel != null ? pick.reorderLevel : (state.settings.lowStockDefault || 5)
    };
    var catList = cats();
    // Editing a product that already carries catalogue detail opens it unfolded;
    // a new one starts with only what it takes to put a price on a pack.
    var hasExtra = !!(p.localName || p.npk || p.activeIngredient || p.formulation || p.packSize ||
      p.toxicityClass || p.antidote || p.phi || p.dosage || p.notes || p.image ||
      (Array.isArray(p.units) && p.units.length));
    var body =
      '<form id="pf">' +
        '<div class="form-grid">' +
          '<div class="field full"><label>Product name *</label><input class="input" name="name" required autocomplete="off" value="' + h(p.name || "") + '" placeholder="e.g. Urea"></div>' +
          '<div class="field"><label>Brand</label><input class="input" name="brand" autocomplete="off" value="' + h(p.brand || "") + '" placeholder="e.g. IFFCO"></div>' +
          '<div class="field"><label>Category</label><input class="input" name="category" list="cat-list" autocomplete="off" value="' + h(p.category || "") + '" placeholder="e.g. Nitrogen">' +
            '<datalist id="cat-list">' + catList.map(function (c) { return '<option value="' + h(c) + '"></option>'; }).join("") + "</datalist></div>" +
          '<div class="field"><label>Type</label><select class="select" name="type">' + selOpts(TYPES, p.type || "Fertilizer") + "</select></div>" +
          '<div class="field"><label>Unit</label><select class="select" name="unit">' + unitOpts(p.unit) + "</select></div>" +
          '<div class="field"><label>Cost price</label><input class="input" type="number" step="0.01" min="0" inputmode="decimal" name="costPrice" value="' + (p.costPrice || "") + '" placeholder="0"></div>' +
          '<div class="field"><label>Selling price</label><input class="input" type="number" step="0.01" min="0" inputmode="decimal" name="sellPrice" value="' + (p.sellPrice || "") + '" placeholder="0"></div>' +
          '<div class="field"><label>Reorder level</label><input class="input" type="number" step="1" min="0" inputmode="numeric" name="reorderLevel" value="' + (p.reorderLevel || "") + '" placeholder="0"></div>' +
          '<div class="field pf-check"><label>&nbsp;</label><label class="checkbox"><input type="checkbox" name="active"' + (p.active !== false ? " checked" : "") + '> Active — sells at the counter</label></div>' +
        "</div>" +
        foldMarkup("pf-more", "local name, pack details, image, packs, opening stock", "form-grid") +
            '<div class="field full"><label>Local-language name <span class="muted" style="font-weight:400">(prints on bills)</span></label><input class="input" name="localName" value="' + h(p.localName || "") + '" placeholder="e.g. यूरिया / युरिया / యూరియా"></div>' +
            '<div class="field" data-grp="npk"><label>NPK / nutrient</label><input class="input" name="npk" value="' + h(p.npk || "") + '" placeholder="e.g. 46-0-0"></div>' +
            '<div class="field full" data-grp="crop" style="display:none"><div class="section-title" style="margin:0">Crop-protection details</div></div>' +
            '<div class="field" data-grp="crop" style="display:none"><label>Active ingredient</label><input class="input" name="activeIngredient" value="' + h(p.activeIngredient || "") + '" placeholder="e.g. Imidacloprid 17.8%"></div>' +
            '<div class="field" data-grp="crop" style="display:none"><label>Formulation</label><select class="select" name="formulation"><option value="">—</option>' + selOpts(FORMS, p.formulation || "") + "</select></div>" +
            '<div class="field" data-grp="crop" style="display:none"><label>Pack size</label><input class="input" name="packSize" value="' + h(p.packSize || "") + '" placeholder="e.g. 100 ml"></div>' +
            '<div class="field" data-grp="tox" style="display:none"><label>Toxicity class</label><select class="select" name="toxicityClass"><option value="">—</option>' + selOpts(TOX, p.toxicityClass || "") + "</select></div>" +
            '<div class="field" data-grp="crop" style="display:none"><label>Antidote</label><input class="input" name="antidote" value="' + h(p.antidote || "") + '" placeholder="e.g. Atropine sulphate"></div>' +
            '<div class="field" data-grp="crop" style="display:none"><label>Pre-harvest interval (PHI)</label><input class="input" name="phi" value="' + h(p.phi || "") + '" placeholder="e.g. 7 days"></div>' +
            '<div class="field full"><label>Dosage / usage <span class="muted" style="font-weight:400">(prints on bills)</span></label><input class="input" name="dosage" value="' + h(p.dosage || "") + '" placeholder="e.g. 2 ml per litre of water"></div>' +
            '<div class="field full"><label>Selling units / packs <span class="muted" style="font-weight:400">(optional)</span></label>' +
              '<div class="small muted" style="margin:-2px 0 8px">Stock stays in <strong id="pf-unit-base">' + h(p.unit || "unit") + '</strong>. Add one row per pack you sell: its name, how many of the base unit it holds, and its price.</div>' +
              '<div id="pf-units"></div>' +
              '<button class="btn btn-sm" type="button" id="pf-unit-add" style="margin-top:8px">+ Add pack / unit</button>' +
            "</div>" +
            '<div class="field full"><label>Product image</label>' +
              '<div class="img-picker">' +
                '<div class="img-preview" id="pf-img-preview"></div>' +
                '<div class="img-actions">' +
                  '<button class="btn btn-sm" type="button" id="pf-img-choose">' + ico("camera") + ' Choose image</button>' +
                  '<button class="btn btn-sm btn-danger" type="button" id="pf-img-remove" style="display:none">Remove</button>' +
                "</div>" +
                '<input type="file" id="pf-img-file" accept="image/*" style="display:none">' +
              "</div></div>" +
            (isNew ?
              '<div class="field full"><div class="section-title">Opening stock (optional)</div></div>' +
              '<div class="field"><label>Quantity</label><input class="input" type="number" step="0.001" min="0" inputmode="decimal" name="openQty" placeholder="0"></div>' +
              '<div class="field"><label>Unit cost</label><input class="input" type="number" step="0.01" min="0" inputmode="decimal" name="openCost" placeholder="same as cost"></div>' +
              '<div class="field"><label>Batch / lot no.</label><input class="input" name="openBatch" placeholder="e.g. UR-2401"></div>' +
              '<div class="field"><label>Mfg / pack date</label><input class="input" type="date" name="openMfg"></div>' +
              '<div class="field"><label>Expiry date</label><input class="input" type="date" name="openExpiry"></div>' : "") +
            '<div class="field full"><label>Notes</label><textarea class="textarea" name="notes">' + h(p.notes || "") + "</textarea></div>" +
          foldClose() +
      "</form>";

    modal({
      title: isNew ? "Add Product" : "Edit Product", icon: isNew ? "plus" : "edit",
      size: "wide", body: body, autofocus: false,
      footer: '<button class="btn" data-close>Cancel</button>' +
        (isNew ? '<button class="btn" id="pf-again">Save &amp; add another</button>' : "") +
        '<button class="btn btn-primary" id="pf-save">Save</button>',
      onMount: function (el, close) {
        var f0 = $("#pf", el);
        var more = $("#pf-more", el);
        var setMore = wireFold(more);
        setMore(hasExtra);
        enterWalk(f0, function () { $("#pf-save", el).click(); });
        function updateType() {
          var t = $('[name=type]', f0).value;
          var crop = CROP_TYPES.indexOf(t) >= 0;
          var tox = TOX_TYPES.indexOf(t) >= 0;
          $$('[data-grp="npk"]', f0).forEach(function (e) { e.style.display = (t === "Fertilizer") ? "" : "none"; });
          $$('[data-grp="crop"]', f0).forEach(function (e) { e.style.display = crop ? "" : "none"; });
          $$('[data-grp="tox"]', f0).forEach(function (e) { e.style.display = tox ? "" : "none"; });
          return crop || tox || t === "Fertilizer";
        }
        $('[name=type]', f0).addEventListener("change", function () {
          var relevant = updateType();
          if (relevant && more.getAttribute("aria-expanded") !== "true") setMore(true);
        });
        updateType();

        // Selling units / packs editor. Stock stays in the base unit; each pack
        // = name + how many base units it holds + its own retail price.
        var unitsEl = $("#pf-units", el);
        var unitBaseEl = $("#pf-unit-base", el);
        var unitRows = (Array.isArray(p.units) ? p.units : []).map(function (u) {
          return { id: u.id || U.uid("unit"), name: u.name || "", factor: u.factor, price: u.price };
        });
        function baseUnitName() { return $("[name=unit]", f0).value || "unit"; }
        function flushUnits() {
          $$("[data-ur]", unitsEl).forEach(function (rowEl, i) {
            if (!unitRows[i]) return;
            unitRows[i].name = rowEl.querySelector('[data-u="name"]').value;
            unitRows[i].factor = rowEl.querySelector('[data-u="factor"]').value;
            unitRows[i].price = rowEl.querySelector('[data-u="price"]').value;
          });
        }
        function renderUnits() {
          unitsEl.innerHTML = unitRows.map(function (u, i) {
            return '<div class="row" style="gap:6px;margin-bottom:6px" data-ur="' + i + '">' +
              '<input class="input" style="flex:2" data-u="name" value="' + h(String(u.name || "")) + '" placeholder="e.g. 250 ml bottle">' +
              '<input class="input" style="flex:1" type="number" step="0.001" min="0" data-u="factor" value="' + (u.factor != null ? u.factor : "") + '" placeholder="qty = ' + h(baseUnitName()) + '">' +
              '<input class="input" style="flex:1" type="number" step="0.01" min="0" data-u="price" value="' + (u.price != null ? u.price : "") + '" placeholder="price">' +
              '<button class="icon-btn" type="button" data-udel="' + i + '" title="Remove">' + ico("close") + '</button>' +
            "</div>";
          }).join("");
          $$("[data-udel]", unitsEl).forEach(function (b) {
            b.onclick = function () { flushUnits(); unitRows.splice(+b.dataset.udel, 1); renderUnits(); };
          });
        }
        function collectUnits() {
          flushUnits();
          var bad = false, out = [];
          unitRows.forEach(function (u) {
            var name = String(u.name || "").trim();
            if (!name) return;
            var factor = U.num(u.factor);
            if (!(factor > 0)) { bad = true; return; }
            out.push({ id: u.id, name: name, factor: factor, price: U.num(u.price) });
          });
          return bad ? null : out;
        }
        $("#pf-unit-add", el).onclick = function () {
          flushUnits();
          unitRows.push({ id: U.uid("unit"), name: "", factor: "", price: "" });
          renderUnits();
        };
        $("[name=unit]", f0).addEventListener("change", function () {
          unitBaseEl.textContent = baseUnitName();
          $$('[data-u="factor"]', unitsEl).forEach(function (inp) { inp.placeholder = "qty = " + baseUnitName(); });
        });
        renderUnits();

        var imgState = { removed: false, payload: null };
        var prevImg = $("#pf-img-preview", el);
        var imgFile = $("#pf-img-file", el);
        var imgChoose = $("#pf-img-choose", el);
        var imgRemove = $("#pf-img-remove", el);
        function currentThumb() {
          if (imgState.payload) return imgState.payload.thumb;
          if (imgState.removed) return "";
          return (p.image && p.image.thumb) || "";
        }
        function renderImg() {
          var src = U.safeImgSrc(currentThumb());
          prevImg.innerHTML = src ? '<img src="' + src + '" alt="">' : '<span class="img-empty">No image</span>';
          imgRemove.style.display = src ? "" : "none";
        }
        imgChoose.onclick = function () { imgFile.click(); };
        imgRemove.onclick = function () { imgState.payload = null; imgState.removed = true; renderImg(); };
        imgFile.onchange = function () {
          var f = imgFile.files && imgFile.files[0];
          if (!f) return;
          if (!/^image\//.test(f.type || "")) { toast("Please choose an image file", "error"); imgFile.value = ""; return; }
          if (f.size > 8 * 1024 * 1024) { toast("Image is too large (max 8 MB)", "error"); imgFile.value = ""; return; }
          Promise.all([U.readFileDataURL(f), U.imgThumb(f, 256)]).then(function (res) {
            imgState.payload = { name: f.name, type: f.type, size: f.size, dataUrl: res[0], thumb: res[1] };
            imgState.removed = false; renderImg();
          }).catch(function () { toast("Could not read that image", "error"); });
          imgFile.value = "";
        };
        renderImg();

        $("#pf-save", el).onclick = function () { save(false); };
        var againBtn = $("#pf-again", el);
        if (againBtn) againBtn.onclick = function () { save(true); };
        // The counter starts where the typing starts: a new product at its name, an
        // unpriced one at its rate.
        var first = (isNew || Number(p.sellPrice) > 0) ? $("[name=name]", f0) : $("[name=sellPrice]", f0);
        if (first) first.focus();

        function save(again) {
          var f = $("#pf", el), d = formData(f);
          if (!d.name || !d.name.trim()) { fieldError(f, "name", "Product name is required"); return; }
          var units = collectUnits();
          if (units === null) { setMore(true); toast("Each selling unit needs a quantity greater than 0", "error"); return; }
          var rec = {
            id: p.id, name: d.name.trim(), brand: d.brand.trim(), category: d.category.trim(),
            type: d.type, activeIngredient: (d.activeIngredient || "").trim(), formulation: d.formulation || "",
            packSize: (d.packSize || "").trim(), toxicityClass: d.toxicityClass || "",
            localName: (d.localName || "").trim(), antidote: (d.antidote || "").trim(), phi: (d.phi || "").trim(),
            npk: d.npk.trim(), unit: d.unit, costPrice: U.num(d.costPrice), sellPrice: U.num(d.sellPrice),
            reorderLevel: U.num(d.reorderLevel), active: !!d.active, notes: d.notes,
            dosage: (d.dosage || "").trim(), units: units,
            imagePayload: imgState.payload, imageRemoved: imgState.removed
          };
          var created = null;
          store.saveProduct(rec).then(function (saved) {
            created = saved;
            if (isNew && U.num(d.openQty) > 0) {
              return store.addStock(saved.id, {
                batchNo: d.openBatch, mfgDate: d.openMfg, expiryDate: d.openExpiry, quantity: U.num(d.openQty),
                unitCost: d.openCost === "" ? U.num(d.costPrice) : U.num(d.openCost), source: "opening", notes: "Opening stock"
              }).then(function () { return saved; });
            }
            return saved;
          }).then(function () {
            // The next product usually comes from the same supplier list: keep the
            // kind of thing it is, clear what is different.
            if (isNew) state.prodFormPick = { category: rec.category, type: rec.type, unit: rec.unit, reorderLevel: rec.reorderLevel };
            return refresh();
          }).then(function () {
            toast(isNew ? (again ? "Product added — enter the next one" : "Product added") : "Product updated");
            close();
            // A screen that opened this form to add a product while it is being
            // filled (a purchase row) takes the new record back; otherwise the
            // counter stays in the form and enters the next one.
            if (opts && opts.onSaved) opts.onSaved(created);
            else if (isNew && again) openProductModal(null);
          }).catch(function (e) { toast(e.message || "Save failed", "error"); });
        }
      }
    });
  }

  function openStockModal(productId, preset) {
    var p = state.pmap[productId] || {};
    preset = preset || {};
    var body =
      '<form id="sf"><div class="small muted" style="margin-bottom:12px">Add stock for <strong>' + h(p.name) + "</strong> (" + h(p.unit || "") + ")</div>" +
      '<div class="form-grid">' +
        '<div class="field"><label>Quantity *</label><input class="input" type="number" step="0.001" min="0" name="quantity" value="' + (preset.quantity || "") + '" required></div>' +
        '<div class="field"><label>Unit cost</label><input class="input" type="number" step="0.01" min="0" name="unitCost" value="' + (preset.unitCost != null ? preset.unitCost : (p.costPrice || 0)) + '"></div>' +
        '<div class="field"><label>Batch / lot no.</label><input class="input" name="batchNo" value="' + h(preset.batchNo || "") + '"></div>' +
        '<div class="field"><label>Mfg / pack date</label><input class="input" type="date" name="mfgDate" value="' + h(preset.mfgDate || "") + '"></div>' +
        '<div class="field"><label>Expiry date</label><input class="input" type="date" name="expiryDate" value="' + h(preset.expiryDate || "") + '"></div>' +
        '<div class="field full"><label>Notes</label><input class="input" name="notes" value="' + h(preset.notes || "") + '" placeholder="e.g. manual correction"></div>' +
      "</div></form>";
    modal({
      title: "Add Stock", body: body,
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="sf-save">Add Stock</button>',
      onMount: function (el, close) {
        $("#sf-save", el).onclick = function () {
          var d = formData($("#sf", el));
          if (!(U.num(d.quantity) > 0)) { toast("Enter a quantity greater than 0", "error"); return; }
          store.addStock(productId, {
            quantity: U.num(d.quantity), unitCost: U.num(d.unitCost), batchNo: d.batchNo,
            mfgDate: d.mfgDate, expiryDate: d.expiryDate, notes: d.notes, source: preset.source || "manual"
          }).then(function () { close(); return refresh(); }).then(function () { toast("Stock added"); })
            .catch(function (e) { toast(e.message, "error"); });
        };
      }
    });
  }

  function openProductDetail(productId) {
    function draw() {
      var p = state.pmap[productId];
      if (!p) { return; }
      var batches = state.batches.filter(function (b) { return b.productId === productId; }).sort(store.fifoCompare);
      var total = U.roundQty(batches.reduce(function (s, b) { return s + Number(b.quantity || 0); }, 0));
      var val = U.roundMoney(batches.reduce(function (s, b) { return s + Number(b.quantity || 0) * Number(b.unitCost || 0); }, 0));
      var rows = batches.length ? batches.map(function (b) {
        return "<tr><td>" + h(b.batchNo || "—") + (b.mfgDate ? '<div class="small muted">mfg ' + h(U.fmtDate(b.mfgDate)) + "</div>" : "") + "</td><td>" + expiryBadge(b.expiryDate) + "</td>" +
          '<td class="num">' + U.qty(b.quantity) + "</td><td class='num'>" + U.money(b.unitCost) + "</td>" +
          "<td><span class='badge gray'>" + h(b.source || "manual") + "</span></td>" +
          '<td><div class="actions"><button class="btn btn-sm" data-bedit="' + b.id + '">Edit</button>' +
          '<button class="btn btn-sm btn-danger" data-bdel="' + b.id + '">Del</button></div></td></tr>';
      }).join("") : emptyRow(6, "box", "No stock batches yet", "Use Add Stock to record what you bought and when it expires.");

      var body =
        (function () {
          var thumbSrc = U.safeImgSrc(p.image && p.image.thumb);
          return thumbSrc
            ? '<div class="prod-hero"><img src="' + thumbSrc + '" alt="' + h(p.name) + '">' +
              (p.image && p.image.id ? '<div><button class="btn btn-sm" id="d-imgfull">View full image</button></div>' : "") + "</div>"
            : '<div class="prod-hero"><div class="img-preview none"><span class="img-empty">No image</span></div></div>';
        })() +
        '<div class="kv">' +
          kv("Type", p.type || "Fertilizer") + kv("Brand", p.brand || "—") + kv("Category", p.category || "—") +
          (p.localName ? kv("Local name", p.localName) : "") +
          (p.type === "Fertilizer" ? kv("NPK", p.npk || "—") : "") +
          (p.activeIngredient ? kv("Active ingredient", p.activeIngredient) : "") +
          (p.formulation ? kv("Formulation", p.formulation) : "") +
          (p.packSize ? kv("Pack size", p.packSize) : "") +
          (p.toxicityClass ? kvHtml("Toxicity", '<span class="tox ' + (U.toxicityColor(p.toxicityClass) || "none") + '">' + ico("alert") + "</span> " + h(p.toxicityClass)) : "") +
          (p.antidote ? kv("Antidote", p.antidote) : "") +
          (p.phi ? kv("Pre-harvest interval", p.phi) : "") +
          kv("Unit", p.unit || "—") + kv("Cost / Sell", U.money(p.costPrice) + " / " + U.money(p.sellPrice)) +
          (p.priceSource === "sample" ? kvHtml("Rate source", '<span class="badge gray">sample rate</span> <span class="small muted">demo value, not a real price · confirm before billing</span>') : "") +
          (function () {
            var us = (Array.isArray(p.units) ? p.units : []).filter(function (u) { return u && String(u.name || "").trim(); });
            if (!us.length) return "";
            return kvHtml("Sells as", us.map(function (u) { return h(u.name) + " · " + U.money(u.price || 0); }).join("<br>"));
          })() +
          kv("In stock", U.qty(total) + " " + (p.unit || "")) + kv("Stock value", U.money(val)) +
          kv("Reorder level", U.qty(p.reorderLevel || 0)) + kvHtml("Status", statusBadge(total, Number(p.reorderLevel) || 0)) +
          (p.dosage ? kv("Dosage / usage", p.dosage) : "") +
          (p.notes ? kv("Notes", p.notes) : "") +
        "</div>" +
        '<div class="mt spread"><div class="section-title" style="margin:0">Stock batches</div>' +
          '<button class="btn btn-sm btn-primary" id="d-addstock">+ Add Stock</button></div>' +
        '<div class="table-wrap mt-sm"><table class="data"><thead><tr><th>Batch</th><th>Expiry</th><th class="num">Qty</th><th class="num">Unit cost</th><th>Source</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
        '<div class="mt spread"><div class="section-title" style="margin:0">Stock history</div>' +
          '<button class="btn btn-sm" id="d-hist">Full history</button></div>' +
        '<div id="d-hist-rows" class="mt-sm"><div class="small muted">Loading…</div></div>';

      modal({
        title: p.name, size: "wide", body: body,
        footer: '<button class="btn" data-close>Close</button><button class="btn" id="d-edit">Edit Product</button><button class="btn btn-danger" id="d-del">Delete</button>',
        onMount: function (el, close) {
          $("#d-addstock", el).onclick = function () { close(); openStockModal(productId); };
          $("#d-edit", el).onclick = function () { close(); openProductModal(state.pmap[productId]); };
          $("#d-del", el).onclick = function () { close(); delProduct(productId); };
          $("#d-hist", el).onclick = function () { close(); state.stockHist = state.stockHist || {}; state.stockHist.product = productId; ui.setView("stockhist"); };
          var fullBtn = $("#d-imgfull", el);
          if (fullBtn) fullBtn.onclick = function () {
            db.get("files", p.image.id).then(function (fo) {
              var src = U.safeImgSrc(fo && fo.dataUrl);
              if (!src) { toast("Image file not found", "error"); return; }
              modal({ title: p.name, size: "wide", body: '<div class="img-lightbox"><img src="' + src + '" alt=""></div>', footer: '<button class="btn" data-close>Close</button>' });
            }).catch(function () { toast("Could not open image", "error"); });
          };
          store.listMovements(productId).then(function (ms) {
            var box = $("#d-hist-rows", el); if (!box) return;
            box.innerHTML = ms.length
              ? movementTable(ms.slice(0, 8), false)
              : '<div class="small muted">No movements yet — history is recorded from today onwards.</div>';
          }).catch(function () {
            var box = $("#d-hist-rows", el); if (!box) return;
            box.innerHTML = '<div class="small muted">Could not load the stock history for this product.</div>';
          });
          $$("[data-bedit]", el).forEach(function (b) { b.onclick = function () { editBatch(b.dataset.bedit, productId, close); }; });
          $$("[data-bdel]", el).forEach(function (b) { b.onclick = function () { delBatch(b.dataset.bdel, close); }; });
        }
      });
    }
    draw();
  }

  function editBatch(batchId, productId, closeParent) {
    var b = state.batches.filter(function (x) { return x.id === batchId; })[0];
    if (!b) return;
    var body = '<form id="bf"><div class="form-grid">' +
      '<div class="field"><label>Batch / lot no.</label><input class="input" name="batchNo" value="' + h(b.batchNo || "") + '"></div>' +
      '<div class="field"><label>Mfg / pack date</label><input class="input" type="date" name="mfgDate" value="' + h(b.mfgDate || "") + '"></div>' +
      '<div class="field"><label>Expiry date</label><input class="input" type="date" name="expiryDate" value="' + h(b.expiryDate || "") + '"></div>' +
      '<div class="field"><label>Quantity</label><input class="input" type="number" step="0.001" min="0" name="quantity" value="' + (Number(b.quantity) || 0) + '"></div>' +
      '<div class="field"><label>Unit cost</label><input class="input" type="number" step="0.01" min="0" name="unitCost" value="' + (Number(b.unitCost) || 0) + '"></div>' +
      '<div class="field full"><label>Notes</label><input class="input" name="notes" value="' + h(b.notes || "") + '"></div>' +
      "</div></form>";
    modal({
      title: "Edit Batch", body: body,
      footer: '<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="bf-save">Save</button>',
      onMount: function (el, close) {
        $("#bf-save", el).onclick = function () {
          var d = formData($("#bf", el));
          b.batchNo = d.batchNo; b.mfgDate = d.mfgDate; b.expiryDate = d.expiryDate; b.notes = d.notes;
          b.quantity = U.roundQty(U.num(d.quantity)); b.unitCost = U.roundMoney(U.num(d.unitCost));
          b.originalQuantity = U.roundQty(Math.max(Number(b.originalQuantity) || 0, b.quantity));
          store.saveBatch(b).then(function () { close(); if (closeParent) closeParent(); return refresh(); })
            .then(function () { toast("Batch updated"); openProductDetail(productId); })
            .catch(function (e) { toast(e.message, "error"); });
        };
      }
    });
  }

  function delBatch(batchId, closeParent) {
    confirm({ title: "Delete batch?", danger: true, okText: "Delete", message: "Remove this stock batch? This cannot be undone." })
      .then(function (yes) {
        if (!yes) return;
        store.deleteBatch(batchId).then(function () { if (closeParent) closeParent(); return refresh(); })
          .then(function () { toast("Batch deleted"); })
          .catch(function (e) { toast(e.message || "Delete failed", "error"); });
      });
  }


  /* =========================== Rate card (price list) =========================== */
  function rateCardGroups() {
    var g = {};
    (state.products || []).forEach(function (p) {
      if (p.active === false) return;
      var c = p.category || "Other";
      (g[c] = g[c] || []).push(p);
    });
    return Object.keys(g).sort().map(function (c) {
      var items = g[c].slice().sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
      return { category: c, items: items };
    });
  }

  function openRateCard() {
    var groups = rateCardGroups();
    if (!groups.length) { toast("No active products to list", "warn"); return; }
    var body = groups.map(function (g) {
      return '<div class="section-title mt">' + h(g.category) + "</div>" +
        '<div class="table-wrap"><table class="data"><thead><tr><th>Product</th><th>Unit</th><th class="num">Price</th></tr></thead><tbody>' +
        g.items.map(function (p) {
          return "<tr><td>" + h(p.name) + (p.brand ? '<div class="small muted">' + h(p.brand) + "</div>" : "") + "</td>" +
            "<td>" + h(p.unit || "") + '</td><td class="num"><strong>' + U.money(p.sellPrice || 0) + "</strong></td></tr>";
        }).join("") + "</tbody></table></div>";
    }).join("");
    var sampleCount = state.products.filter(function (p) { return p.priceSource === "sample"; }).length;
    modal({
      title: "Rate card", icon: "tag", hue: "info", size: "wide",
      body: '<div class="small muted" style="margin-bottom:10px">' + state.products.filter(function (p) { return p.active !== false; }).length +
        " active product(s) · " + groups.length + " category(ies) · prices include tax as set per product" +
        (sampleCount ? '<div class="small" style="margin-top:4px">' + ico("alert") + " " + sampleCount + " price(s) are sample values, not real rates — check them against your own rates before you bill.</div>" : "") + "</div>" + body,
      footer: '<button class="btn" data-close>Close</button><button class="btn btn-primary" id="rc-print">' + ico("print") + ' Export PDF</button>',
      onMount: function (el, close) {
        $("#rc-print", el).onclick = function () { close(); printRateCard(groups); };
      }
    });
  }

  function printRateCard(groups) {
    var blocks = groups.map(function (g) {
      return { caption: g.category, columns: ["Product", "Brand", "Unit", "Price"], numCols: [3], rows: g.items.map(function (p) { return [p.name, p.brand || "", p.unit || "", U.money(p.sellPrice || 0)]; }) };
    });
    var rcSamp = state.products.filter(function (p) { return p.priceSource === "sample"; }).length;
    H.printDoc({ title: "Rate Card", subtitle: "Price list · " + state.products.filter(function (p) { return p.active !== false; }).length + " product(s)", blocks: blocks, footer: "Prices subject to change without notice." + (rcSamp ? " " + rcSamp + " of these price(s) are sample values, not real rates — verify before billing." : "") });
  }
  Object.assign(FS.ui._shared, {
    openProductModal: openProductModal, openStockModal: openStockModal, openProductDetail: openProductDetail });
})(window.FS);
