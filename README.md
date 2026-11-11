# Speed

A simple internet speed test — download, upload, ping, jitter and **latency under
load** — as an installable web app for Mac, iPhone and iPad.

**Live:** https://richfdrums.github.io/speed-test/

To install: open the link, then *Share → Add to Home Screen* (iPhone/iPad) or
*File → Add to Dock* (Safari on Mac).

## What it does

- One-tap test with a live gauge and throughput graph.
- Plain-language verdicts: streaming, video calls, gaming, big downloads, backups.
- **History** on the device, with download/upload sparklines.
- **Location labels** ("Office", "Kitchen") so you can compare spots in the house
  and filter history by them.
- Opens offline (history still browsable); the test itself needs a connection.

## Two test backends

GitHub Pages is static, so the bytes have to come from someone else's servers.
Pick one with the switch at the top right.

| | **M-Lab NDT7** (default) | **Cloudflare** |
|---|---|---|
| Servers | [Measurement Lab](https://www.measurementlab.net/), the same network behind Google's speed test | speed.cloudflare.com |
| Transport | One WebSocket each way, ~10 s | 4 parallel downloads / 3 uploads over HTTPS, 10 s each |
| Ping | Server's TCP `MinRTT` | Median of 20 tiny requests, minus Cloudflare's reported server time |
| Jitter | — | Mean change between consecutive pings |
| Under load | Server's TCP RTT during download | Pings sent during download and upload |
| Shows | Server city, your IP | Cloudflare data centre code, your IP |
| Privacy | **M-Lab publishes every result, including your IP, as open data.** | [Cloudflare privacy policy](https://www.cloudflare.com/privacypolicy/) |

Expect the two to differ somewhat, and both to differ from speedtest.net: each
measures to a different server over a different route. On very fast links
(around 1 Gbps and up) the browser itself becomes the limit, especially for
upload on iPhone.

## Layout

```
index.html              the whole app — inline CSS and JS, no build step
manifest.webmanifest    PWA manifest
sw.js                   service worker: caches the app shell, never touches test traffic
icons/                  icon.svg + rasterised PNGs (npm run icons)
tools/
  test_app.js           Playwright suite (backends mocked); --live runs real tests
  make_icons.js         renders icons/icon.svg to the PNG sizes
package.json            dev-only: Playwright. The app ships no JS dependencies.
```

## Develop

```sh
npm run setup        # once: Playwright + Chromium
npm start            # http://localhost:8000
npm test             # mocked suite, ~30 s
npm run test:live    # one real test per backend, prints the numbers
```

Opening `index.html` via `file://` won't register the service worker; use the
local server.

## Deploy

GitHub Pages serves the repository root of `main`. Push and it's live within a
minute or two. Installed apps pick up the new version on next launch (the
service worker fetches `index.html` network-first).
