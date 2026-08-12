import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 760, height: 1100 }, deviceScaleFactor: 2 });
await p.goto("http://localhost:3000/dev-gr-preview", { waitUntil: "networkidle", timeout: 90000 });
await p.waitForSelector(".krowe-gr-task", { timeout: 60000 });
await p.waitForTimeout(1200);
await p.screenshot({ path: process.argv[2], fullPage: true });
await b.close();
