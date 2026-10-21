/* =========================================================
   views-core.js — helpers shared by more than one screen
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
  function isoOffset(days) { var d = new Date(); d.setDate(d.getDate() + days); return U.toISODate(d); }

  function stock(pid) { return state.stockMap[pid] || 0; }

  /* ---- Shared form mechanics ------------------------------------------------
     Two-tier forms so the counter sees only what a transaction needs, and a
     keyboard path through it. Every screen uses the same disclosure and the same
     Enter behaviour; a field is never removed, only folded. */

  // Opens the markup; the caller closes it with foldClose().
  function foldMarkup(id, hint, bodyClass) {
    return '<div class="form-fold">' +
      '<button class="fold-btn" type="button" id="' + id + '" aria-expanded="false" aria-controls="' + id + '-body">' +
        ico("chevron") + '<span class="fold-t">More details</span>' +
        '<span class="fold-hint">' + h(hint) + "</span></button>" +
      '<div class="' + (bodyClass || "form-grid") + ' fold-body" id="' + id + '-body" style="display:none">';
  }
  function foldClose() { return "</div></div>"; }

  // Wires one disclosure button; returns the open(true|false) setter.
  function wireFold(btn) {
    var body = btn.getAttribute("aria-controls");
    body = document.getElementById(body);
    if (!body) return function () {};
    function set(open) {
      body.style.display = open ? "" : "none";
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    btn.onclick = function () { set(body.style.display === "none"); };
    return set;
  }

  /* Enter moves to the next field the counter can actually see — so a folded
     section is skipped, a type-specific field that is hidden is skipped — and
     saves at the end of the last one. */
  function enterWalk(form, onSave) {
    function step(from, back) {
      var list = $$("input, select, textarea", form).filter(function (i) {
        if (i.disabled || i.type === "checkbox" || i.type === "file") return false;
        return i.offsetWidth || i.offsetHeight;
      });
      var at = list.indexOf(from), next = list[back ? at - 1 : at + 1];
      if (!next) return false;
      next.focus();
      return true;
    }
    form.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || e.isComposing) return;
      var t = e.target;
      if (!t) return;
      if (t.tagName === "SELECT") { step(t, e.shiftKey); return; }
      if (t.tagName !== "INPUT" || t.type === "checkbox" || t.type === "file") return;
      e.preventDefault();
      if (e.shiftKey) { step(t, true); return; }
      if (!step(t, false) && onSave) onSave();
    });
  }

  function unitOpts(sel) {
    return UNITS.map(function (u) { return '<option value="' + u + '"' + (u === sel ? " selected" : "") + ">" + u + "</option>"; }).join("");
  }
  // Catalogue price line: the cheapest selling unit when a product has packs.

  function cardPriceLabel(p) {
    var us = store.effectiveUnits(p);
    if (!us.some(function (u) { return Number(u.price) > 0; })) return '<span class="need">Set price</span>';
    if (us.length <= 1) return U.money(p.sellPrice);
    var min = Math.min.apply(null, us.map(function (u) { return u.price; }));
    return '<span class="small muted">from </span>' + U.money(min);
  }

  function cats() {
    var set = {}; state.products.forEach(function (p) { if (p.category) set[p.category] = 1; });
    return Object.keys(set).sort();
  }

  var TYPES = ["Fertilizer", "Insecticide", "Fungicide", "Herbicide", "PGR", "Other"];

  var CROP_TYPES = ["Insecticide", "Fungicide", "Herbicide", "PGR"];

  var TOX_TYPES = ["Insecticide", "Fungicide", "Herbicide"];

  var FORMS = ["EC", "SC", "SL", "WP", "WG", "GR", "SP", "L", "WSG"];

  var TOX = ["Class I (Red)", "Class II (Yellow)", "Class III (Blue)", "Class IV (Green)"];

  function selOpts(list, sel) {
    return list.map(function (v) { return '<option value="' + h(v) + '"' + (v === sel ? " selected" : "") + ">" + h(v) + "</option>"; }).join("");
  }

  function typeBadge(t) {
    if (t === "Insecticide") return '<span class="badge red">Insecticide</span> ';
    if (t === "Fungicide") return '<span class="badge blue">Fungicide</span> ';
    if (t === "Herbicide") return '<span class="badge teal">Herbicide</span> ';
    if (t === "PGR") return '<span class="badge blue">PGR</span> ';
    if (t === "Other") return '<span class="badge gray">Other</span> ';
    return "";
  }

  function movementTable(ms, showProduct) {
    return '<div class="table-wrap"><table class="data"><thead><tr><th>When</th>' +
      (showProduct ? "<th>Product</th>" : "") +
      "<th>Batch</th><th class=\"num\">Change</th><th>Reason</th><th>Ref</th></tr></thead><tbody>" +
      ms.map(function (m) {
        var p = state.pmap[m.productId] || {};
        return "<tr><td class=\"small\">" + U.fmtDateTime(m.ts) + "</td>" +
          (showProduct ? "<td>" + h(p.name || "?") + "</td>" : "") +
          "<td class=\"small\">" + h(m.batchNo || "—") + "</td>" +
          '<td class="num"><strong style="color:' + (m.qty >= 0 ? "var(--brand-dark)" : "var(--danger)") + '">' + (m.qty > 0 ? "+" : "") + U.qty(m.qty) + "</strong></td>" +
          "<td>" + h(m.reason || "") + "</td>" +
          "<td class=\"small muted\">" + h(m.ref || "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function kv(k, v) { return '<div class="k">' + h(k) + '</div><div class="v">' + h(String(v == null ? "" : v)) + "</div>"; }
  // Only for markup this file builds itself. Never for anything the owner typed —
  // a value that starts with "<" is exactly what a stored-XSS payload looks like.

  function kvHtml(k, html) { return '<div class="k">' + h(k) + '</div><div class="v">' + html + "</div>"; }


  /* =========================== Shared invoice / print =========================== */
  function currentLang() { return (state.settings && state.settings.printLang) || "en"; }

  function footText(s, lang) {
    return (s.invoiceFooter && s.invoiceFooter !== "Thank you for your business!")
      ? s.invoiceFooter : U.t("thank", lang);
  }

  function payMethodLabel(pm, lang) {
    pm = pm || "Cash";
    if (lang && lang !== "en") {
      if (pm === "Cash") return U.t("cash", lang);
      if (pm === "Credit") return U.t("credit", lang);
    }
    return pm;
  }
  // Advisory rows on the printed invoice: toxicity class (+signal colour),
  // antidote, and pre-harvest interval. Only present when set.

  function advisoryLines(p, lang) {
    var out = [];
    if (p.toxicityClass) out.push({ label: U.t("toxicity", lang), value: p.toxicityClass, tox: U.toxicityColor(p.toxicityClass) });
    if (p.antidote) out.push({ label: U.t("antidote", lang), value: p.antidote });
    if (p.phi) out.push({ label: U.t("phi", lang), value: p.phi });
    return out;
  }

  // Permanent UPI payment QR — always the shop's own pay link (no fixed amount),
  // so it is identical on every bill and scannable for any value.

  function payQrBlock(sale, lang, cls, px) {
    var s = state.settings;
    var vpa = (s.upiId || "").trim();
    if (!vpa) return "";
    var uri = U.upiURI({ pa: vpa, pn: s.shopName });
    var svg = U.qrSvg(uri, px || 120);
    if (!svg) return "";
    return '<div class="' + (cls || "inv-qr") + '">' + svg +
      '<div class="qr-lbl">' + h(U.t("scanPay", lang)) + "</div>" +
      '<div class="qr-vpa">' + h(vpa) + "</div></div>";
  }

  function invoiceHTML(sale, copyLabel, withQr) {
    var s = state.settings, lang = currentLang();
    var rows = (sale.items || []).map(function (it) {
      var p = state.pmap[it.productId] || {};
      var batches = (it.consumptions || []).map(function (c) { return c.batchNo; }).filter(Boolean);
      var uniq = batches.filter(function (v, i) { return batches.indexOf(v) === i; }).join(", ");
      var adv = advisoryLines(p, lang);
      return "<tr><td>" + h(p.name || "Item") +
        (p.localName ? '<div class="inv-local">' + h(p.localName) + "</div>" : "") +
        (p.brand ? '<div class="small muted">' + h(p.brand) + "</div>" : "") +
        (p.dosage ? '<div class="inv-dose">' + ico("doc") + ' ' + h(p.dosage) + "</div>" : "") +
        (adv.length ? '<div class="inv-adv">' + adv.map(function (a) {
          return "<div>" + (a.tox ? '<span class="tox ' + a.tox + '">' + ico("alert") + "</span> " : "") + "<strong>" + h(a.label) + ":</strong> " + h(a.value) + "</div>";
        }).join("") + "</div>" : "") + "</td>" +
        "<td>" + h(uniq || "—") + "</td>" +
        '<td class="num">' + U.qty(it.quantity) + " " + h(it.unitName || p.unit || "") + "</td>" +
        '<td class="num">' + U.money(it.price) + "</td>" +
        '<td class="num">' + U.money(it.lineTotal) + "</td></tr>";
    }).join("");
    return '<div class="invoice">' +
      (copyLabel ? '<div class="inv-copy">' + h(copyLabel) + "</div>" : "") +
      '<div class="inv-head"><div class="inv-shop"><img class="inv-logo" src="assets/logo.svg" alt=""><div>' +
        '<h2>' + h(s.shopName || "Shop") + "</h2>" +
        '<div class="small inv-addr">' + h(s.address || "") + "</div>" +
        (s.phone ? '<div class="small">' + h(U.t("ph", lang)) + ": " + h(s.phone) + "</div>" : "") +
        (s.gstin ? '<div class="small">GSTIN: ' + h(s.gstin) + "</div>" : "") +
        (s.email ? '<div class="small">' + h(s.email) + "</div>" : "") +
      "</div></div>" +
      '<div class="inv-meta"><div class="inv-title">' + h(U.t("invoice", lang)) + "</div>" +
        "<div><strong>" + h(sale.invoiceNo) + "</strong></div>" +
        "<div>" + h(U.t("date", lang)) + ": " + U.fmtDate(sale.date) + "</div>" +
        "<div>" + h(U.t("customer", lang)) + ": " + h(sale.customerName || "Walk-in") + "</div>" +
        (sale.customerPhone ? "<div>" + h(U.t("ph", lang)) + ": " + h(sale.customerPhone) + "</div>" : "") +
      "</div></div>" +
      '<table class="inv"><thead><tr><th>' + h(U.t("item", lang)) + "</th><th>" + h(U.t("batch", lang)) + '</th><th class="num">' + h(U.t("qty", lang)) + '</th><th class="num">' + h(U.t("rate", lang)) + '</th><th class="num">' + h(U.t("amount", lang)) + "</th></tr></thead><tbody>" + rows + "</tbody></table>" +
      '<div class="inv-pay">' +
        (withQr === false ? "" : payQrBlock(sale, lang, "inv-qr", 130)) +
        '<div class="inv-tot">' +
          sumline(U.t("subtotal", lang), U.money(sale.subtotal)) +
          (sale.discount ? sumline(U.t("discount", lang), "− " + U.money(sale.discount)) : "") +
          (sale.tax ? sumline(U.t("tax", lang) + " (" + sale.taxRate + "%)", U.money(sale.tax)) : "") +
          '<div class="sum-line total"><span>' + h(U.t("total", lang)) + "</span><span>" + U.money(sale.total) + "</span></div>" +
          '<div class="small muted right" style="margin-top:4px">' + h(U.t("paidVia", lang)) + " " + h(payMethodLabel(sale.paymentMethod, lang)) +
          (store.saleDue(sale) > 0 ? " · " + h(U.t("due", lang)) + " " + U.money(store.saleDue(sale)) : "") + "</div>" +
        "</div>" +
      "</div>" +
      '<div class="inv-foot">' + h(footText(s, lang)) + "</div>" +
    "</div>";
  }

  function sumline(k, v) { return '<div class="sum-line"><span class="muted">' + h(k) + "</span><span>" + v + "</span></div>"; }

  function printInvoice(sale) {
    var area = $("#print-area"), lang = currentLang();
    H.setPrintPage(false); // invoices print portrait
    area.className = "print-area";
    area.innerHTML =
      '<div class="print-copy">' + invoiceHTML(sale, U.t("custCopy", lang), true) + "</div>" +
      '<div class="print-copy">' + invoiceHTML(sale, U.t("ownCopy", lang), false) + "</div>";
    setTimeout(function () { window.print(); }, 60);
  }


  /* =========================== CUSTOMER BOOK =========================== */
  function customerList() {
    var map = {};
    (state.sales || []).forEach(function (s) {
      var name = (s.customerName || "").trim();
      if (!name || name.toLowerCase() === "walk-in") return;
      var phone = (s.customerPhone || "").trim();
      var key = phone ? "p:" + phone : "n:" + name.toLowerCase();
      var c = map[key];
      if (!c) c = map[key] = { key: key, name: name, phone: phone, count: 0, spent: 0, due: 0, last: "", sales: [] };
      if (name.length > c.name.length) c.name = name;
      if (!c.phone && phone) c.phone = phone;
      c.count++;
      c.spent = U.roundMoney(c.spent + (Number(s.total) || 0));
      c.due = U.roundMoney(c.due + store.saleDue(s));
      if (s.date > c.last) c.last = s.date;
      c.sales.push(s);
    });
    var list = Object.keys(map).map(function (k) { return map[k]; });
    list.forEach(function (c) {
      c.sales.sort(function (a, b) {
        return ((b.date || "") + (b.createdAt || "")).localeCompare((a.date || "") + (a.createdAt || ""));
      });
    });
    list.sort(function (a, b) { return (b.last || "").localeCompare(a.last || ""); });
    return list;
  }


  /* =========================== WhatsApp due reminders =========================== */
  function waPhone(phone) {
    var d = String(phone || "").replace(/\D/g, "");
    if (!d) return "";
    if (d.length === 10) d = "91" + d;
    return d;
  }

  function waOpen(phone, text, entity) {
    var p = waPhone(phone);
    entity = entity || "customer";
    if (!p) { toast("This " + entity + " has no phone number saved — edit the " + entity + " to add one", "warn"); return false; }
    window.open("https://wa.me/" + p + "?text=" + encodeURIComponent(text), "_blank", "noopener,noreferrer");
    return true;
  }

  function dueReminderText(name, lines, totalDue, upi, heading) {
    var s = state.settings;
    var hi = s.waLang === "hi";
    var pay = (upi || "").trim() || (s.upiId || "").trim();
    var head = heading || (hi ? "बकाया बिल:" : "Pending invoice(s):");
    if (hi) {
      return "नमस्ते " + name + " जी,\n" +
        (s.shopName || "हमारी दुकान") + " से भुगतान अनुस्मारक।\n\n" +
        (lines.length ? head + "\n" + lines.join("\n") + "\n\n" : "") +
        "कुल बकाया: " + U.money(totalDue) + "\n" +
        (pay ? "UPI: " + pay + "\n" : "") +
        "कृपया सुविधा अनुसार भुगतान करें। धन्यवाद!";
    }
    return "Namaste " + name + " ji,\n" +
      "Payment reminder from " + (s.shopName || "our shop") + ".\n\n" +
      (lines.length ? head + "\n" + lines.join("\n") + "\n\n" : "") +
      "Total outstanding: " + U.money(totalDue) + "\n" +
      (pay ? "Pay via UPI: " + pay + "\n" : "") +
      "Kindly settle at your convenience. Thank you!";
  }
  // Compact itemized invoice for the reminder. WhatsApp can't auto-attach a file,
  // so the bill details are embedded directly in the message text.

  function invoiceWaLines(sale) {
    var hi = state.settings.waLang === "hi";
    var out = ["*" + (sale.invoiceNo || "") + "*  " + U.fmtDate(sale.date)];
    (sale.items || []).forEach(function (it) {
      var p = state.pmap[it.productId] || {};
      out.push("• " + (p.name || "Item") + " — " + U.qty(it.quantity) + " " + (it.unitName || p.unit || "") +
        " × " + U.money(it.price) + " = " + U.money(it.lineTotal));
    });
    if (sale.discount) out.push((hi ? "छूट: " : "Discount: ") + "− " + U.money(sale.discount));
    out.push((hi ? "कुल: " : "Total: ") + U.money(sale.total));
    return out;
  }

  function waSaleReminder(sale) {
    var due = store.saleDue(sale);
    if (!(due > 0)) { toast("This invoice is fully settled", "warn"); return; }
    var hi = state.settings.waLang === "hi";
    var rec = state.custmap[store.customerKey(sale.customerName, sale.customerPhone)] || {};
    waOpen(sale.customerPhone, dueReminderText(sale.customerName || "Walk-in",
      invoiceWaLines(sale), due, rec.upi, hi ? "आपका बिल:" : "Your invoice:"));
  }

  function waCustomerReminder(c) {
    var open = (c.sales || []).filter(function (s) { return store.saleDue(s) > 0; });
    if (!open.length) { toast("Nothing outstanding for " + c.name, "warn"); return; }
    var hi = state.settings.waLang === "hi";
    var lines, heading;
    if (open.length === 1) { lines = invoiceWaLines(open[0]); heading = hi ? "आपका बिल:" : "Your invoice:"; }
    else { lines = open.map(function (s) { return "- " + s.invoiceNo + " (" + U.fmtDate(s.date) + "): " + U.money(store.saleDue(s)); }); heading = hi ? "बकाया बिल:" : "Pending invoice(s):"; }
    var rec = state.custmap[c.key] || {};
    waOpen(c.phone, dueReminderText(c.name, lines, c.due, rec.upi, heading));
  }
  Object.assign(FS.ui._shared, {
    isoOffset: isoOffset, stock: stock, unitOpts: unitOpts, cardPriceLabel: cardPriceLabel, cats: cats, TYPES: TYPES, CROP_TYPES: CROP_TYPES, TOX_TYPES: TOX_TYPES, FORMS: FORMS, TOX: TOX, selOpts: selOpts, typeBadge: typeBadge, movementTable: movementTable, kv: kv, kvHtml: kvHtml, currentLang: currentLang, footText: footText, payMethodLabel: payMethodLabel, advisoryLines: advisoryLines, payQrBlock: payQrBlock, sumline: sumline, invoiceHTML: invoiceHTML, printInvoice: printInvoice, customerList: customerList, waPhone: waPhone, waOpen: waOpen, dueReminderText: dueReminderText, invoiceWaLines: invoiceWaLines, waSaleReminder: waSaleReminder, waCustomerReminder: waCustomerReminder, foldMarkup: foldMarkup, foldClose: foldClose, wireFold: wireFold, enterWalk: enterWalk });
})(window.FS);
