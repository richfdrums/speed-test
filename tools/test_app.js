/* Verification harness for the Speed app.

   Default: serves the site, mocks both test backends (M-Lab's locate API and
   NDT7 WebSockets, Cloudflare's __down/__up) and drives the real engine code
   in an iPhone-sized Chromium.

   --live: runs one real test against each backend and prints the numbers.
   Needs a network connection; nothing is asserted beyond "it finished". */

const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (e) {
  console.error(
    "\nPlaywright isn't installed.\n\n" +
    "  npm run setup     # npm install + download Chromium\n" +
    "Then run the tests with:  npm test\n"
  );
  process.exit(1);
}

const ROOT = path.resolve(__dirname, "..");
const PORT = 8732;
const ORIGIN = "http://localhost:" + PORT;
const LIVE = process.argv.includes("--live");

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json"
};

function serve() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  }).listen(PORT);
}

/* ---------- mocks ---------- */

const FAST = { phaseMs: 1500, warmupMs: 300, pingCount: 4, cfDownBytes: 200000, cfUpMB: 1 };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "server-timing, cf-meta-ip, cf-meta-colo",
  "timing-allow-origin": "*"
};

async function mockBackends(page, opts = {}) {
  await page.route("https://locate.measurementlab.net/**", route => {
    if (opts.locateStatus) return route.fulfill({ status: opts.locateStatus, headers: CORS, body: "{}" });
    route.fulfill({
      status: 200, headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify({ results: [{
        machine: "mlab1-tst01", location: { city: "Testville", country: "US" },
        urls: {
          "wss:///ndt/v7/download": "wss://ndt.mock.test/ndt/v7/download?access_token=x",
          "wss:///ndt/v7/upload": "wss://ndt.mock.test/ndt/v7/upload?access_token=x"
        }
      }] })
    });
  });

  await page.routeWebSocket("wss://ndt.mock.test/**", ws => {
    const t0 = Date.now();
    if (ws.url().includes("/download")) {
      const chunk = Buffer.alloc(64 * 1024, 7);
      let n = 0;
      const iv = setInterval(() => {
        const ms = Date.now() - t0;
        if (ms > (opts.ndtMs || 1600)) { clearInterval(iv); ws.close(); return; }
        ws.send(chunk);
        if (n++ % 5 === 0) {
          ws.send(JSON.stringify({
            ConnectionInfo: { Client: "203.0.113.9:51234", Server: "x", UUID: "u" },
            TCPInfo: { MinRTT: 12000, RTT: ms > 400 ? 48000 : 14000, ElapsedTime: ms * 1000 }
          }));
        }
      }, 20);
      ws.onClose(() => clearInterval(iv));
    } else {
      let received = 0;
      ws.onMessage(m => { received += typeof m === "string" ? m.length : m.length; });
      const iv = setInterval(() => {
        const us = (Date.now() - t0) * 1000;
        ws.send(JSON.stringify({ TCPInfo: { BytesReceived: received, ElapsedTime: us } }));
      }, 100);
      ws.onClose(() => clearInterval(iv));
    }
  });

  await page.route("https://speed.cloudflare.com/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/__down") {
      const bytes = +url.searchParams.get("bytes") || 0;
      if (bytes > 0) await new Promise(r => setTimeout(r, 30));
      return route.fulfill({
        status: 200,
        headers: { ...CORS, "cf-meta-ip": "198.51.100.7", "server-timing": "cfSpeedEdge;dur=1, cfSpeedWorker;dur=2" },
        body: Buffer.alloc(bytes, 1)
      });
    }
    if (url.pathname === "/__up") {
      return route.fulfill({ status: 200, headers: { ...CORS, "cf-meta-colo": "TST" }, body: "" });
    }
    route.fulfill({ status: 404, headers: CORS, body: "" });
  });
}

/* ---------- harness ---------- */

let failures = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log("  ✓ " + name); }
  else { failures++; console.log("  ✗ " + name + (detail !== undefined ? "  — " + JSON.stringify(detail) : "")); }
}

async function newPage(browser, { width = 390, height = 844, scheme = "light", cfg = FAST, seed = null, mocks = {} } = {}) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2, colorScheme: scheme,
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript(([c, s]) => {
    window.__speedtestConfig = c;
    if (s && !sessionStorage.getItem("seeded")) {
      localStorage.setItem("speedtest.v1", JSON.stringify(s));
      sessionStorage.setItem("seeded", "1");
    }
  }, [cfg, seed]);
  if (cfg) await mockBackends(page, mocks);
  await page.goto(ORIGIN + "/");
  return { page, context, errors };
}

const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem("speedtest.v1") || "{}"));
const text = (page, sel) => page.locator(sel).first().innerText();

async function runAndWait(page) {
  await page.click("#go");
  await page.waitForFunction(() => /Done|Stopped|\S/.test(document.getElementById("status").textContent) &&
    document.getElementById("stop").hidden, null, { timeout: 30000 });
  await page.waitForTimeout(700); // let the gauge settle back to idle
  return text(page, "#status");
}

