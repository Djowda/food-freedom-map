/**
 * DIFP Product Catalog — loads /data/products.csv and exposes lookup helpers.
 *
 * CSV columns: id,name,brand,description,price,is_available,category,sub_category,image,unit,score
 * Only id, name, price, category, image are used by the UI.
 */

let PRODUCTS = new Map();   // id (number) -> product record
let PRODUCT_LIST = [];      // ordered array of product records
let loadPromise = null;

const IMG_BASE = 'src/products'; // local preloaded images, e.g. src/products/1.webp

/** Parse a single CSV line respecting simple quoted fields */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Load and parse the products CSV. Safe to call multiple times. */
export function loadProducts(csvUrl = 'data/products.csv') {
  if (loadPromise) return loadPromise;

  loadPromise = fetch(csvUrl)
    .then(res => {
      if (!res.ok) throw new Error(`Failed to fetch ${csvUrl}: ${res.status}`);
      return res.text();
    })
    .then(text => {
      const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
      if (lines.length === 0) return;
      const header = parseCsvLine(lines[0]).map(h => h.trim());
      const idx = {};
      header.forEach((h, i) => { idx[h] = i; });

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        if (cols.length < header.length) continue;

        const id = parseInt(cols[idx['id']], 10);
        if (isNaN(id)) continue;

        const record = {
          id,
          name:        cols[idx['name']]?.trim() || `Item ${id}`,
          brand:       cols[idx['brand']]?.trim() || '',
          description: cols[idx['description']]?.trim() || '',
          priceUsd:    parseFloat(cols[idx['price']]) || 0,
          isAvailable: cols[idx['is_available']]?.trim() === '1',
          category:    cols[idx['category']]?.trim() || '',
          subCategory: cols[idx['sub_category']]?.trim() || '',
          image:       cols[idx['image']]?.trim() || `${id}.webp`,
          unit:        cols[idx['unit']]?.trim() || '',
          score:       parseFloat(cols[idx['score']]) || 0,
        };

        PRODUCTS.set(id, record);
        PRODUCT_LIST.push(record);
      }

      PRODUCT_LIST.sort((a, b) => a.name.localeCompare(b.name));
    })
    .catch(err => {
      console.error('[DIFP] Failed to load products.csv:', err);
      PRODUCTS = new Map();
      PRODUCT_LIST = [];
    });

  return loadPromise;
}

/** Get product record by numeric id */
export function getProduct(id) {
  return PRODUCTS.get(Number(id)) || null;
}

/** Get all loaded products (sorted by name) */
export function getAllProducts() {
  return PRODUCT_LIST;
}

/** Local image path for a product id */
export function productImageUrl(id) {
  // Extract just the numeric part of the ID (e.g., "id1" -> "1")
  const numericId = String(id).replace(/\D/g, '');

  // Force the correct path format
  return `${IMG_BASE}/${numericId}.webp`;
}

/** Display name for a product id (fallback to "Item N" if unknown) */
export function productName(id) {
  const p = PRODUCTS.get(Number(id));
  return p ? p.name : `Item ${id}`;
}

/** Group products by category for UI rendering */
export function getProductsByCategory() {
  const groups = new Map();
  for (const p of PRODUCT_LIST) {
    const cat = p.category || 'Other';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(p);
  }
  return groups;
}
