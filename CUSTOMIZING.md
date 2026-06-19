# Customizing your Food Freedom Map

A walkthrough for forking this repo into your own instance — your own "pad" — with your own product catalog, avatars, colors, logo, and relay.

## 1. Swap in your own products

This is the example most people start with. Two pieces have to match: the CSV row, and an image file named after that row's `id`.

### a) Edit `data/products.csv`

Header row required, with these columns:

```
id,name,brand,description,price,is_available,category,sub_category,image,unit,score
```

| Column | Notes |
|---|---|
| `id` | Integer, must be unique. **This is also the filename your product image must use.** |
| `name` | Shown in the catalog UI. |
| `price` | Plain USD float, e.g. `3.50` (converted to cents internally when a listing is published). |
| `is_available` | `1` or `0`. |
| `category` / `sub_category` | Free text. `category` is used to group items in the listing UI. |
| `image` | Currently informational only — the app always derives the image path from `id` (see below), not this column. Keep it in sync with `id` to avoid confusing future-you. |
| `unit`, `score` | Optional, not rendered by the current UI. |

Example row:

```
101,Organic Tomatoes,Local Farm Co,Vine-ripened tomatoes,3.50,1,Vegetables,Fresh,101.webp,kg,0
```

### b) Add the matching image

Drop a `.webp` file named after the `id` into `src/products/`:

```
src/products/101.webp
```

`productImageUrl()` in `js/products.js` builds the path as `src/products/<id>.webp` automatically — it does not read the CSV's `image` column.

> Format is hardcoded to `.webp`. Convert other formats first, e.g. `cwebp photo.jpg -o 101.webp`.

## 2. Component types & avatars

Open `js/config.js`.

- **`COMPONENT_TYPES`** — the list of roles someone can pick when dropping a pin (Store, Farmer, Restaurant, …). Add, remove, relabel, or re-icon entries here.
- **`TYPE_COLORS`** — the map-pin ring color per type.
- **`AVATAR_BASE`** / **`AVATAR_COUNTS`** — by default this points at `cdn.jsdelivr.net/npm/@djowda/difp@latest/assets/avatars`, i.e. **every fork pulls avatar images from Djowda's own CDN until you change it.** If you're running an independent instance, swap this out:
  1. Host your own avatar images at `<your-base>/<type-code>/<avatar-id>.webp` (e.g. `.../s/1.webp`, `.../s/2.webp`, …).
  2. Point `AVATAR_BASE` at that base URL.
  3. Update `AVATAR_COUNTS` to match how many avatars you actually have per type code — this controls how many options show up in the avatar picker.

## 3. Theme colors

Open `css/style.css` and edit the `:root` block at the top — everything else in the stylesheet references these variables:

```css
--primary:    #f97316;   /* main accent color */
--bg:         #0e0a06;   /* page background */
--map-land:   #c8d8c0;   /* map fill color */
--map-ocean:  #a8c4b8;   /* map ocean color */
```

## 4. Logo & page metadata

- Replace `src/logo.png`, and update the logo link's `href`/`aria-label` in `index.html`.
- The title, meta description, Open Graph/Twitter tags, and JSON-LD block at the top of `index.html` are marked with `<!-- TODO -->` comments — fill in your own domain, name, and social handles there.

## 5. Relay (where pin data is published/read)

Open `js/nostr.js`:

```js
const RELAY_URL = 'wss://relay.damus.io';
```

Point this at any Nostr relay — your own self-hosted relay, or another public one — and your instance reads/writes there instead. Note that pins are public to anyone reading that relay; choosing a different relay doesn't give you private, isolated data on its own.

> The relay's display name is also hardcoded separately in `js/app.js`, in `STATUS_LABELS.connected` (currently `'Connected · relay.damus.io'`). Update that string too, or the status bar will keep showing the old relay name even after you've pointed `RELAY_URL` elsewhere.

## 6. Demo/placeholder names (optional)

`DEMO_NAMES` in `js/config.js` is a list of example business names. It's also the **fallback name** used if someone places a pin without typing one (`app.js` picks one at random) — so this isn't just demo content, it can end up as real pin names on the live map. Swap these for names relevant to your region if you're localizing.

## Don't touch

- **`js/vendor/noble-*.js`** — vendored cryptography libraries used for Nostr key signing. If you need an update, re-vendor a newer release rather than hand-editing.
- **`js/geo.js`** — the spatial grid math. Changing `CELL_SIZE`, `NUM_ROWS`, or `NUM_COLS` changes every grid cell ID in the system — only do this before you have real pin data, since it'll desync from anyone still using the default grid.
