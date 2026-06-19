# Food Freedom Map

A live, open map of the global food ecosystem. Drop a pin to show you're a farmer, store, restaurant, or community member — no account, no tracking, no central server.

## What it is

A static, dependency-light web app (Leaflet + vanilla ES modules) implementing **DIFP**, an open protocol for food coordination. Anyone can:

- Drop a pin marking themselves as one of 10 component types (Store, Farmer, Restaurant, Factory, Wholesale, User, Seed, Transport, Delivery, Admin)
- Publish a catalog of items they're selling, asking for, or donating
- Browse pins published by anyone else on the network

## How it works

- **Identity** — a Nostr keypair is generated locally in the browser on first visit and kept in `localStorage`. There's no signup.
- **Location** — coordinates are mapped onto a fixed 500m spatial grid (the *MinMax99* grid), so pins resolve to a consistent grid cell rather than raw GPS.
- **Data** — pins and catalogs are signed Nostr events, published to a public relay and read back by any client. There's no backend or database here.
- **Hosting** — everything is static files. Host it anywhere that serves static HTML/CSS/JS.

## Project structure

```
food-freedom-map/
├── index.html
├── css/
│   └── style.css         # theme variables (:root) + all styling
├── js/
│   ├── app.js             # entry point — wires up the map, dialog, and modules below
│   ├── nostr.js            # minimal Nostr client (connect, sign, publish, subscribe)
│   ├── geo.js               # spatial grid math (lat/lng ⇄ cell ⇄ lobby)
│   ├── scanner.js            # scans the relay for pins, feeds the map viewport
│   ├── catalog.js             # encode/decode the compact DIFP catalog format
│   ├── products.js             # loads data/products.csv, exposes product lookups
│   ├── config.js                # component types, avatar config, theme/demo constants
│   └── vendor/                   # vendored crypto deps (noble-curves, noble-hashes)
├── data/
│   └── products.csv               # the product catalog
├── src/
│   ├── logo.png                    # header logo
│   └── products/                    # product images, named <id>.webp
└── assets/
    └── images/                       # favicon, social-share image
```

## Quick start

The app uses ES module imports and fetches `data/products.csv`, so opening `index.html` directly via `file://` won't work in most browsers — serve it over HTTP instead.

```bash
git clone https://github.com/Djowda/food-freedom-map.git
cd food-freedom-map

# any static file server works, e.g.:
python3 -m http.server 8080
# or
npx serve .
```

Then visit `http://localhost:8080`.

## Requirements

- A modern browser (ES modules, WebSocket, Fetch)
- No build step and no `npm install` — Leaflet is the only external dependency, loaded via CDN

## Customizing

Want to fork this into your own branded instance — your own product catalog, avatars, colors, and relay? See **[CUSTOMIZING.md](./CUSTOMIZING.md)**.

## License

_TBD — add your chosen license here (e.g. MIT, AGPL-3.0) before publishing._

## Contributing

Issues and PRs welcome.
