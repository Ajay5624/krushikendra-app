const http = require("http"), fs = require("fs"), path = require("path");
const root = "C:/Users/Ajay/krushikendra-app/src/assets";
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon", ".png": "image/png", ".json": "application/json" };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = path.join(root, path.normalize(p)).replace(/\\/g, "/");
  if (!f.startsWith(root + "/")) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": mime[path.extname(f)] || "application/octet-stream" });
    res.end(d);
  });
}).listen(8931, () => console.log("up on 8931"));
