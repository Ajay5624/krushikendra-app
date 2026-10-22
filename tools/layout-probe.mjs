// Headless layout probe: screenshots each view at the counter Pad's landscape
// CSS size (1334x800) and reports the widest empty gutter per view.
// Usage: node tools/layout-probe.mjs [width] [height]
import { writeFileSync } from "node:fs";

const W = Number(process.argv[2] || 1334);
const H = Number(process.argv[3] || 800);
const OUT = "build/fs-audit";

const VIEWS = ["dashboard", "pos", "sales", "customers", "credit", "products",
  "purchases", "payables", "suppliers", "stockhist", "reports", "settings"];

const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = list.find(t => t.type === "page");
if (!page) throw new Error("no page target");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const queue = [];
ws.addEventListener("message", ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  else queue.push(m);
});
await new Promise(r => ws.addEventListener("open", r));
const send = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method, params }));
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

await send("Page.enable");
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://127.0.0.1:4173/" });
await sleep(3000);

async function evaljs(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

const report = [];
for (const v of VIEWS) {
  await evaljs(`document.querySelector('.nav-item[data-view="${v}"]').click(); 1`);
  await sleep(700);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/${v}.png`, Buffer.from(shot.data, "base64"));
  const m = await evaljs(`(function(){
    var vw = window.innerWidth;
    var c = document.querySelector(".content");
    var kids = c ? [...c.children] : [];
    var last = 0, first = vw;
    kids.forEach(function(k){ var r = k.getBoundingClientRect(); if (r.width) { first = Math.min(first, r.left); last = Math.max(last, r.right); } });
    var cs = c ? getComputedStyle(c) : null;
    var bot = 0;
    kids.forEach(function(k){ var r = k.getBoundingClientRect(); if (r.height) bot = Math.max(bot, r.bottom); });
    var vh = window.innerHeight;
    return JSON.stringify({
      contentW: c ? Math.round(c.getBoundingClientRect().width) : 0,
      padL: cs ? cs.paddingLeft : "-", padR: cs ? cs.paddingRight : "-",
      firstChildLeft: Math.round(first), lastChildRight: Math.round(last),
      deadRight: Math.round(vw - last), docScrollW: document.documentElement.scrollWidth, vw: vw,
      contentH: c ? Math.round(c.getBoundingClientRect().height) : 0,
      lastChildBottom: Math.round(bot), deadBottom: Math.round(vh - bot), vh: vh,
      pageScrollH: document.documentElement.scrollHeight
    });
  })()`);
  report.push({ view: v, ...JSON.parse(m) });
  const kids = await evaljs(`(function(){var c=document.querySelector(".content");return [...c.children].map(function(k,i){var r=k.getBoundingClientRect();return i+":"+k.tagName.toLowerCase()+"."+(k.className||"").split(" ").join(".")+" h="+Math.round(r.height)+" bot="+Math.round(r.bottom);}).join("  |  ");})()`);
  console.log(`\n${v}\n  ${kids}`);
}
console.log(`viewport ${W}x${H}`);
for (const r of report) console.log(
  `${r.view.padEnd(11)} content=${r.contentW}x${r.contentH} lastRight=${r.lastChildRight} deadR=${r.deadRight}` +
  ` | lastBottom=${r.lastChildBottom} deadBottom=${r.deadBottom} pageH=${r.pageScrollH}`);
ws.close();
