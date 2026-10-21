/* =========================================================
   db.js — IndexedDB wrapper, schema, settings, seed data
   Attaches to window.FS.db
   ========================================================= */
(function (FS) {
  "use strict";
  var U = FS.util;

  var DB_NAME = "fertilizer_shop_db";
  var DB_VERSION = 5;
  var STORES = ["products", "batches", "suppliers", "purchases", "sales", "files", "meta", "movements", "customers"];

  var _db = null;
  var _opening = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    if (_opening) return _opening;

    _opening = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("This browser does not support IndexedDB, which the app needs to store data locally."));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function (e) {
        var db = e.target.result;

        if (!db.objectStoreNames.contains("products")) {
          var s = db.createObjectStore("products", { keyPath: "id" });
          s.createIndex("by_name", "name", { unique: false });
          s.createIndex("by_category", "category", { unique: false });
        }
        if (!db.objectStoreNames.contains("batches")) {
          var b = db.createObjectStore("batches", { keyPath: "id" });
          b.createIndex("by_product", "productId", { unique: false });
          b.createIndex("by_expiry", "expiryDate", { unique: false });
        }
        if (!db.objectStoreNames.contains("suppliers")) {
          var sp = db.createObjectStore("suppliers", { keyPath: "id" });
          sp.createIndex("by_name", "name", { unique: false });
        }
        if (!db.objectStoreNames.contains("purchases")) {
          var pu = db.createObjectStore("purchases", { keyPath: "id" });
          pu.createIndex("by_date", "date", { unique: false });
        }
        if (!db.objectStoreNames.contains("sales")) {
          var sa = db.createObjectStore("sales", { keyPath: "id" });
          sa.createIndex("by_date", "date", { unique: false });
          sa.createIndex("by_invoice", "invoiceNo", { unique: false });
        }
        if (!db.objectStoreNames.contains("files")) {
          db.createObjectStore("files", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("movements")) {
          var mv = db.createObjectStore("movements", { keyPath: "id" });
          mv.createIndex("by_product", "productId", { unique: false });
          mv.createIndex("by_date", "date", { unique: false });
        }
        if (!db.objectStoreNames.contains("customers")) {
          var cu = db.createObjectStore("customers", { keyPath: "id" });
          cu.createIndex("by_phone", "phone", { unique: false });
        }
      };

      req.onsuccess = function (e) {
        _db = e.target.result;
        _db.onversionchange = function () { try { _db.close(); } catch (_) {} _db = null; _opening = null; };
        resolve(_db);
      };
      req.onerror = function () { reject(req.error || new Error("Failed to open database")); };
      req.onblocked = function () { reject(new Error("Database is blocked by another open tab. Close other tabs and reload.")); };
    });

    return _opening;
  }

  function reqP(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error || new Error("Database request failed")); };
    });
  }

  // A write request can report success and still lose its data if the
  // transaction later aborts (quota, crash), so every write waits for commit.
  function txDone(tx) {
    return new Promise(function (resolve, reject) {
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error("Database transaction failed")); };
      tx.onabort = function () { reject(tx.error || new Error("Database transaction aborted")); };
    });
  }

  function store(name, mode) {
    return open().then(function (db) {
      return db.transaction(name, mode || "readonly").objectStore(name);
    });
  }

  function getAll(name) {
    return store(name, "readonly").then(function (s) { return reqP(s.getAll()); });
  }
  function get(name, id) {
    return store(name, "readonly").then(function (s) { return reqP(s.get(id)); });
  }
  function put(name, obj) {
    return store(name, "readwrite").then(function (s) { s.put(obj); return txDone(s.transaction); }).then(function () { return obj; });
  }
  function del(name, id) {
    return store(name, "readwrite").then(function (s) { s.delete(id); return txDone(s.transaction); });
  }
  function clear(name) {
    return store(name, "readwrite").then(function (s) { s.clear(); return txDone(s.transaction); });
  }
  function byIndex(name, indexName, value) {
    return store(name, "readonly").then(function (s) {
      var idx = s.index(indexName);
      return reqP(idx.getAll(value));
    });
  }

  // Run a set of writes atomically. ops = [{store, op:'put'|'delete', value}]
  function batchWrite(ops) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var names = [];
        ops.forEach(function (o) { if (names.indexOf(o.store) < 0) names.push(o.store); });
        var tx = db.transaction(names, "readwrite");
        ops.forEach(function (o) {
          var s = tx.objectStore(o.store);
          if (o.op === "delete") s.delete(o.value);
          else s.put(o.value);
        });
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  // ---------- meta (settings + counters) ----------
  function getMeta(key) {
    return get("meta", key).then(function (rec) { return rec ? rec.value : undefined; });
  }
  function setMeta(key, value) {
    return put("meta", { key: key, value: value });
  }

  var DEFAULT_SETTINGS = {
    shopName: "Agro Depot",
    address: "",
    phone: "",
    email: "",
    gstin: "",
    currency: "₹",
    invoicePrefix: "INV",
    purchasePrefix: "PUR",
    taxRate: 0,           // default GST % applied to sales
    lowStockDefault: 5,   // default reorder level
    expiryWarnDays: 60,   // warn when a batch expires within this many days
    invoiceFooter: "Thank you for your business!",
    idleLockMin: 0,       // auto-lock after this many idle minutes (0 = off)
    upiId: "",            // shop UPI ID, printed on WhatsApp payment reminders
    waLang: "en",         // WhatsApp reminder language: "en" | "hi"
    printLang: "en",      // invoice print language: "en" | "hi" | "mr" | "te" (English always shown too)
    theme: "green"        // appearance preset: green (light) | dark
  };

  function getSettings() {
    return getMeta("settings").then(function (s) {
      return Object.assign({}, DEFAULT_SETTINGS, s || {});
    });
  }
  function saveSettings(settings) {
    // updatedAt records when the shop last changed a setting.
    return setMeta("settings", Object.assign({}, DEFAULT_SETTINGS, settings, { updatedAt: U.nowISO() }));
  }

  // Atomic-ish counter increment (single tab usage assumed)
  function nextCounter(name) {
    return getMeta("counters").then(function (c) {
      c = c || {};
      var v = (Number(c[name]) || 0) + 1;
      c[name] = v;
      return setMeta("counters", c).then(function () { return v; });
    });
  }

  FS.db = {
    open: open,
    getAll: getAll, get: get, put: put, del: del, clear: clear,
    byIndex: byIndex, batchWrite: batchWrite,
    getMeta: getMeta, setMeta: setMeta,
    getSettings: getSettings, saveSettings: saveSettings,
    nextCounter: nextCounter,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    STORES: STORES
  };
})(window.FS);