async function suite(browser) {
  console.log("\nFirst load");
  {
    const { page, context, errors } = await newPage(browser);
    check("title is Speed", (await page.title()) === "Speed");
    check("Start button shown", (await text(page, "#go")) === "Start");
    check("M-Lab is the default engine", await page.getAttribute('[data-engine="mlab"]', "aria-checked") === "true");
    check("M-Lab open-data notice shown", /publishes every result, including your IP/.test(await text(page, "#notice")));
    check("history empty state", await page.isVisible("#hEmpty"));
    check("grades hidden before any test", !(await page.isVisible("#grades")));
    check("no console errors", errors.length === 0, errors);
    await context.close();
  }

  console.log("\nM-Lab test (mocked NDT7)");
  {
    const { page, context, errors } = await newPage(browser);
    const status = await runAndWait(page);
    check("finishes", status === "Done.", status);
    const s = await stored(page);
    const r = (s.history || [])[0] || {};
    check("one run saved", (s.history || []).length === 1);
    check("engine recorded", r.engine === "mlab");
    check("download measured", r.down > 0, r.down);
    check("upload measured (server-side bytes)", r.up > 0, r.up);
    check("ping from TCPInfo.MinRTT", r.ping === 12, r.ping);
    check("loaded latency from TCPInfo.RTT", r.loadedDown === 48, r.loadedDown);
    check("jitter not measured on M-Lab", r.jitter === null);
    check("client IP from ConnectionInfo", r.ip === "203.0.113.9", r.ip);
    check("server city", r.server === "M-Lab · Testville, US", r.server);
    check("tiles filled", (await text(page, "#tDown")) !== "—" && (await text(page, "#tUp")) !== "—");
    check("jitter tile says not measured", /not measured/.test(await text(page, "#tJitterSub")));
    check("bufferbloat caption", /\+36 ms vs idle/.test(await text(page, "#tLoadedSub")), await text(page, "#tLoadedSub"));
    check("grades shown", (await page.locator("#gradeList li").count()) === 5);
    check("history row", (await page.locator(".run").count()) === 1);
    check("button now says Go", (await text(page, "#go")) === "Go");
    check("no console errors", errors.length === 0, errors);
    await page.screenshot({ path: path.join(__dirname, "shot-mlab-light.png"), fullPage: true });
    await context.close();
  }

  console.log("\nCloudflare test (mocked)");
  {
    const { page, context, errors } = await newPage(browser, { scheme: "dark" });
    await page.click('[data-engine="cloudflare"]');
    check("engine switch persists", (await stored(page)).engine === "cloudflare");
    check("Cloudflare notice", /speed\.cloudflare\.com/.test(await text(page, "#notice")));
    const status = await runAndWait(page);
    check("finishes", status === "Done.", status);
    const r = ((await stored(page)).history || [])[0] || {};
    check("engine recorded", r.engine === "cloudflare");
    check("download measured", r.down > 0, r.down);
    check("upload measured", r.up > 0, r.up);
    check("ping measured", r.ping > 0, r.ping);
    check("jitter measured", typeof r.jitter === "number", r.jitter);
    check("loaded latency measured", r.loadedDown > 0 || r.loadedUp > 0, [r.loadedDown, r.loadedUp]);
    check("IP from cf-meta-ip", r.ip === "198.51.100.7", r.ip);
    check("colo from cf-meta-colo", r.server === "Cloudflare · TST", r.server);
    check("no console errors", errors.length === 0, errors);
    await page.screenshot({ path: path.join(__dirname, "shot-cloudflare-dark.png"), fullPage: true });
    await context.close();
  }

  console.log("\nStop mid-test");
  {
    const { page, context } = await newPage(browser, { cfg: { ...FAST, phaseMs: 8000 }, mocks: { ndtMs: 8000 } });
    await page.click("#go");
    await page.waitForFunction(() => document.getElementById("gPhase").textContent === "Download");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(__dirname, "shot-running.png") });
    await page.click("#stop");
    await page.waitForFunction(() => document.getElementById("stop").hidden, null, { timeout: 5000 });
    check("status says Stopped", (await text(page, "#status")) === "Stopped.");
    check("nothing saved", ((await stored(page)).history || []).length === 0);
    check("Start is back", await page.isVisible("#go"));
    await context.close();
  }

  console.log("\nServer failure");
  {
    const { page, context } = await newPage(browser, { mocks: { locateStatus: 429 } });
    const status = await runAndWait(page);
    check("rate-limit message", /rate-limiting/.test(status), status);
    check("error styled", await page.getAttribute("#status", "class") === "status err");
    check("nothing saved", ((await stored(page)).history || []).length === 0);
    await context.close();
  }

  console.log("\nLocation labels");
  {
    const { page, context } = await newPage(browser);
    await page.click("#locBtn");
    check("sheet opens", await page.isVisible("#locDlg"));
    await page.fill("#locInput", "  Office  ");
    await page.keyboard.press("Enter");
    check("sheet closes on add", !(await page.isVisible("#locDlg")));
    check("button shows label", (await text(page, "#locName")) === "Office");
    await runAndWait(page);
    await page.click("#locBtn");
    await page.click('.loc-pick[data-l=""]');
    await runAndWait(page);
    const s = await stored(page);
    check("labelled run", s.history[1].label === "Office", s.history[1].label);
    check("unlabelled run", s.history[0].label === null);
    check("filter chips: All, Office, No location",
      JSON.stringify(await page.locator(".chip").allInnerTexts()) === JSON.stringify(["All", "Office", "No location"]));
    await page.click('.chip:text-is("Office")');
    check("filter narrows list", (await page.locator(".run").count()) === 1);
    check("count follows filter", (await text(page, "#hCount")) === "1 test");
    check("no sparklines for a single run", (await page.isVisible("#sparks")) === false);
    await page.click('.chip:text-is("All")');
    check("sparklines with 2 runs", await page.isVisible("#sparks"));
    await page.click(".run-row >> nth=0");
    check("row expands", await page.isVisible(".run-detail"));
    await page.click("[data-del]");
    check("delete removes run", (await stored(page)).history.length === 1);
    await context.close();
  }

  console.log("\nGrades and formatting (seeded history)");
  {
    const seed = { engine: "cloudflare", label: null, labels: [], history: [
      { t: Date.now(), engine: "cloudflare", label: '<img src=x onerror="window.__xss=1">',
        down: 100, up: 8, ping: 20, jitter: 2.5, loadedDown: 300, loadedUp: 45, server: "Cloudflare · IAD", ip: "1.2.3.4" }
    ] };
    const { page, context } = await newPage(browser, { seed });
    const rows = await page.locator("#gradeList li").allInnerTexts();
    const row = name => rows.find(r => r.startsWith(name)) || "";
    check("latest run shown on load", (await text(page, "#tDown")) === "100");
    check("streaming: 4K several screens", /Great/.test(row("Streaming")) && /several screens/.test(row("Streaming")), row("Streaming"));
    check("gaming flags bufferbloat", /OK/.test(row("Online gaming")) && /300 ms/.test(row("Online gaming")), row("Online gaming"));
    check("50 GB at 100 Mbps ≈ 1 h 7 min", /1 h 7 min/.test(row("Big downloads")), row("Big downloads"));
    check("1 GB at 8 Mbps ≈ 17 min", /17 min/.test(row("Uploads")), row("Uploads"));
    check("under-load tile shows worst direction", (await text(page, "#tLoaded")) === "300");
    check("bufferbloat caption is red", await page.getAttribute("#tLoadedSub", "class") === "sub bad");
    check("label is escaped, not executed", !(await page.evaluate(() => window.__xss)) &&
      /<img/.test(await text(page, ".chips")));
    await context.close();
  }

  console.log("\nLayout");
  for (const [w, h] of [[320, 640], [390, 844], [820, 1180], [1280, 800]]) {
    const { page, context } = await newPage(browser, { width: w, height: h });
    await runAndWait(page);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(w + "px: no horizontal overflow", over <= 0, over);
    if (w === 1280) await page.screenshot({ path: path.join(__dirname, "shot-desktop.png") });
    await context.close();
  }

  console.log("\nOffline");
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(ORIGIN + "/");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();
    check("app loads offline from the service worker", (await page.title()) === "Speed");
    check("Go disabled offline", await page.isDisabled("#go"));
    check("offline message", /offline/.test(await text(page, "#status")));
    await context.setOffline(false);
    await page.waitForFunction(() => !document.getElementById("go").disabled);
    check("re-enabled when back online", true);
    await context.close();
  }
}

async function live(browser) {
  for (const engine of ["mlab", "cloudflare"]) {
    console.log("\nLive " + engine + " test (about 25 s)…");
    const { page, context, errors } = await newPage(browser, { cfg: null, seed: { engine, history: [], labels: [] } });
    const status = await runAndWait(page);
    const r = ((await stored(page)).history || [])[0];
    check(engine + " finished", status === "Done." && !!r, status);
    if (r) console.log("    ↓ " + r.down + " Mbps  ↑ " + r.up + " Mbps  ping " + r.ping + " ms  jitter " + r.jitter +
      "  loaded ↓" + r.loadedDown + " ↑" + r.loadedUp + "  " + r.server + "  " + r.ip);
    check("no console errors", errors.length === 0, errors);
    await context.close();
  }
}

(async () => {
  const server = serve();
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    browser = await chromium.launch({ channel: "chrome" });
  }
  try {
    await (LIVE ? live(browser) : suite(browser));
  } finally {
    await browser.close();
    server.close();
  }
  console.log("\n" + passes + " passed, " + failures + " failed");
  process.exit(failures ? 1 : 0);
})();
