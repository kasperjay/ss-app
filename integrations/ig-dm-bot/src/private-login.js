import { chromium } from "playwright";
import fs from "node:fs/promises";

process.umask(0o077);
const cookiesPath = new URL("../data/cookies.json", import.meta.url);
const browser = await chromium.launch({
  headless: false,
  args: ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage", "--window-size=1280,900"],
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
});
const page = await context.newPage();
await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
console.log("Private Instagram login ready.");
let saved = false;
while (browser.isConnected()) {
  await new Promise(resolve => setTimeout(resolve, 3000));
  if (saved || page.isClosed()) continue;
  const cookies = (await context.cookies()).filter(cookie => cookie.domain === "instagram.com" || cookie.domain.endsWith(".instagram.com"));
  if (!cookies.some(cookie => cookie.name === "sessionid")) continue;
  if (await page.locator('a[href="/kasgotthatsound/"]').count() === 0) continue;
  if (await page.locator('a[href*="/direct/"]').count() === 0) continue;
  try {
    await fs.copyFile(cookiesPath, new URL("../data/cookies.backup.json", import.meta.url));
    await fs.chmod(new URL("../data/cookies.backup.json", import.meta.url), 0o600);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporary = new URL("../data/cookies.pending.json", import.meta.url);
  await fs.writeFile(temporary, JSON.stringify(cookies), { mode: 0o600 });
  await fs.rename(temporary, cookiesPath);
  saved = true;
  console.log("Authenticated kasgotthatsound session saved for bot verification.");
}
