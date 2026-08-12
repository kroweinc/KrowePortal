import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 430, height: 1400 }, deviceScaleFactor: 2 });
await p.goto("http://localhost:3000/dev-gr-preview", { waitUntil: "networkidle", timeout: 90000 });
await p.waitForSelector(".krowe-gr-task", { timeout: 60000 });
await p.locator(".krowe-gr-details-btn").first().click();
await p.waitForTimeout(700);
await p.screenshot({ path: process.argv[2], fullPage: true });
await b.close();
