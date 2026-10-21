const fs = require("fs");
const path = require("path");
const out = path.join(__dirname, "src", "assets", "fonts");
fs.mkdirSync(out, { recursive: true });

async function main() {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
  const css = await fetch("https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap", { headers: { "User-Agent": ua } }).then(r => r.text());
  const latin = css.split("/* latin */")[1];
  const url = latin.match(/url\((https:[^)]+\.woff2)\)/)[1];
  const buf = Buffer.from(await (await fetch(url, { headers: { "User-Agent": ua } })).arrayBuffer());
  fs.writeFileSync(path.join(out, "inter-var-latin.woff2"), buf);
  console.log("variable inter latin:", buf.length, "bytes");
}
main().catch(e => { console.error("FAILED", e.message); process.exit(1); });
