/** Local-only verification server: actual theme templates + synthetic cart data.
 * Never connects to the Shopify Admin API, creates orders, or changes the store.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { ROOT, context, line, product, renderPage, renderSection } from "./test-support/theme-fixtures.js";

const sessions = new Map();
let sequence = 0;
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const send = (status, body, type = "text/html; charset=utf-8") => {
    response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
    response.end(body);
  };
  const json = (status, body) => send(status, JSON.stringify(body), "application/json");
  try {
    if (url.pathname.startsWith("/assets/")) {
      const filename = path.resolve(ROOT, "." + decodeURIComponent(url.pathname));
      const assetRoot = path.resolve(ROOT, "assets") + path.sep;
      if (!filename.startsWith(assetRoot) || !fs.existsSync(filename)) return send(404, "Not found");
      const types = { ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".webp": "image/webp" };
      return send(200, fs.readFileSync(filename), types[path.extname(filename)] || "application/octet-stream");
    }
    let sessionId = request.headers.cookie?.match(/(?:^|;\s*)shopping_preview=(\d+)/)?.[1];
    if (!sessions.has(sessionId)) {
      sessionId = String(++sequence);
      sessions.set(sessionId, { items: [line()], retry: 0 });
      response.setHeader("Set-Cookie", `shopping_preview=${sessionId}; HttpOnly; SameSite=Strict; Path=/`);
    }
    const session = sessions.get(sessionId);
    if (/\/cart\/change(?:\.js)?$/.test(url.pathname) && request.method === "POST") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 10000) return json(413, {});
      }
      const data = JSON.parse(body);
      if (!Number.isInteger(data.quantity) || data.quantity < 0 || !session.items.some((item) => item.key === data.id)) {
        return json(422, { description: "Invalid fixture item" });
      }
      session.items = session.items.map((item) => item.key === data.id
        ? { ...item, quantity: data.quantity, final_line_price: data.quantity * 8000 } : item).filter((item) => item.quantity > 0);
      const ctx = context(session.items);
      return json(200, { ...ctx.cart, sections: { [data.sections[0]]: await renderSection("main-cart", ctx) } });
    }
    const productMatch = url.pathname.match(/^\/products\/([^/]+)\.js$/);
    if (productMatch) {
      const handle = decodeURIComponent(productMatch[1]);
      if (handle === "removed-painting") return json(404, {});
      if (handle === "retry-painting" && session.retry++ === 0) return json(503, {});
      return json(200, product(handle));
    }
    if (["/", "/cart", "/pages/wishlist"].includes(url.pathname)) {
      if (url.searchParams.get("fixture") === "two") session.items = [line(), line("901:second", 1, product("second-painting", 102))];
      if (url.searchParams.get("fixture") === "one") session.items = [line()];
      const type = url.pathname === "/pages/wishlist" ? "main-wishlist" : "main-cart";
      let html = await renderPage(type, context(session.items), { messages: url.searchParams.get("messages") === "1" });
      if (url.searchParams.get("fixture") === "mixed") {
        session.retry = 0;
        html = html.replace("<head>", `<head><script>localStorage.setItem('makeready-wishlist', ${JSON.stringify(JSON.stringify(["101", "999", "removed-painting", "retry-painting"]))});</script>`);
      }
      const fonts = path.join(ROOT, ".shopify/verification/font-face.css");
      if (fs.existsSync(fonts)) html = html.replace("</head>", `<style>${fs.readFileSync(fonts, "utf8")}</style></head>`);
      return send(200, html);
    }
    return send(404, "Local verification only: /cart?fixture=two&messages=1 or /pages/wishlist?fixture=mixed");
  } catch (error) {
    console.error(error);
    send(500, "Local fixture failed. See terminal.");
  }
});

server.listen(4173, "127.0.0.1", () => {
  console.log("Local cart preview: http://127.0.0.1:4173/cart?fixture=two&messages=1");
  console.log("Local wishlist preview: http://127.0.0.1:4173/pages/wishlist?fixture=mixed");
});
