import http from "node:http";
import fs from "node:fs/promises";

export function serveLogin(page, status) {
  return http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && ["/", "/vnc.html"].includes(path)) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.end(await fs.readFile(new URL("./login.html", import.meta.url)));
      }
      if (req.method === "GET" && path === "/frame") {
        res.setHeader("Content-Type", "image/jpeg");
        return res.end(await page.screenshot({ type: "jpeg", quality: 75 }));
      }
      if (req.method === "GET" && path === "/status") {
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ saved: status() }));
      }
      if (req.method === "POST" && path === "/input") {
        if (req.headers["x-login-input"] !== "1" || !req.headers["content-type"]?.startsWith("application/json")) {
          res.writeHead(403); return res.end();
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 8192) { res.writeHead(413); return res.end(); }
        }
        const input = JSON.parse(body);
        if (input.type === "click" && Number.isFinite(input.x) && Number.isFinite(input.y)) {
          await page.mouse.click(Math.max(0, Math.min(1279, input.x)), Math.max(0, Math.min(799, input.y)));
        } else if (input.type === "text" && typeof input.text === "string") {
          await page.keyboard.insertText(input.text);
        } else if (input.type === "key" && ["Tab", "Enter", "Backspace", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "ControlOrMeta+A"].includes(input.key)) {
          await page.keyboard.press(input.key);
        } else if (input.type === "scroll" && Number.isFinite(input.y)) {
          await page.mouse.wheel(0, Math.max(-800, Math.min(800, input.y)));
        } else { res.writeHead(400); return res.end(); }
        return res.end("ok");
      }
      res.writeHead(404); res.end();
    } catch {
      res.writeHead(500); res.end("Browser request failed");
    }
  }).listen(Number(process.env.PORT), "127.0.0.1");
}
