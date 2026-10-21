/* =========================================================
   store.js — domain / business logic on top of db
   Attaches to window.FS.store
   ========================================================= */
(function (FS) {
  "use strict";
  var U = FS.util, db = FS.db;

  /* ---- Deletions are marks, not erasures -------------------------------------
     A row that is physically gone stays gone even if an old backup that still
     holds it is imported later. So business records carry `deletedAt`, and every
     read path hides them. Backup keeps the marks for the same reason. Files are
     the exception — nothing points at a deleted file, and their data URLs are most
     of the database's weight. */
  function tomb(rec, extra) {
    var now = U.nowISO();
    return Object.assign({}, rec, extra || {}, { deletedAt: now, updatedAt: now });
  }
  function live(rows) {
    return (rows || []).filter(function (r) { return r && !r.deletedAt; });
  }
  function alive(rec) { return rec && !rec.deletedAt ? rec : undefined; }

  /* ---- Bill numbers that cannot collide --------------------------------------
     Each install carries a 3-character tag, so numbers read INV-0042-GAR and two
     installs can never hand out the same one — which matters the moment a backup
     from one is imported into another. Counters are reseeded from the highest
     number on disk, so an import continues above that backup's last bill. */
  function deviceTag() {
    return db.getMeta("deviceTag").then(function (t) {
      if (t) return t;
      var abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", s = "", i;
      for (i = 0; i < 3; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
      return db.setMeta("deviceTag", s).then(function () { return s; });
    });
  }

  function billSeq(invoiceNo) {
    var m = /-(\d+)(?:-[A-Za-z0-9]{2,4})?$/.exec(invoiceNo || "");
    return m ? Number(m[1]) : 0;
  }

  var countersSeeded = false;
  function ensureCountersSeeded() {
    if (countersSeeded) return Promise.resolve();
    return Promise.all([db.getAll("sales"), db.getAll("purchases"), db.getMeta("counters")]).then(function (r) {
      var c = r[2] || {}, maxS = 0, maxP = 0, changed = false;
      (r[0] || []).forEach(function (s) { maxS = Math.max(maxS, billSeq(s.invoiceNo)); });
      (r[1] || []).forEach(function (p) { maxP = Math.max(maxP, billSeq(p.invoiceNo)); });
      if (maxS > (Number(c.sale) || 0)) { c.sale = maxS; changed = true; }
      if (maxP > (Number(c.purchase) || 0)) { c.purchase = maxP; changed = true; }
      countersSeeded = true;
      return changed ? db.setMeta("counters", c) : null;
    });
  }

  function nextBillNo(kind, prefix) {
    return ensureCountersSeeded().then(function () {
      return deviceTag().then(function (tag) {
        return db.nextCounter(kind).then(function (n) {
          return prefix + "-" + pad(n, 4) + "-" + tag;
        });
      });
    });
  }

  /* ============================ Products ============================ */

  function listProducts() {
    return db.getAll("products").then(function (rows) {
      rows = live(rows);
      rows.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
      return rows;
    });
  }
  function getProduct(id) { return db.get("products", id).then(alive); }

  function saveProduct(data) {
    var now = U.nowISO();
    data = Object.assign({}, data);
    // Saving from the product form is the owner speaking, so retire the demo-rate
    // mark; otherwise the load-time fill would treat the new price as its own and
    // overwrite it on the next start.
    if (Object.prototype.hasOwnProperty.call(data, "sellPrice")) data.priceSource = "";
    // Image handling: imagePayload = {name,type,size,dataUrl,thumb} when a new
    // picture was chosen; imageRemoved = true when the picture was cleared.
    var imagePayload = data.imagePayload;
    var imageRemoved = !!data.imageRemoved;
    delete data.imagePayload; delete data.imageRemoved;

    function finalize(product) {
      var ops = [], prev = product.image;
      if (imagePayload && imagePayload.dataUrl) {
        var fid = U.uid("file");
        ops.push({ store: "files", op: "put", value: {
          id: fid, name: imagePayload.name || "image", type: imagePayload.type || "",
          size: imagePayload.size || 0, dataUrl: imagePayload.dataUrl, createdAt: now
        } });
        product.image = { id: fid, name: imagePayload.name || "image", type: imagePayload.type || "", size: imagePayload.size || 0, thumb: imagePayload.thumb || "" };
        if (prev && prev.id && prev.id !== fid) ops.push({ store: "files", op: "delete", value: prev.id });
      } else if (imageRemoved && prev && prev.id) {
        ops.push({ store: "files", op: "delete", value: prev.id });
        delete product.image;
      }
      ops.push({ store: "products", op: "put", value: product });
      return db.batchWrite(ops).then(function () { return product; });
    }

    if (data.id) {
      return getProduct(data.id).then(function (existing) {
        var p = Object.assign({}, existing, data, { updatedAt: now });
        return finalize(p);
      });
    }
    var p = Object.assign({
      id: U.uid("prd"), name: "", brand: "", category: "", npk: "", unit: "bag",
      type: "Fertilizer", activeIngredient: "", formulation: "", packSize: "", toxicityClass: "",
      localName: "", antidote: "", phi: "",
      costPrice: 0, sellPrice: 0, reorderLevel: 0, trackBatch: true, trackExpiry: true,
      units: [], dosage: "", notes: "", active: true, createdAt: now, updatedAt: now
    }, data, { id: U.uid("prd") });
    return finalize(p);
  }

  function deleteProduct(id) {
    // Mark the product and its batches, and write its remaining stock off in the
    // ledger so the disappearance is explained rather than vanished. Deletion is
    // allowed even if it has been sold/purchased; the UI handles the warning.
    return Promise.all([db.byIndex("batches", "by_product", id), getProduct(id)]).then(function (res) {
      var batches = live(res[0]), p = res[1];
      if (!p) return null;
      var ops = [{ store: "products", op: "put", value: tomb(p) }];
      batches.forEach(function (b) {
        var q = U.roundQty(Number(b.quantity) || 0);
        if (q > 0) putMov(ops, mov({
          productId: b.productId, qty: -q, reason: "Product deleted",
          ref: p.name || "", refId: id, batchId: b.id, batchNo: b.batchNo
        }));
        ops.push({ store: "batches", op: "put", value: tomb(b, { quantity: 0 }) });
      });
      if (p.image && p.image.id) ops.push({ store: "files", op: "delete", value: p.image.id });
      return db.batchWrite(ops);
    });
  }

  // Selling units ("packs") for a product. Stock is ALWAYS counted in the
  // product's base `unit` (that is what purchases/batches use); each pack is a
  // multiple of the base with its own retail price. A product with no custom
  // packs sells in a single implicit base unit, so legacy products are unaffected.
  function effectiveUnits(p) {
    var base = { id: "__base", name: (p && p.unit) || "unit", factor: 1, price: U.roundMoney(U.num(p && p.sellPrice)) };
    var list = (p && Array.isArray(p.units) ? p.units : [])
      .filter(function (u) { return u && String(u.name || "").trim(); })
      .map(function (u) {
        return {
          id: u.id || ("u:" + String(u.name).trim().toLowerCase()),
          name: String(u.name).trim(),
          factor: U.num(u.factor) > 0 ? U.num(u.factor) : 1,
          price: U.roundMoney(U.num(u.price))
        };
      });
    return list.length ? list : [base];
  }

  /* ============================ Batches / Stock ============================ */

  function saveBatch(b) {
    return db.get("batches", b.id).then(function (old) {
      return db.put("batches", Object.assign({}, b, { updatedAt: U.nowISO() })).then(function () {
        if (!old) return;
        var d = U.roundQty(U.roundQty(Number(b.quantity) || 0) - U.roundQty(Number(old.quantity) || 0));
        if (d) return db.put("movements", mov({
          productId: b.productId, qty: d, reason: "Adjustment",
          batchId: b.id, batchNo: b.batchNo || old.batchNo
        }));
      });
    });
  }
  function deleteBatch(id) {
    return db.get("batches", id).then(function (b) {
      if (!b || b.deletedAt) return null;
      var q = U.roundQty(Number(b.quantity) || 0), ops = [];
      // The write-off and the mark go in one transaction: a batch must never read
      // as deleted while its stock is still counted, or vice versa.
      if (q > 0) putMov(ops, mov({
        productId: b.productId, qty: -q, reason: "Batch deleted",
        batchId: b.id, batchNo: b.batchNo
      }));
      ops.push({ store: "batches", op: "put", value: tomb(b, { quantity: 0 }) });
      return db.batchWrite(ops);
    });
  }

  // FIFO order: soonest expiry first (no expiry last), then earliest received
  function fifoCompare(a, b) {
    var ae = a.expiryDate ? Date.parse(a.expiryDate) : Infinity;
    var be = b.expiryDate ? Date.parse(b.expiryDate) : Infinity;
    if (ae !== be) return ae - be;
    var ar = a.receivedAt ? Date.parse(a.receivedAt) : 0;
    var br = b.receivedAt ? Date.parse(b.receivedAt) : 0;
    return ar - br;
  }

  // Build a productId -> stock map from all batches
  function stockMap(batches) {
    var m = {};
    (batches || []).forEach(function (b) {
      m[b.productId] = U.roundQty((m[b.productId] || 0) + (Number(b.quantity) || 0));
    });
    return m;
  }

  function stockValuation(productId, batches) {
    var list = (batches || []).filter(function (b) { return b.productId === productId; });
    return U.roundMoney(list.reduce(function (s, b) { return s + (Number(b.quantity) || 0) * (Number(b.unitCost) || 0); }, 0));
  }

  /* ---- Stock is derived, not stored ------------------------------------------
     `batch.quantity` is a cache. The ledger is the truth: every movement names the
     batch it moved stock in or out of, so a batch's quantity is the sum of its
     signed movements. So a quantity can always be recomputed from its own history
     instead of being a stored number that quietly drifts out of true. */
  function ledgerByBatch(movements) {
    var m = {};
    (movements || []).forEach(function (mv) {
      if (!mv || !mv.batchId) return;
      m[mv.batchId] = U.roundQty((m[mv.batchId] || 0) + (Number(mv.qty) || 0));
    });
    return m;
  }

  // Batches whose cached quantity disagrees with the ledger.
  function stockDrift(batches, movements) {
    var led = ledgerByBatch(movements), out = [];
    (batches || []).forEach(function (b) {
      var cached = U.roundQty(Number(b.quantity) || 0);
      var derived = U.roundQty(led[b.id] || 0);
      if (cached !== derived) {
        out.push({
          batchId: b.id, productId: b.productId, batchNo: b.batchNo || "",
          cached: cached, derived: derived, delta: U.roundQty(cached - derived)
        });
      }
    });
    return out;
  }

  /* Repair by anchoring, never by overwriting: a batch whose quantity the ledger
     cannot explain (it predates per-batch movements) gets one "Opening balance"
     row for the difference. The shelf keeps showing what it showed before, and
     from then on the ledger fully accounts for it. */
  function checkStock(repair) {
    return Promise.all([db.getAll("batches"), db.getAll("movements")]).then(function (r) {
      var drift = stockDrift(r[0], r[1]);
      if (!repair || !drift.length) return drift;
      var ops = drift.map(function (d) {
        return { store: "movements", op: "put", value: mov({
          productId: d.productId, qty: d.delta, reason: "Opening balance",
          batchId: d.batchId, batchNo: d.batchNo
        }) };
      });
      return db.batchWrite(ops).then(function () { return drift; });
    });
  }

  /* ---- Schema 5 migration ----------------------------------------------------
     Idempotent and runs on every boot until the flag is set. It does three things
     the stock ledger depends on: every record gains an updatedAt, every batch's
     quantity gets an opening-balance row so the ledger explains the whole shelf,
     and bill counters are seeded above whatever is already on disk. If the ledger
     still cannot explain the shelf afterwards, the app refuses to start rather
     than show stock it cannot account for. */
  function migrateToV5() {
    return db.getMeta("schema").then(function (v) {
      if (Number(v) >= 5) return null;
      var stores = ["products", "batches", "suppliers", "purchases", "sales", "customers"];
      return Promise.all(stores.map(function (s) { return db.getAll(s); })).then(function (rows) {
        var ops = [], now = U.nowISO();
        rows.forEach(function (list, i) {
          (list || []).forEach(function (r) {
            if (r && !r.updatedAt) {
              ops.push({ store: stores[i], op: "put", value: Object.assign({}, r, { updatedAt: r.createdAt || r.receivedAt || now }) });
            }
          });
        });
        var write = ops.length ? db.batchWrite(ops) : Promise.resolve();
        return write.then(function () {
          countersSeeded = false;
          return ensureCountersSeeded();
        }).then(function () {
          return checkStock(true);
        }).then(function () {
          return checkStock(false);
        }).then(function (drift) {
          if (drift.length) {
            throw new Error("Stock ledger could not be reconciled for " + drift.length + " batch(es). No data was changed — restore a backup before using this device.");
          }
          return db.setMeta("schema", 5);
        });
      });
    });
  }

  /* One-time, after the ledger is anchored: the app used to invent a demo rate and
     a demo batch for a product that had neither. Those numbers are not the shop's,
     so they come out — the marked price goes blank and the marked quantity is
     written off with its own ledger row instead of being deleted, because a sale may
     already have drawn from that batch and the ledger has to keep explaining the
     shelf. Anything the shop typed over is not marked and is never touched. */
  function clearDemoValues() {
    return db.getMeta("demoValuesCleared").then(function (done) {
      if (done) return null;
      return Promise.all([db.getAll("products"), db.getAll("batches"), db.getAll("movements")]).then(function (r) {
        var now = U.nowISO(), led = ledgerByBatch(r[2]), ops = [], rates = 0, batches = 0;
        (r[0] || []).forEach(function (p) {
          if (p.priceSource !== "sample") return;
          rates++;
          ops.push({ store: "products", op: "put", value: Object.assign({}, p, { sellPrice: 0, priceSource: "", updatedAt: now }) });
        });
        (r[1] || []).forEach(function (b) {
          if (b.source !== "sample" || b.deletedAt) return;
          var onHand = U.roundQty(led[b.id] || 0);
          if (onHand > 0) {
            batches++;
            ops.push({ store: "movements", op: "put", value: mov({
              productId: b.productId, qty: -onHand, reason: "Demo stock removed",
              ref: "Removed demo quantity", refId: b.id, batchId: b.id, batchNo: b.batchNo
            }) });
          }
          if (U.roundQty(Number(b.quantity) || 0) !== 0) {
            ops.push({ store: "batches", op: "put", value: Object.assign({}, b, { quantity: 0, updatedAt: now }) });
          }
        });
        var write = ops.length ? db.batchWrite(ops) : Promise.resolve();
        return write.then(function () {
          return db.setMeta("demoValuesCleared", now);
        }).then(function () { return { rates: rates, batches: batches }; });
      });
    });
  }

  function addStock(productId, opts) {
    opts = opts || {};
    var now = U.nowISO();
    var b = {
      id: U.uid("bat"), productId: productId,
      batchNo: opts.batchNo || "", expiryDate: opts.expiryDate || "",
      mfgDate: opts.mfgDate || "",
      quantity: U.roundQty(opts.quantity || 0), originalQuantity: U.roundQty(opts.quantity || 0),
      unitCost: U.roundMoney(opts.unitCost || 0),
      source: opts.source || "manual", purchaseId: opts.purchaseId || null,
      receivedAt: now, updatedAt: now, notes: opts.notes || ""
    };
    return db.batchWrite([
      { store: "batches", op: "put", value: b },
      { store: "movements", op: "put", value: mov({
          productId: productId, qty: b.quantity, reason: opts.reason || "Manual add",
          ref: opts.ref || "", refId: b.id, batchId: b.id, batchNo: b.batchNo
        }) }
    ]).then(function () { return b; });
  }

  // Stock-movement ledger entry (signed qty: + in, − out). batchId and refId make every
  // delta attributable to one batch and one cause record, which is what lets quantity be
  // re-derived from the ledger at any time. ref stays as display text.
  function mov(o) {
    return {
      id: U.uid("mov"), ts: U.nowISO(), date: U.todayISO(),
      productId: o.productId, qty: U.roundQty(o.qty),
      reason: o.reason || "", ref: o.ref || "", refId: o.refId || "",
      batchId: o.batchId || "", batchNo: o.batchNo || ""
    };
  }
  function putMov(ops, m) { ops.push({ store: "movements", op: "put", value: m }); }

  // Live batches only. The frontend reads stock through this rather than the raw
  // store, so a deleted batch cannot leak back onto the shelf.
  function listBatches() { return db.getAll("batches").then(live); }

  function listMovements(productId) {
    return db.getAll("movements").then(function (rows) {
      if (productId) rows = rows.filter(function (m) { return m.productId === productId; });
      rows.sort(function (a, b) { return (b.ts || "").localeCompare(a.ts || ""); });
      return rows;
    });
  }

  // Consume qty from a product's batches using FIFO. Returns consumptions[].
  // Throws if insufficient stock.
  function consumeStock(productId, needQty, availableBatches) {
    needQty = U.roundQty(needQty);
    var pool = (availableBatches || []).filter(function (b) {
      return b.productId === productId && Number(b.quantity) > 0;
    }).slice().sort(fifoCompare);

    var have = pool.reduce(function (s, b) { return s + Number(b.quantity); }, 0);
    if (U.roundQty(have) < needQty) {
      var e = new Error("Insufficient stock (" + U.qty(have) + " available)");
      e.code = "INSUFFICIENT_STOCK";
      throw e;
    }

    var remaining = needQty, consumptions = [], updates = [];
    for (var i = 0; i < pool.length && remaining > 0.0009; i++) {
      var b = pool[i];
      var take = Math.min(Number(b.quantity), remaining);
      take = U.roundQty(take);
      b.quantity = U.roundQty(Number(b.quantity) - take);
      remaining = U.roundQty(remaining - take);
      consumptions.push({
        batchId: b.id, batchNo: b.batchNo || "", expiryDate: b.expiryDate || "",
        unitCost: Number(b.unitCost) || 0, qty: take
      });
      updates.push(b);
    }
    return { consumptions: consumptions, updatedBatches: updates };
  }

  /* ============================ Alerts ============================ */

  /* Product ids that have a batch record — i.e. the shop has bought the pack at
     least once. A never-bought catalogue entry sitting at zero is "not stocked",
     not "low", and must not be reported as needing a reorder. */
  function stockedSet(batches) {
    var m = {};
    (batches || []).forEach(function (b) { m[b.productId] = 1; });
    return m;
  }

  function lowStock(products, smap, stocked) {
    var seen = stocked || {};
    return (products || []).filter(function (p) {
      if (p.active === false) return false;
      var s = smap[p.id] || 0;
      var r = Number(p.reorderLevel) || 0;
      return r > 0 ? s <= r : (!seen[p.id] ? false : s <= 0);
    });
  }

  // Low-stock items turned into an actionable order: suggested qty tops stock
  // back up to twice the reorder level; estCost prices that order at cost.
  function reorderList(products, smap, stocked) {
    return lowStock(products, smap, stocked).map(function (p) {
      var stock = smap[p.id] || 0;
      var reorder = Number(p.reorderLevel) || 0;
      var suggest = Math.max(reorder * 2 - stock, 1);
      return {
        id: p.id, name: p.name, unit: p.unit || "",
        stock: stock, reorder: reorder, suggest: suggest,
        costPrice: Number(p.costPrice) || 0,
        estCost: U.roundMoney(suggest * (Number(p.costPrice) || 0)),
        out: stock <= 0
      };
    }).sort(function (a, b) {
      if (a.out !== b.out) return a.out ? -1 : 1;
      return (a.stock - a.reorder) - (b.stock - b.reorder);
    });
  }

  function expiringSoon(batches, days) {
    days = days == null ? 60 : days;
    return (batches || []).filter(function (b) {
      if (!b.expiryDate || Number(b.quantity) <= 0) return false;
      var d = U.daysUntil(b.expiryDate);
      return d != null && d <= days;
    }).sort(function (a, b) { return U.daysUntil(a.expiryDate) - U.daysUntil(b.expiryDate); });
  }

  /* ============================ Suppliers ============================ */

  function listSuppliers() {
    return db.getAll("suppliers").then(function (rows) {
      rows = live(rows);
      rows.sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
      return rows;
    });
  }
  function getSupplier(id) { return db.get("suppliers", id).then(alive); }
  function saveSupplier(data) {
    var now = U.nowISO();
    if (data.id) {
      return getSupplier(data.id).then(function (ex) {
        return db.put("suppliers", Object.assign({}, ex, data, { updatedAt: now }));
      });
    }
    var s = Object.assign({ id: U.uid("sup"), name: "", phone: "", email: "", address: "", notes: "", createdAt: now }, data, { updatedAt: now });
    s.id = s.id || U.uid("sup");
    return db.put("suppliers", s);
  }
  function deleteSupplier(id) {
    return getSupplier(id).then(function (s) {
      if (!s) return null;
      return db.put("suppliers", tomb(s));
    });
  }

  /* ============================ Purchases ============================ */

  function listPurchases() {
    return db.getAll("purchases").then(function (rows) {
      rows = live(rows);
      rows.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
      return rows;
    });
  }
  function getPurchase(id) { return db.get("purchases", id).then(alive); }

  // items: [{productId, batchNo, mfgDate, expiryDate, quantity, unitCost}]
  function createPurchase(payload) {
    var items = (payload.items || []).filter(function (it) { return Number(it.quantity) > 0; });
    if (!items.length) return Promise.reject(new Error("Add at least one item with quantity."));

    var prefix = payload.prefix || "PUR";
    return nextBillNo("purchase", prefix).then(function (no) {
      var pid = U.uid("pur");
      var date = payload.date || U.todayISO();
      var batches = [];
      var total = 0;
      items.forEach(function (it) {
        var q = U.roundQty(it.quantity);
        var cost = U.roundMoney(it.unitCost || 0);
        total += q * cost;
        batches.push({
          id: U.uid("bat"), productId: it.productId, batchNo: it.batchNo || "",
          expiryDate: it.expiryDate || "", mfgDate: it.mfgDate || "",
          quantity: q, originalQuantity: q,
          unitCost: cost, source: "purchase", purchaseId: pid,
          receivedAt: U.nowISO(), updatedAt: U.nowISO(), notes: ""
        });
      });
      var purchase = {
        id: pid, invoiceNo: payload.invoiceNo || no,
        supplierId: payload.supplierId || "", date: date,
        items: items.map(function (it) {
          return { productId: it.productId, batchNo: it.batchNo || "", expiryDate: it.expiryDate || "", mfgDate: it.mfgDate || "", quantity: U.roundQty(it.quantity), unitCost: U.roundMoney(it.unitCost || 0) };
        }),
        totalAmount: U.roundMoney(total), notes: payload.notes || "",
        createdAt: U.nowISO(), updatedAt: U.nowISO()
      };
      var pmethod = payload.paymentMethod || "Cash";
      purchase.paymentMethod = pmethod;
      purchase.paid = pmethod === "Credit" ? 0 : U.roundMoney(total);
      purchase.due = U.roundMoney(total - purchase.paid);
      purchase.payments = purchase.paid > 0 ? [{ date: date, amount: purchase.paid, method: pmethod }] : [];
      var ops = [{ store: "purchases", op: "put", value: purchase }];
      batches.forEach(function (b) {
        ops.push({ store: "batches", op: "put", value: b });
        putMov(ops, mov({
          productId: b.productId, qty: b.quantity, reason: "Purchase",
          ref: purchase.invoiceNo, refId: purchase.id, batchId: b.id, batchNo: b.batchNo
        }));
      });
      if (payload.bill && payload.bill.dataUrl) {
        var fid = U.uid("file");
        ops.push({ store: "files", op: "put", value: {
          id: fid, name: payload.bill.name || "bill", type: payload.bill.type || "",
          size: payload.bill.size || 0, dataUrl: payload.bill.dataUrl, createdAt: U.nowISO()
        } });
        purchase.bill = { id: fid, name: payload.bill.name || "bill", type: payload.bill.type || "", size: payload.bill.size || 0 };
      }
      return db.batchWrite(ops).then(function () { return purchase; });
    });
  }

  function deletePurchase(id) {
    return getPurchase(id).then(function (p) {
      if (!p) throw new Error("Purchase not found");
      // find batches created by this purchase
      return db.getAll("batches").then(function (all) {
        var mine = all.filter(function (b) { return b.purchaseId === id && !b.deletedAt; });
        var consumed = mine.some(function (b) { return U.roundQty(b.quantity) < U.roundQty(b.originalQuantity); });
        if (consumed) {
          var e = new Error("Some stock from this purchase has already been sold. Cannot delete.");
          e.code = "PURCHASE_CONSUMED";
          throw e;
        }
        var ops = [{ store: "purchases", op: "put", value: tomb(p) }];
        mine.forEach(function (b) {
          putMov(ops, mov({
            productId: b.productId, qty: -U.roundQty(Number(b.quantity) || 0),
            reason: "Purchase deleted", ref: p.invoiceNo, refId: p.id, batchId: b.id, batchNo: b.batchNo
          }));
          ops.push({ store: "batches", op: "put", value: tomb(b, { quantity: 0 }) });
        });
        if (p.bill && p.bill.id) ops.push({ store: "files", op: "delete", value: p.bill.id });
        return db.batchWrite(ops);
      });
    });
  }

  // Outstanding amount owed to the supplier on a purchase.
  // Legacy purchases (no payment fields) are treated as settled.
  function purchaseDue(p) {
    if (!p) return 0;
    if (p.due != null) return U.roundMoney(Number(p.due) || 0);
    if (p.paymentMethod === "Credit") return U.roundMoney(Number(p.totalAmount) || 0);
    return 0;
  }

  function paySupplier(id, amount, note) {
    amount = U.roundMoney(Number(amount) || 0);
    if (!(amount > 0)) return Promise.reject(new Error("Enter a valid amount"));
    return getPurchase(id).then(function (p) {
      if (!p || p.id !== id) throw new Error("Purchase not found");
      var due = purchaseDue(p);
      if (!(due > 0)) throw new Error("This purchase has no outstanding payable");
      if (amount > due) amount = due;
      p.paid = U.roundMoney(Number(p.paid || 0) + amount);
      p.due = U.roundMoney(due - amount);
      (p.payments = p.payments || []).push({ date: U.todayISO(), amount: amount, note: note || "" });
      return db.put("purchases", Object.assign({}, p, { updatedAt: U.nowISO() }));
    });
  }

  /* ============================ Sales ============================ */

  function listSales() {
    return db.getAll("sales").then(function (rows) {
      rows = live(rows);
      rows.sort(function (a, b) { return (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""); });
      return rows;
    });
  }
  function getSale(id) { return db.get("sales", id).then(alive); }

  // payload: {items:[{productId, quantity, price}], customerName, customerPhone,
  //           discount, discountType:'amt'|'pct', taxRate, paymentMethod, date, notes}
  function createSale(payload) {
    var items = (payload.items || []).filter(function (it) { return Number(it.quantity) > 0; });
    if (!items.length) return Promise.reject(new Error("Cart is empty."));

    return Promise.all([db.getAll("batches"), db.getSettings()]).then(function (res) {
      var allBatches = res[0], settings = res[1];

      // Merge duplicate lines (same product AND same selling unit)
      var merged = {};
      items.forEach(function (it) {
        var factor = U.num(it.unitFactor) > 0 ? U.num(it.unitFactor) : 1;
        var unitId = it.unitId || "";
        var k = it.productId + "|" + unitId + "|" + factor;
        if (!merged[k]) merged[k] = {
          productId: it.productId, unitId: unitId, unitName: it.unitName || "",
          unitFactor: factor, quantity: 0, price: Number(it.price) || 0
        };
        merged[k].quantity = U.roundQty(merged[k].quantity + Number(it.quantity));
        if (it.price != null) merged[k].price = Number(it.price);
      });
      var lines = Object.keys(merged).map(function (k) { return merged[k]; });

      // Consume FIFO per line. `quantity` is in selling units; stock is drawn in
      // base units (quantity × unitFactor), so packs deplete the same pool.
      var saleItems = [], ops = [], pendMov = [], subtotal = 0, costTotal = 0;
      lines.forEach(function (ln) {
        var baseNeed = U.roundQty(ln.quantity * ln.unitFactor);
        var r = consumeStock(ln.productId, baseNeed, allBatches);
        // remove consumed batches from the working pool so subsequent lines don't double-use
        allBatches = allBatches.map(function (b) {
          var upd = r.updatedBatches.filter(function (u) { return u.id === b.id; })[0];
          return upd || b;
        });
        var price = U.roundMoney(ln.price);
        var lineTotal = U.roundMoney(price * ln.quantity);
        var lineCost = U.roundMoney(r.consumptions.reduce(function (s, c) { return s + c.qty * (c.unitCost || 0); }, 0));
        subtotal += lineTotal;
        costTotal += lineCost;
        r.updatedBatches.forEach(function (b) { b.updatedAt = U.nowISO(); ops.push({ store: "batches", op: "put", value: b }); });
        r.consumptions.forEach(function (c) { pendMov.push({ productId: ln.productId, qty: -c.qty, batchId: c.batchId, batchNo: c.batchNo }); });
        saleItems.push({
          productId: ln.productId, quantity: ln.quantity,
          unitId: ln.unitId, unitName: ln.unitName, unitFactor: ln.unitFactor,
          price: price, lineTotal: lineTotal, lineCost: lineCost, consumptions: r.consumptions
        });
      });

      subtotal = U.roundMoney(subtotal);
      var discount = computeDiscount(subtotal, payload.discount, payload.discountType);
      var taxableBase = U.roundMoney(subtotal - discount);
      var taxRate = payload.taxRate != null ? Number(payload.taxRate) : (Number(settings.taxRate) || 0);
      var tax = U.roundMoney(taxableBase * taxRate / 100);
      var total = U.roundMoney(taxableBase + tax);

      return nextBillNo("sale", settings.invoicePrefix).then(function (no) {
        var sale = {
          id: U.uid("sal"),
          invoiceNo: payload.invoiceNo || no,
          customerName: payload.customerName || "Walk-in",
          customerPhone: payload.customerPhone || "",
          date: payload.date || U.todayISO(),
          items: saleItems,
          subtotal: subtotal, discount: discount, discountType: payload.discountType || "amt",
          taxRate: taxRate, tax: tax, total: total, cost: U.roundMoney(costTotal),
          profit: U.roundMoney(total - tax - U.roundMoney(costTotal)), // profit excl. tax
          paymentMethod: payload.paymentMethod || "Cash",
          notes: payload.notes || "",
          createdAt: U.nowISO(), updatedAt: U.nowISO()
        };
        sale.paid = sale.paymentMethod === "Credit" ? 0 : total;
        sale.due = U.roundMoney(total - sale.paid);
        sale.payments = sale.paid > 0 ? [{ date: sale.date, amount: sale.paid, method: sale.paymentMethod }] : [];
        pendMov.forEach(function (mm) { putMov(ops, mov({
          productId: mm.productId, qty: mm.qty, reason: "Sale",
          ref: sale.invoiceNo, refId: sale.id, batchId: mm.batchId, batchNo: mm.batchNo
        })); });
        ops.push({ store: "sales", op: "put", value: sale });
        return db.batchWrite(ops).then(function () { return sale; });
      });
    });
  }

  function computeDiscount(subtotal, discount, type) {
    discount = Number(discount) || 0;
    var amt = type === "pct" ? U.roundMoney(subtotal * discount / 100) : U.roundMoney(discount);
    if (amt < 0) amt = 0;
    if (amt > subtotal) amt = subtotal;
    return amt;
  }

  // Deleting a sale puts stock back on every batch it drew from. All of those
  // writes plus the sale row itself go into ONE transaction, so a failure can
  // never leave the stock restored while the invoice is still on the books.
  function deleteSale(id) {
    return getSale(id).then(function (sale) {
      if (!sale || sale.id !== id) throw new Error("Sale not found");
      var draws = [];
      (sale.items || []).forEach(function (it) {
        (it.consumptions || []).forEach(function (c) {
          if (c && c.batchId) draws.push({ productId: it.productId, c: c });
        });
      });
      return Promise.all(draws.map(function (d) { return db.get("batches", d.c.batchId); })).then(function (found) {
        var work = {}, ops = [];
        draws.forEach(function (d, i) {
          var c = d.c, b = found[i];
          if (!work[c.batchId]) {
            work[c.batchId] = b ? Object.assign({}, b) : {
              // the batch itself was deleted — recreate a minimal one so stock is not lost
              id: c.batchId, productId: d.productId, batchNo: c.batchNo || "restored",
              expiryDate: c.expiryDate || "", quantity: 0, originalQuantity: 0,
              unitCost: c.unitCost || 0, source: "restored", purchaseId: null,
              receivedAt: U.nowISO(), notes: "Restored from a deleted sale"
            };
          }
          var w = work[c.batchId];
          // A batch the shop deliberately deleted stays deleted: the return below is
          // still written to the ledger, so cached and derived keep agreeing.
          if (!w.deletedAt) {
            w.quantity = U.roundQty(Number(w.quantity) + Number(c.qty));
            w.originalQuantity = U.roundQty(Math.max(Number(w.originalQuantity) || 0, Number(w.quantity)));
          }
          ops.push({ store: "movements", op: "put", value: mov({
            productId: d.productId, qty: c.qty, reason: "Sale deleted",
            ref: sale.invoiceNo, refId: sale.id, batchId: c.batchId, batchNo: c.batchNo
          }) });
        });
        Object.keys(work).forEach(function (bid) { ops.push({ store: "batches", op: "put", value: work[bid] }); });
        ops.push({ store: "sales", op: "put", value: tomb(sale) });
        return db.batchWrite(ops);
      });
    });
  }

  // Outstanding amount on a sale (credit sales, or older records marked Credit)
  function saleDue(sale) {
    if (!sale) return 0;
    if (sale.due != null) return U.roundMoney(Number(sale.due) || 0);
    if (sale.paymentMethod === "Credit") return U.roundMoney(Number(sale.total) || 0);
    return 0;
  }

  function receivePayment(id, amount, note) {
    amount = U.roundMoney(Number(amount) || 0);
    if (!(amount > 0)) return Promise.reject(new Error("Enter a valid amount"));
    return getSale(id).then(function (sale) {
      if (!sale || sale.id !== id) throw new Error("Sale not found");
      var due = saleDue(sale);
      if (!(due > 0)) throw new Error("This invoice has no outstanding due");
      if (amount > due) amount = due;
      sale.paid = U.roundMoney(Number(sale.paid || 0) + amount);
      sale.due = U.roundMoney(due - amount);
      (sale.payments = sale.payments || []).push({ date: U.todayISO(), amount: amount, note: note || "" });
      return db.put("sales", Object.assign({}, sale, { updatedAt: U.nowISO() }));
    });
  }

  /* ============================ Reports ============================ */

  // Customers are derived from sales, so editing one renames it across its invoices.
  function updateCustomerDetails(ids, name, phone) {
    name = (name || "").trim();
    phone = (phone || "").trim();
    if (!name) return Promise.reject(new Error("Customer name is required"));
    return Promise.all((ids || []).map(function (id) { return getSale(id); })).then(function (sales) {
      var ops = [];
      var wasName = "", wasPhone = "", seen = false;
      sales.forEach(function (s) {
        if (!s) return;
        // read the old identity BEFORE overwriting it on the record
        if (!seen) { seen = true; wasName = s.customerName; wasPhone = s.customerPhone; }
        s.customerName = name;
        s.customerPhone = phone;
        ops.push({ store: "sales", op: "put", value: s });
      });
      // The customer's own extras (credit limit, UPI, notes) live under a key
      // derived from name+phone, so a rename has to carry that record along or the
      // farmer silently loses their limit and payment details.
      var oldKey = seen ? customerKey(wasName, wasPhone) : "";
      var newKey = customerKey(name, phone);
      if (!oldKey || !newKey || oldKey === newKey) {
        return ops.length ? db.batchWrite(ops) : null;
      }
      return Promise.all([db.get("customers", oldKey), db.get("customers", newKey)]).then(function (c) {
        if (c[0]) {
          ops.push({ store: "customers", op: "put", value: Object.assign({}, c[0], c[1] || {}, { id: newKey, updatedAt: U.nowISO() }) });
          ops.push({ store: "customers", op: "put", value: tomb(c[0], { movedTo: newKey }) });
        }
        return ops.length ? db.batchWrite(ops) : null;
      });
    });
  }

  // ---- Persistent per-customer records (credit limit, UPI, notes) ----
  // Customers themselves are derived from sales; this store only holds extras,
  // keyed by the same key customerList() builds ("p:<phone>" or "n:<name>").
  function customerKey(name, phone) {
    name = (name || "").trim();
    phone = (phone || "").trim();
    if (phone) return "p:" + phone;
    if (name && name.toLowerCase() !== "walk-in") return "n:" + name.toLowerCase();
    return "";
  }
  function listCustomers() { return db.getAll("customers").then(live); }
  function getCustomer(id) { return id ? db.get("customers", id).then(alive) : Promise.resolve(null); }
  function saveCustomer(id, patch) {
    if (!id) return Promise.reject(new Error("No customer key"));
    return getCustomer(id).then(function (existing) {
      var now = U.nowISO();
      var rec = Object.assign({}, existing || {}, patch || {}, { id: id, updatedAt: now });
      if (!rec.createdAt) rec.createdAt = now;
      return db.put("customers", rec);
    });
  }

  function topProducts(sales, byRevenue, limit) {
    limit = limit || 5;
    var map = {};
    (sales || []).forEach(function (s) {
      (s.items || []).forEach(function (it) {
        if (!map[it.productId]) map[it.productId] = { productId: it.productId, qty: 0, revenue: 0 };
        map[it.productId].qty += Number(it.quantity) || 0;
        map[it.productId].revenue += Number(it.lineTotal) || 0;
      });
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    arr.sort(function (a, b) { return byRevenue ? b.revenue - a.revenue : b.qty - a.qty; });
    return arr.slice(0, limit);
  }

  /* ============================ Backup / Restore ============================ */

  function exportAll() {
    var stores = db.STORES;
    return Promise.all(stores.map(function (s) { return db.getAll(s); })).then(function (arr) {
      var out = { _app: "fertilizer-shop-inventory", _version: 1, _exportedAt: U.nowISO() };
      stores.forEach(function (s, i) { out[s] = arr[i]; });
      return out;
    });
  }

  function importAll(data, replace) {
    if (!data || typeof data !== "object" || Array.isArray(data) || data._app !== "fertilizer-shop-inventory") {
      return Promise.reject(new Error("That file is not a backup taken by this app."));
    }
    // Restored bills may carry numbers above this device's counter.
    countersSeeded = false;
    var stores = db.STORES.slice();
    var ops = [];
    function keyOf(storeName) { return storeName === "meta" ? "key" : "id"; }

    // In replace mode the wipe and the restore share ONE transaction, so a failed
    // or half-readable backup can never leave the shop with an empty database.
    var prep = replace
      ? Promise.all(stores.map(function (s) { return db.getAll(s); })).then(function (rows) {
          rows.forEach(function (recs, i) {
            var kn = keyOf(stores[i]);
            recs.forEach(function (rec) {
              if (rec && typeof rec[kn] === "string" && rec[kn]) ops.push({ store: stores[i], op: "delete", value: rec[kn] });
            });
          });
        })
      : Promise.resolve();

    return prep.then(function () {
      var putCount = 0;
      stores.forEach(function (s) {
        var arr = Array.isArray(data[s]) ? data[s] : [];
        var keyName = keyOf(s);
        arr.forEach(function (rec) {
          // Skip anything that isn't a plain record, or that is missing its key.
          if (!rec || typeof rec !== "object" || Array.isArray(rec)) return;
          if (typeof rec[keyName] !== "string" || !rec[keyName]) return;
          ops.push({ store: s, op: "put", value: rec });
          putCount++;
        });
      });
      if (!ops.length) return 0;
      return db.batchWrite(ops).then(function () { return putCount; });
    });
  }

  /* ============================ helpers ============================ */
  function pad(n, len) { var s = String(n); while (s.length < (len || 4)) s = "0" + s; return s; }

  FS.store = {
    // products
    listProducts: listProducts, getProduct: getProduct, saveProduct: saveProduct,
    deleteProduct: deleteProduct,
    effectiveUnits: effectiveUnits,
    // batches
    saveBatch: saveBatch, deleteBatch: deleteBatch, addStock: addStock,
    consumeStock: consumeStock, listBatches: listBatches,
    stockMap: stockMap, stockValuation: stockValuation, fifoCompare: fifoCompare,
    ledgerByBatch: ledgerByBatch, stockDrift: stockDrift, checkStock: checkStock,
    migrateToV5: migrateToV5, clearDemoValues: clearDemoValues,
    // alerts
    lowStock: lowStock, reorderList: reorderList, stockedSet: stockedSet, expiringSoon: expiringSoon,
    // suppliers
    listSuppliers: listSuppliers, getSupplier: getSupplier, saveSupplier: saveSupplier, deleteSupplier: deleteSupplier,
    // purchases
    listPurchases: listPurchases, getPurchase: getPurchase, createPurchase: createPurchase, deletePurchase: deletePurchase,
    purchaseDue: purchaseDue, paySupplier: paySupplier,
    // sales
    listSales: listSales, getSale: getSale, createSale: createSale, deleteSale: deleteSale, computeDiscount: computeDiscount,
    listMovements: listMovements, deviceTag: deviceTag, nextBillNo: nextBillNo, billSeq: billSeq,
    receivePayment: receivePayment, saleDue: saleDue,
    updateCustomerDetails: updateCustomerDetails,
    // customers (persistent extras: credit limit, upi, notes)
    customerKey: customerKey, listCustomers: listCustomers, getCustomer: getCustomer, saveCustomer: saveCustomer,
    // reports
    topProducts: topProducts,
    // backup
    exportAll: exportAll, importAll: importAll, pad: pad
  };
})(window.FS);
