# CLAUDE.md

Guidance for Claude Code working in this repository.

## Project

An internet speed test PWA, deployed to GitHub Pages from the repo root of `main`.
No build step: `index.html` holds all CSS and JS inline. Same shape as `../tides-app`.

## Commands

```sh
npm start            # python3 -m http.server 8000
npm test             # Playwright suite with both backends mocked
npm run test:live    # real tests against M-Lab and Cloudflare (needs network)
npm run icons        # re-render icons/*.png from icons/icon.svg
```

Run `npm test` after any change to `index.html`. Screenshots land in
`tools/shot-*.png` (gitignored) — look at them after visual changes.

## Architecture

- **Engines** (`runMlab`, `runCloudflare` in `index.html`) share one contract:
  they report through `ctx.phase / ctx.sample / ctx.info`, honour `ctx.signal`
  for Stop, and resolve to `{down, up, ping, jitter, loadedDown, loadedUp, server, ip}`.
  Anything an engine can't measure is `null`, and the UI shows "—".
- **M-Lab NDT7**: locate API → `wss://` download/upload URLs. Download is
  server-timed; upload is client-timed (`CFG.phaseMs`). Final upload uses the
  server's `TCPInfo.BytesReceived`, not the browser's `bufferedAmount` view.
- **Cloudflare**: `GET /__down?bytes=N`, `POST /__up`. Only `cf-meta-ip` is
  readable on `__down`; the colo comes from `cf-meta-colo` on `__up`. The ISP
  name is not exposed to browsers. Upload uses XHR for progress events.
- `CFG` can be overridden via `window.__speedtestConfig`; the test suite uses
  this to shorten phases.
- **Storage**: one `localStorage` key, `speedtest.v1` →
  `{history[], labels[], label, engine}`. History capped at 500.
- **Service worker** ignores cross-origin requests on purpose — it must never
  sit in the path of a throughput measurement.

## Gotchas

- M-Lab requires telling users their results (with IP) are published; the
  notice under the gauge is not optional while M-Lab is selected.
- The `[hidden] { display: none !important }` rule exists because component
  `display` rules otherwise beat the attribute.
- Class names are global; `.empty` once collided between the history empty
  state and the location button.
