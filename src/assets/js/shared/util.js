/* =========================================================
   util.js — small shared helpers (loaded first)
   Attaches to window.FS
   ========================================================= */
window.FS = window.FS || {};

(function (FS) {
  "use strict";

  // Current currency symbol / shop settings cache (updated by app on load)
  FS.CURRENCY = "₹";

  function uid(prefix) {
    var p = prefix ? prefix + "_" : "";
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return p + window.crypto.randomUUID();
    }
    return p + "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function round(n, dp) {
    var f = Math.pow(10, dp == null ? 2 : dp);
    return Math.round((Number(n) + Number.EPSILON) * f) / f;
  }
  function roundQty(n) { return round(n, 3); }
  function roundMoney(n) { return round(n, 2); }

  function num(v) {
    var n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : Number(v);
    return isFinite(n) ? n : 0;
  }

  // Format a number with Indian digit grouping
  function group(n) {
    n = Number(n) || 0;
    var neg = n < 0;
    n = Math.abs(n);
    var parts = n.toFixed(2).split(".");
    var int = parts[0];
    var dec = parts[1];
    var last3 = int.slice(-3);
    var rest = int.slice(0, -3);
    if (rest) last3 = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
    // trim trailing .00 for cleanliness
    if (dec !== "00") last3 += "." + dec;
    return (neg ? "-" : "") + last3;
  }

  function money(n) {
    return FS.CURRENCY + group(roundMoney(n));
  }

  function qty(n) {
    n = roundQty(n);
    return (Number.isInteger(n) ? n : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")).toString();
  }

  // ---- Dates ----
  function todayISO() {
    return toISODate(new Date());
  }
  function toISODate(d) {
    if (!(d instanceof Date) || isNaN(d)) d = new Date(d);
    var m = ("0" + (d.getMonth() + 1)).slice(-2);
    var day = ("0" + d.getDate()).slice(-2);
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function nowISO() { return new Date().toISOString(); }

  // Parse an ISO date (yyyy-mm-dd) or datetime to a Date at local midnight
  function parseDate(s) {
    if (!s) return null;
    if (typeof s === "string" && s.length === 10) {
      var p = s.split("-");
      return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }
    var d = new Date(s);
    return isNaN(d) ? null : d;
  }

  // Format for display: dd/mm/yyyy
  function fmtDate(s) {
    var d = parseDate(s);
    if (!d) return "—";
    return ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + d.getFullYear();
  }
  function fmtDateTime(s) {
    var d = s ? new Date(s) : null;
    if (!d || isNaN(d)) return "—";
    var h = d.getHours(), m = ("0" + d.getMinutes()).slice(-2);
    var ap = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return fmtDate(toISODate(d)) + " " + h + ":" + m + " " + ap;
  }

  function daysUntil(s) {
    var d = parseDate(s);
    if (!d) return null;
    var today = parseDate(todayISO());
    return Math.round((d - today) / 86400000);
  }

  function monthKey(s) {
    var d = parseDate(s);
    if (!d) return "";
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
  }
  function monthLabel(key) {
    if (!key) return "";
    var p = key.split("-");
    var names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return names[Number(p[1]) - 1] + " " + p[0];
  }

  // Indian cropping season for a date: Kharif (Jun-Nov) or Rabi (Dec-May, spans two years).
  function seasonOf(s) {
    var d = parseDate(s);
    if (!d) return { key: "other", label: "Other", sort: 0 };
    var y = d.getFullYear(), m = d.getMonth() + 1;
    if (m >= 6 && m <= 11) return { key: "K" + y, label: "Kharif " + y, sort: y * 100 + 6 };
    var startY = (m === 12) ? y : y - 1;
    return { key: "R" + startY, label: "Rabi " + startY + "-" + String(startY + 1).slice(2), sort: startY * 100 + 12 };
  }

  // ---- Strings / HTML ----
  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms || 250);
    };
  }

  // ---- Files ----
  function downloadJSON(filename, data) {
    var blob = new Blob([typeof data === "string" ? data : JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function readFileJSON(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        try { resolve(JSON.parse(r.result)); }
        catch (e) { reject(new Error("Invalid JSON file")); }
      };
      r.onerror = function () { reject(new Error("Could not read file")); };
      r.readAsText(file);
    });
  }

  function readFileDataURL(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error("Could not read file")); };
      r.readAsDataURL(file);
    });
  }

  // Downscale an image file to a small JPEG data URL for inline thumbnails.
  // Falls back to the full data URL if the canvas is unavailable or decoding fails.
  function imgThumb(file, max, quality) {
    max = max || 256; quality = quality || 0.82;
    return readFileDataURL(file).then(function (full) {
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          try {
            var scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
            var w = Math.max(1, Math.round((img.width || max) * scale));
            var hh = Math.max(1, Math.round((img.height || max) * scale));
            var c = document.createElement("canvas");
            c.width = w; c.height = hh;
            var ctx = c.getContext("2d");
            ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, hh);
            ctx.drawImage(img, 0, 0, w, hh);
            resolve(c.toDataURL("image/jpeg", quality));
          } catch (e) { resolve(full); }
        };
        img.onerror = function () { resolve(full); };
        img.src = full;
      });
    });
  }

  // Return v only if it is a data:image URL safe to place in an <img src>.
  function safeImgSrc(v) {
    return (typeof v === "string" && /^data:image\//i.test(v)) ? v : "";
  }

  function downloadText(filename, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function titleCase(s) {
    if (!s) return "";
    return String(s).replace(/\w\S*/g, function (t) { return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(); });
  }

  // ---- CSV ----
  function csvCell(v) {
    if (v == null) return "";
    if (typeof v === "number") return isFinite(v) ? (Number.isInteger(v) ? String(v) : String(round(v, 4))) : "";
    var s = String(v);
    // A leading =, +, @, tab or CR would make Excel run the cell as a formula.
    // A leading - is only safe for plain numbers (e.g. -5, -1.25); anything else
    // like "-1+1" is treated as a formula, so prefix it with an apostrophe.
    if (/^[=+@\t\r]/.test(s) || (/^-/.test(s) && !/^-?\d*\.?\d+$/.test(s))) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(rows) {
    return (rows || []).map(function (r) {
      return (r || []).map(csvCell).join(",");
    }).join("\r\n");
  }

  // BOM keeps Excel from mangling ₹ and other non-ASCII text.
  function downloadCSV(filename, rows) {
    downloadText(filename, "\uFEFF" + toCSV(rows), "text/csv;charset=utf-8");
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { legacyCopy(text); });
    }
    return new Promise(function (resolve, reject) {
      try { legacyCopy(text); resolve(); } catch (e) { reject(e); }
    });
  }

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (!ok) throw new Error("Copy not supported here");
  }

  function safeName(s) {
    return String(s || "").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "export";
  }

  /* ---- Multilingual invoice labels (English + regional scripts) ---- */
  var LANGS = [
    { code: "en", label: "English" },
    { code: "hi", label: "हिंदी (Hindi)" },
    { code: "mr", label: "मराठी (Marathi)" },
    { code: "te", label: "తెలుగు (Telugu)" }
  ];
  var I18N = {
    invoice: { en: "INVOICE", hi: "बिल", mr: "बीजक", te: "ఇన్‌వాయిస్" },
    item: { en: "Item", hi: "वस्तु", mr: "वस्तू", te: "వస్తువు" },
    batch: { en: "Batch", hi: "बैच", mr: "", te: "బ్యాచ్" },
    qty: { en: "Qty", hi: "मात्रा", mr: "प्रमाण", te: "పరిమాణం" },
    rate: { en: "Rate", hi: "दर", mr: "", te: "ధర" },
    amount: { en: "Amount", hi: "राशि", mr: "रक्कम", te: "మొత్తం" },
    subtotal: { en: "Subtotal", hi: "उप-योग", mr: "", te: "ఉప మొత్తం" },
    discount: { en: "Discount", hi: "छूट", mr: "सवलत", te: "తగ్గింపు" },
    tax: { en: "Tax", hi: "कर", mr: "कर", te: "పన్ను" },
    total: { en: "Total", hi: "कुल", mr: "एकूण", te: "మొత్తం" },
    customer: { en: "Customer", hi: "ग्राहक", mr: "ग्राहक", te: "కస్టమర్" },
    date: { en: "Date", hi: "दिनांक", mr: "दिनांक", te: "తేదీ" },
    ph: { en: "Ph", hi: "फ़ोन", mr: "दूरध्वनी", te: "ఫోన్" },
    paidVia: { en: "Paid via", hi: "भुगतान", mr: "देयक", te: "చెల్లింపు" },
    due: { en: "Due", hi: "बाकी", mr: "बाकी", te: "బకాయి" },
    thank: { en: "Thank you for your business!", hi: "आपके व्यवसाय के लिए धन्यवाद!", mr: "आपल्या व्यवसायाबद्दल धन्यवाद!", te: "మీ వ్యాపారానికి ధన్యవాదాలు!" },
    custCopy: { en: "Customer Copy", hi: "ग्राहक प्रति", mr: "", te: "కస్టమర్ కాపీ" },
    ownCopy: { en: "Owner Copy", hi: "दुकान प्रति", mr: "दुकान प्रत", te: "అమ్మకందారు కాపీ" },
    antidote: { en: "Antidote", hi: "प्रतिषेध (एंटीडोट)", mr: "प्रतिविष", te: "యాంటీడోట్" },
    phi: { en: "Wait before harvest", hi: "कटाई से पहले प्रतीक्षा", mr: "कापणीपूर्वी प्रतीक्षा", te: "కోతకు ముందు వేచి" },
    toxicity: { en: "Toxicity", hi: "विषाक्तता", mr: "विषबाधा", te: "విషపూరితం" },
    cash: { en: "Cash", hi: "नकद", mr: "रोख", te: "నగదు" },
    credit: { en: "Credit", hi: "उधार", mr: "", te: "మొత్తంపై" },
    scanPay: { en: "Scan to pay (UPI)", hi: "स्कैन कर भुगतान करें", mr: "स्कॅन कर भुगतान करा", te: "స్కాన్ చేసి చెల్లించండి" },
  };
  // Bilingual label: regional script first, English after a slash. English-only
  // (or unknown key) returns just the English text.
  function t(key, lang) {
    var e = I18N[key];
    if (!e) return key;
    var en = e.en;
    if (!lang || lang === "en") return en;
    var reg = e[lang];
    if (!reg || reg === en) return en;
    return reg + " / " + en;
  }
  // Map a stored toxicity class string ("Class I (Red)" …) to a signal color.
  function toxicityColor(cls) {
    var c = String(cls || "").toLowerCase();
    if (c.indexOf("red") >= 0) return "red";
    if (c.indexOf("yellow") >= 0) return "yellow";
    if (c.indexOf("blue") >= 0) return "blue";
    if (c.indexOf("green") >= 0) return "green";
    return "";
  }

  // ---- UPI payment QR helpers ----
  // Build a UPI deep link (dynamic: encodes payee VPA + exact amount). Returns
  // "" when no payee VPA is supplied so callers can skip the QR entirely.
  function upiURI(o) {
    var pa = String((o && o.pa) || "").trim();
    if (!pa) return "";
    var q = [
      "pa=" + encodeURIComponent(pa),
      "pn=" + encodeURIComponent(((o.pn || "").trim()) || "Shop")
    ];
    var am = Number(o.am);
    if (am > 0) q.push("am=" + am.toFixed(2));   // omitted → permanent, amount-free QR
    q.push("cu=INR");
    if (o.tn) q.push("tn=" + encodeURIComponent(o.tn));
    return "upi://pay?" + q.join("&");
  }
  // Render `text` as a crisp inline SVG QR (no <img>/data-URL, prints cleanly,
  // CSP-safe). Requires the bundled `qrcode` global; returns "" if unavailable.
  function qrSvg(text, px) {
    if (!text || typeof window === "undefined" || typeof window.qrcode !== "function") return "";
    try {
      var qr = window.qrcode(0, "M");
      qr.addData(text, "Byte");
      qr.make();
      var cells = qr.getModuleCount();
      var scale = Math.max(2, Math.floor((px || 130) / cells));
      var margin = scale * 2;
      var dim = cells * scale + margin * 2;
      var d = "";
      for (var r = 0; r < cells; r++) {
        for (var c = 0; c < cells; c++) {
          if (qr.isDark(r, c)) d += "M" + (margin + c * scale) + " " + (margin + r * scale) + "h" + scale + "v" + scale + "h-" + scale + "z";
        }
      }
      return '<svg class="qr-svg" xmlns="http://www.w3.org/2000/svg" width="' + dim + '" height="' + dim +
        '" viewBox="0 0 ' + dim + ' ' + dim + '" shape-rendering="crispEdges" role="img" aria-label="UPI payment QR">' +
        '<rect width="' + dim + '" height="' + dim + '" fill="#ffffff"/><path d="' + d + '" fill="#000000"/></svg>';
    } catch (e) { return ""; }
  }

  FS.util = {
    uid: uid, round: round, roundQty: roundQty, roundMoney: roundMoney, num: num,
    group: group, money: money, qty: qty,
    todayISO: todayISO, toISODate: toISODate, nowISO: nowISO, parseDate: parseDate,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, daysUntil: daysUntil,
    monthKey: monthKey, monthLabel: monthLabel, seasonOf: seasonOf,
    escapeHtml: escapeHtml, debounce: debounce,
    downloadJSON: downloadJSON, readFileJSON: readFileJSON, readFileDataURL: readFileDataURL, downloadText: downloadText,
    imgThumb: imgThumb, safeImgSrc: safeImgSrc,
    csvCell: csvCell, toCSV: toCSV, downloadCSV: downloadCSV, copyText: copyText, safeName: safeName,
    titleCase: titleCase,
    LANGS: LANGS, t: t, toxicityColor: toxicityColor,
    upiURI: upiURI, qrSvg: qrSvg
  };
})(window.FS);
