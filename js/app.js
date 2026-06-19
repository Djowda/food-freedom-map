/**
 * DIFP World Map — Main Application
 * Warm orange theme + search panel (geo coords / Cell ID)
 * + Tabbed catalog dialog (Listing / Ask / Donation) + online/offline status
 * + Full-network ComponentScanner for accurate pin counts and lazy rendering
 */

import * as geo from './geo.js';
import {
    NostrClient, loadOrGenerateKeypair,
    publishComponent, subscribeComponents, parseComponentEvent,
    publishCatalog, fetchCatalog,
} from './nostr.js';
import {
    COMPONENT_TYPES, AVATAR_COUNTS, avatarUrl, fallbackAvatarSvg,
    TYPE_COLORS, DEMO_NAMES,
} from './config.js';
import {
    loadProducts, getAllProducts, getProductsByCategory,
    getProduct, productImageUrl, productName,
} from './products.js';
import {
    decodeListing, decodeIdList, encodeListing, encodeIdList,
    usdToCents, centsToUsd,
} from './catalog.js';
import {
    ComponentScanner, getVisibleComponents, prioritizeComponents, INITIAL_DISPLAY,
} from './scanner.js';

// Expose geo to nostr.js
window._difpGeo = geo;

// ── State ─────────────────────────────────────────────────────────────────────
let map;
let nostr;
let identity;
let scanner       = null;
let _scannerStarted = false;

const markers          = new Map();
let pendingLatLng      = null;
let selectedType       = 's';
let selectedAvatar     = 1;

// Catalog tab state
let activeCatalogTab   = 'l'; // 'l' | 'a' | 'd'
let onlineStatus       = true;

// User's own catalog selections
const myListing  = new Map();
const myAsk      = new Map();
const myDonation = new Map();

// Currently viewed component (read-only popup) catalog cache
let viewingComp        = null;
let viewCatalogCache   = { l: null, a: null, d: null };

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    identity = loadOrGenerateKeypair();
    loadProducts();
    initMap();
    initNostr();
    initDialog();
    initInfoPopup();
    initSearchPanel();
});

// ── Map ───────────────────────────────────────────────────────────────────────
function initMap() {
    map = L.map('map', {
        center:  [25, 15],
        zoom:    3,
        minZoom: 2,
        maxZoom: 17,
        zoomControl: true,
    });

    // Light tile layer — CSS filter in style.css turns land → sage green,
    // water → muted teal, without touching the warm UI chrome.
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(map);

    map.on('click', onMapClick);
    map.on('moveend zoomend', onViewportChange);
}

// ── Nostr ─────────────────────────────────────────────────────────────────────
function initNostr() {
    nostr = new NostrClient(setStatus);
    nostr.connect();
}

// ── Viewport render — lazy pins from scanner store ────────────────────────────
function onViewportChange() {
    if (!scanner) return;

    const bounds  = map.getBounds();
    const visible = getVisibleComponents(scanner, map, INITIAL_DISPLAY);
    const sorted  = prioritizeComponents(visible); // online-first, then newest

    sorted.forEach(comp => {
        if (!markers.has(comp.id)) {
            addOrUpdateMarker(comp);
        }
    });
}

// ── Scanner ───────────────────────────────────────────────────────────────────
function startScanner() {
    setScanIndicator('loading', 'Scanning network…');

    scanner = new ComponentScanner(nostr, {
        lookbackDays : 30,
        limit        : 5_000,
        batchSize    : 50,

        onProgress(loaded) {
            updateCounter(loaded);
        },

        onBatch(batch) {
            const bounds = map.getBounds();
            batch.forEach(comp => {
                if (markers.has(comp.id)) return;
                // Show pin if we haven't hit the initial display cap yet,
                // or if it falls inside the current viewport.
                if (markers.size < INITIAL_DISPLAY || _compInBounds(comp, bounds)) {
                    addOrUpdateMarker(comp);
                }
            });
            updateCounter(scanner.count);
        },

        onComplete(all) {
            setScanIndicator('done', `${all.length.toLocaleString()} components`);
            updateCounter(all.length);
            // One final pass to fill in viewport pins that arrived after last batch
            onViewportChange();
        },
    });

    scanner.start();
}

// ── Markers ───────────────────────────────────────────────────────────────────
function addOrUpdateMarker(comp) {
    if (markers.has(comp.id)) {
        updateMarkerPopup(markers.get(comp.id), comp);
        return;
    }

    // Resolve lat/lng — scanner pre-computes _latLng lazily; fall back to geo
    let lat, lng;
    if (comp._latLng) {
        ({ lat, lng } = comp._latLng);
    } else {
        const [xCell, yCell] = geo.cellToXY(comp.cellId);
        const x   = (xCell + 0.5) * geo.CELL_SIZE;
        const y   = (yCell + 0.5) * geo.CELL_SIZE;
        lng = (x / geo.EARTH_W) * 360 - 180;
        const latRad = 2 * Math.atan(Math.exp((geo.EARTH_H / 2 - y) * 2 * Math.PI / geo.EARTH_H)) - Math.PI / 2;
        lat = latRad * 180 / Math.PI;
        comp._latLng = { lat, lng };
    }

    if (lat < -85 || lat > 85) return;

    const marker = L.marker([lat, lng], {
        icon: buildIcon(comp),
        riseOnHover: true,
    });

    marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        showInfoPopup(comp);
    });

    marker.addTo(map);
    markers.set(comp.id, marker);
    marker._difpComp = comp;
}

function buildIcon(comp) {
    const typeColor = TYPE_COLORS[comp.type] || '#f97316';
    const imgSrc    = avatarUrl(comp.type, comp.avatarId);
    const fallback  = fallbackAvatarSvg(comp.type);

    const html = `
    <div class="difp-marker">
      <img
        src="${imgSrc}"
        class="type-${comp.type}"
        style="border-color:${typeColor}"
        onerror="this.src='${fallback}'"
        alt="${comp.name}"
      />
      <div class="pin-tail"></div>
      <div class="pin-dot"></div>
    </div>`;

    return L.divIcon({ html, className: '', iconSize: [44, 54], iconAnchor: [22, 54] });
}

function updateMarkerPopup(marker, comp) {
    marker.setIcon(buildIcon(comp));
    marker._difpComp = comp;
}

// ── Helper: check if a component's cell falls inside Leaflet bounds ───────────
function _compInBounds(comp, bounds) {
    if (!comp._latLng) {
        try {
            comp._latLng = geo.cellToLatLng(comp.cellId);
        } catch { return false; }
    }
    return comp._latLng && bounds.contains([comp._latLng.lat, comp._latLng.lng]);
}

// ── Map click ─────────────────────────────────────────────────────────────────
function onMapClick(e) {
    pendingLatLng = e.latlng;
    openDialog(e.latlng);
}

// ── Dialog (own pin: tabbed catalog editor) ────────────────────────────────────
function initDialog() {
    const typeGrid = document.getElementById('type-grid');
    COMPONENT_TYPES.forEach(t => {
        const btn = document.createElement('button');
        btn.className    = 'type-btn' + (t.code === selectedType ? ' active' : '');
        btn.dataset.code = t.code;
        btn.innerHTML    = `<span class="type-icon">${t.icon}</span><span class="type-name">${t.label}</span>`;
        btn.addEventListener('click', () => selectType(t.code));
        typeGrid.appendChild(btn);
    });

    document.getElementById('dialog-close').addEventListener('click', closeDialog);
    document.getElementById('dialog-backdrop').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeDialog();
    });
    document.getElementById('btn-place-pin').addEventListener('click', onPlacePin);

    // Online/offline status toggle
    document.getElementById('status-toggle').addEventListener('change', (e) => {
        onlineStatus = e.target.checked;
        updateStatusLabel();
    });
    updateStatusLabel();

    // Catalog tabs
    document.querySelectorAll('.catalog-tab').forEach(tab => {
        tab.addEventListener('click', () => selectCatalogTab(tab.dataset.tab));
    });

    // Ask / Donation panel toggles
    document.getElementById('ask-toggle').addEventListener('change', () => renderAskList());
    document.getElementById('donation-toggle').addEventListener('change', () => renderDonationList());

    // Product search inputs per tab
    document.getElementById('listing-search').addEventListener('input', (e) => renderListingItems(e.target.value));
    document.getElementById('ask-search').addEventListener('input', (e) => renderAskList(e.target.value));
    document.getElementById('donation-search').addEventListener('input', (e) => renderDonationList(e.target.value));

    renderAvatarGrid(selectedType);
    updateAvatarPreview();
    selectCatalogTab('l');

    loadProducts().then(() => {
        renderListingItems();
        renderAskList();
        renderDonationList();
    });
}

function openDialog(latlng) {
    document.getElementById('dialog-coords').textContent =
        `${latlng.lat.toFixed(5)}°,  ${latlng.lng.toFixed(5)}°`;
    document.getElementById('dialog-backdrop').classList.add('open');
    document.getElementById('input-name').focus();
}

function closeDialog() {
    document.getElementById('dialog-backdrop').classList.remove('open');
    resetDialog();
}

function resetDialog() {
    document.getElementById('btn-label').textContent = '📍 Place my pin';
    document.getElementById('btn-spinner').classList.add('hidden');
    document.getElementById('btn-place-pin').disabled = false;
}

function selectType(code) {
    selectedType   = code;
    selectedAvatar = 1;
    document.querySelectorAll('.type-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.code === code);
    });
    renderAvatarGrid(code);
    updateAvatarPreview();
    document.getElementById('avatar-badge').textContent = code.toUpperCase().slice(0, 2);
}

function renderAvatarGrid(typeCode) {
    const grid  = document.getElementById('avatar-grid');
    const count = AVATAR_COUNTS[typeCode] || 9;
    grid.innerHTML = '';
    for (let i = 1; i <= count; i++) {
        const img       = document.createElement('img');
        img.src         = avatarUrl(typeCode, i);
        img.className   = 'avatar-opt' + (i === selectedAvatar ? ' active' : '');
        img.alt         = `Avatar ${i}`;
        img.dataset.id  = String(i);
        img.onerror     = () => { img.src = fallbackAvatarSvg(typeCode); };
        img.addEventListener('click', () => selectAvatar(i));
        grid.appendChild(img);
    }
}

function selectAvatar(id) {
    selectedAvatar = id;
    document.querySelectorAll('.avatar-opt').forEach(img => {
        img.classList.toggle('active', Number(img.dataset.id) === id);
    });
    updateAvatarPreview();
}

function updateAvatarPreview() {
    const preview   = document.getElementById('avatar-preview');
    preview.src     = avatarUrl(selectedType, selectedAvatar);
    preview.onerror = () => { preview.src = fallbackAvatarSvg(selectedType); };
    preview.style.borderColor = TYPE_COLORS[selectedType] || '#f97316';
}

// ── Status toggle ─────────────────────────────────────────────────────────────
function updateStatusLabel() {
    const label = document.getElementById('status-toggle-label');
    label.textContent = onlineStatus ? '🟢 Online / Open' : '🔴 Offline / Closed';
    label.classList.toggle('status-on',  onlineStatus);
    label.classList.toggle('status-off', !onlineStatus);
}

// ── Catalog tabs ──────────────────────────────────────────────────────────────
function selectCatalogTab(tab) {
    activeCatalogTab = tab;
    document.querySelectorAll('.catalog-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });
    document.querySelectorAll('.catalog-panel').forEach(p => {
        p.classList.toggle('active', p.dataset.tab === tab);
    });
}

// ── Listing tab ───────────────────────────────────────────────────────────────
function renderListingItems(filter = '') {
    const container = document.getElementById('listing-items');
    const groups    = getProductsByCategory();
    const term      = filter.trim().toLowerCase();
    container.innerHTML = '';
    let any = false;

    for (const [category, products] of groups) {
        const filtered = term
            ? products.filter(p => p.name.toLowerCase().includes(term))
            : products;
        if (filtered.length === 0) continue;
        any = true;

        const catEl = document.createElement('div');
        catEl.className   = 'catalog-category';
        catEl.textContent = category;
        container.appendChild(catEl);

        filtered.forEach(p => {
            const existing = myListing.get(p.id);
            const row      = document.createElement('div');
            row.className  = 'catalog-row';

            const isAvail = existing ? existing.available : false;
            const price   = existing ? existing.price     : p.priceUsd;

            row.innerHTML = `
        <img class="catalog-row-img" src="${productImageUrl(p.id)}" alt="${p.name}"
             onerror="this.src='${fallbackAvatarSvg('s')}'" />
        <div class="catalog-row-body">
          <div class="catalog-row-name">${p.name}</div>
          <div class="catalog-row-unit">${p.unit || ''}</div>
        </div>
        <div class="catalog-row-price">
          <span class="price-currency">$</span>
          <input type="number" class="price-input" min="0" step="0.01"
                 value="${price.toFixed(2)}" data-id="${p.id}"
                 ${isAvail ? '' : 'disabled'} />
        </div>
        <label class="row-switch">
          <input type="checkbox" class="avail-toggle" data-id="${p.id}" ${isAvail ? 'checked' : ''} />
          <span class="row-switch-slider"></span>
        </label>
      `;

            const priceInput  = row.querySelector('.price-input');
            const availToggle = row.querySelector('.avail-toggle');

            availToggle.addEventListener('change', () => {
                const avail    = availToggle.checked;
                priceInput.disabled = !avail;
                const priceVal = parseFloat(priceInput.value) || 0;
                myListing.set(p.id, { price: priceVal, available: avail });
            });

            priceInput.addEventListener('input', () => {
                const priceVal = parseFloat(priceInput.value) || 0;
                const avail    = availToggle.checked;
                myListing.set(p.id, { price: priceVal, available: avail });
            });

            container.appendChild(row);
        });
    }

    if (!any) {
        container.innerHTML = '<div class="catalog-empty">No items match your search.</div>';
    }
}

// ── Ask tab ───────────────────────────────────────────────────────────────────
function renderAskList(filter = '') {
    renderIdListPanel('ask-items', myAsk, filter, document.getElementById('ask-toggle').checked);
}

// ── Donation tab ──────────────────────────────────────────────────────────────
function renderDonationList(filter = '') {
    renderIdListPanel('donation-items', myDonation, filter, document.getElementById('donation-toggle').checked);
}

function renderIdListPanel(containerId, stateMap, filter, panelEnabled) {
    const container = document.getElementById(containerId);
    const groups    = getProductsByCategory();
    const term      = filter.trim().toLowerCase();
    container.innerHTML = '';
    container.classList.toggle('disabled', !panelEnabled);
    let any = false;

    for (const [category, products] of groups) {
        const filtered = term
            ? products.filter(p => p.name.toLowerCase().includes(term))
            : products;
        if (filtered.length === 0) continue;
        any = true;

        const catEl = document.createElement('div');
        catEl.className   = 'catalog-category';
        catEl.textContent = category;
        container.appendChild(catEl);

        filtered.forEach(p => {
            const active  = !!stateMap.get(p.id);
            const row     = document.createElement('div');
            row.className = 'catalog-row catalog-row-simple';

            row.innerHTML = `
        <img class="catalog-row-img" src="${productImageUrl(p.id)}" alt="${p.name}"
             onerror="this.src='${fallbackAvatarSvg('s')}'" />
        <div class="catalog-row-body">
          <div class="catalog-row-name">${p.name}</div>
          <div class="catalog-row-unit">${p.unit || ''}</div>
        </div>
        <label class="row-switch">
          <input type="checkbox" class="id-toggle" data-id="${p.id}"
                 ${active ? 'checked' : ''} ${panelEnabled ? '' : 'disabled'} />
          <span class="row-switch-slider"></span>
        </label>
      `;

            row.querySelector('.id-toggle').addEventListener('change', (e) => {
                stateMap.set(p.id, e.target.checked);
            });

            container.appendChild(row);
        });
    }

    if (!any) {
        container.innerHTML = '<div class="catalog-empty">No items match your search.</div>';
    }
}

// ── Place pin + publish component & catalogs ───────────────────────────────────
async function onPlacePin() {
    if (!pendingLatLng) return;
    if (!nostr.connected) {
        showToast('⚠️ Not connected — please wait a moment', 'err');
        return;
    }

    const name = document.getElementById('input-name').value.trim()
        || DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)];

    document.getElementById('btn-label').textContent = 'Publishing…';
    document.getElementById('btn-spinner').classList.remove('hidden');
    document.getElementById('btn-place-pin').disabled = true;

    try {
        const cellId  = geo.geoToCell(pendingLatLng.lat, pendingLatLng.lng);
        const lobbyId = geo.cellToLobby(cellId);

        const askEnabled      = document.getElementById('ask-toggle').checked;
        const donationEnabled = document.getElementById('donation-toggle').checked;

        const comp = {
            name, type: selectedType, avatarId: selectedAvatar,
            cellId, phone: '',
            status: onlineStatus,
            listedAsAsk: askEnabled,
            listedAsDonation: donationEnabled,
        };

        // 1) Publish presence event
        publishComponent(nostr, identity.pubKeyHex, identity.privKey, comp);

        // 2) Publish listing catalog (always, even if empty)
        const listingPayload = encodeListing(
            new Map([...myListing.entries()].map(([id, e]) => [id, { price: usdToCents(e.price), available: e.available }]))
        );
        publishCatalog(nostr, identity.pubKeyHex, identity.privKey, 'l', listingPayload);

        // 3) Publish ask catalog if enabled
        if (askEnabled) {
            publishCatalog(nostr, identity.pubKeyHex, identity.privKey, 'a', encodeIdList(myAsk));
        }

        // 4) Publish donation catalog if enabled
        if (donationEnabled) {
            publishCatalog(nostr, identity.pubKeyHex, identity.privKey, 'd', encodeIdList(myDonation));
        }

        // Add locally so the user sees their own pin immediately
        const localComp = {
            id: identity.pubKeyHex, name,
            type: selectedType, avatarId: selectedAvatar,
            cellId, status: onlineStatus,
            listedAsAsk: askEnabled, listedAsDonation: donationEnabled,
            createdAt: Math.floor(Date.now() / 1000),
            _latLng: null,
        };
        addOrUpdateMarker(localComp);
        updateCounter();

        closeDialog();
        showToast(`✅ Pin placed! Lobby ${lobbyId}`, 'ok');

    } catch (err) {
        showToast(`❌ ${err.message}`, 'err');
        resetDialog();
    }
}

// ── Search Panel ───────────────────────────────────────────────────────────────
function initSearchPanel() {
    document.getElementById('search-header').addEventListener('click', () => {
        const body = document.getElementById('search-body');
        const icon = document.getElementById('search-toggle-icon');
        body.classList.toggle('collapsed');
        icon.classList.toggle('open');
    });

    document.getElementById('search-btn').addEventListener('click', doSearch);

    ['search-coords', 'search-cellid'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', (e) => {
            if (e.key === 'Enter') doSearch();
        });
    });
}

function doSearch() {
    const coordsVal = document.getElementById('search-coords').value.trim();
    const cellVal   = document.getElementById('search-cellid').value.trim();
    const resultEl  = document.getElementById('search-result');

    resultEl.className    = 'search-result';
    resultEl.style.display = 'none';

    let lat, lng, cellId;

    try {
        if (cellVal) {
            cellId = BigInt(cellVal);
            const pos = geo.cellToLatLng(cellId);
            lat = pos.lat; lng = pos.lng;

            if (lat < -85 || lat > 85 || lng < -180 || lng > 180) {
                throw new Error('Cell ID out of bounds');
            }

            resultEl.textContent = `Cell ${cellId} → ${lat.toFixed(4)}°, ${lng.toFixed(4)}°`;
            resultEl.className   = 'search-result show ok';

        } else if (coordsVal) {
            const parts = coordsVal.split(/[,\s]+/).map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
            if (parts.length < 2) throw new Error('Enter lat, lng (e.g. 36.74, 3.09)');
            [lat, lng] = parts;
            if (lat < -90 || lat > 90)   throw new Error('Latitude must be −90 to 90');
            if (lng < -180 || lng > 180) throw new Error('Longitude must be −180 to 180');

            cellId = geo.geoToCell(lat, lng);
            resultEl.textContent = `Cell ${cellId}`;
            resultEl.className   = 'search-result show ok';

        } else {
            resultEl.textContent = 'Enter coordinates or a Cell ID';
            resultEl.className   = 'search-result show err';
            return;
        }

        map.flyTo([lat, lng], Math.max(map.getZoom(), 12), { duration: 1.4 });

        // After flying, onViewportChange fires automatically via 'moveend' —
        // the scanner store is already populated so new pins appear instantly.

    } catch (err) {
        resultEl.textContent = '⚠ ' + err.message;
        resultEl.className   = 'search-result show err';
    }
}

// ── Info popup (click existing pin) ───────────────────────────────────────────
function initInfoPopup() {
    document.getElementById('info-popup-close').addEventListener('click', () => {
        document.getElementById('info-popup').classList.remove('open');
    });

    document.querySelectorAll('.view-catalog-tab').forEach(tab => {
        tab.addEventListener('click', () => selectViewCatalogTab(tab.dataset.tab));
    });
}

function showInfoPopup(comp) {
    const type = COMPONENT_TYPES.find(t => t.code === comp.type) || COMPONENT_TYPES[0];
    const img  = document.getElementById('info-avatar');
    img.src    = avatarUrl(comp.type, comp.avatarId);
    img.onerror = () => { img.src = fallbackAvatarSvg(comp.type); };

    document.getElementById('info-name').textContent = comp.name || 'Unknown';
    document.getElementById('info-type').textContent = `${type.icon} ${type.label}`;
    document.getElementById('info-cell').textContent =
        `Cell ${comp.cellId} · ${comp.status ? '🟢 Open' : '🔴 Closed'}`;

    viewingComp      = comp;
    viewCatalogCache = { l: null, a: null, d: null };

    const askTab = document.querySelector('.view-catalog-tab[data-tab="a"]');
    const donTab = document.querySelector('.view-catalog-tab[data-tab="d"]');
    askTab.classList.toggle('hidden', !comp.listedAsAsk);
    donTab.classList.toggle('hidden', !comp.listedAsDonation);

    selectViewCatalogTab('l');
    document.getElementById('info-popup').classList.add('open');
}

function selectViewCatalogTab(tab) {
    document.querySelectorAll('.view-catalog-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tab);
    });

    const resultsEl = document.getElementById('view-catalog-results');
    resultsEl.innerHTML = '<div class="catalog-loading">Loading…</div>';

    if (!viewingComp) return;

    if (viewCatalogCache[tab] !== null) {
        renderViewCatalog(tab, viewCatalogCache[tab]);
        return;
    }

    fetchCatalog(
        nostr,
        viewingComp.id,
        tab,
        (rawPayload) => {
            try {
                if (tab === 'l') {
                    viewCatalogCache.l = decodeListing(rawPayload);
                } else if (tab === 'a') {
                    viewCatalogCache.a = decodeIdList(rawPayload);
                } else if (tab === 'd') {
                    viewCatalogCache.d = decodeIdList(rawPayload);
                }
            } catch {
                viewCatalogCache[tab] = [];
            }
        },
        () => {
            const activeTab = document.querySelector('.view-catalog-tab.active')?.dataset.tab;
            if (activeTab === tab) renderViewCatalog(tab, viewCatalogCache[tab] || []);
        },
    );
}

function renderViewCatalog(tab, data) {
    const resultsEl = document.getElementById('view-catalog-results');
    resultsEl.innerHTML = '';

    if (!data || data.length === 0) {
        const labels = {
            l: 'No items currently listed.',
            a: 'No items requested.',
            d: 'No items offered as donation.',
        };
        resultsEl.innerHTML = `<div class="catalog-empty">${labels[tab] || 'Nothing here yet.'}</div>`;
        return;
    }

    if (tab === 'l') {
        data.forEach(entry => {
            const name = productName(entry.productId);
            const img  = productImageUrl(entry.productId);
            const usd  = centsToUsd(entry.price);
            const row  = document.createElement('div');
            row.className = 'view-catalog-item';
            row.innerHTML = `
        <img class="view-catalog-img" src="${img}" alt="${name}"
             onerror="this.src='${fallbackAvatarSvg('s')}'" />
        <div class="view-catalog-name">${name}</div>
        <div class="view-catalog-price">$${usd.toFixed(2)}</div>
      `;
            resultsEl.appendChild(row);
        });
    } else {
        data.forEach(productId => {
            const name = productName(productId);
            const img  = productImageUrl(productId);
            const row  = document.createElement('div');
            row.className = 'view-catalog-item';
            row.innerHTML = `
        <img class="view-catalog-img" src="${img}" alt="${name}"
             onerror="this.src='${fallbackAvatarSvg('s')}'" />
        <div class="view-catalog-name">${name}</div>
      `;
            resultsEl.appendChild(row);
        });
    }
}

// ── Counter ───────────────────────────────────────────────────────────────────
function updateCounter(total) {
    const n = total ?? (scanner ? scanner.count : markers.size);
    document.getElementById('pin-count').textContent = n.toLocaleString();
    const pct = Math.min((n / 1_000_000) * 100, 100);
    document.getElementById('progress-bar').style.width = `${pct}%`;
}

// ── Scan indicator badge ──────────────────────────────────────────────────────
function setScanIndicator(state, label) {
    const dot  = document.querySelector('.scan-dot');
    const span = document.querySelector('.scan-indicator span');
    if (!dot || !span) return;
    dot.className    = `scan-dot ${state}`;
    span.textContent = label;
}

// ── Status ────────────────────────────────────────────────────────────────────
const STATUS_LABELS = {
    connecting:   'Connecting to Nostr relay…',
    connected:    'Connected · relay.damus.io',
    disconnected: 'Disconnected — reconnecting…',
    error:        'Connection error — retrying…',
};

function setStatus(status) {
    document.getElementById('status-dot').className    = `status-dot ${status}`;
    document.getElementById('status-text').textContent = STATUS_LABELS[status] || status;

    // Start the full-network scanner once on first successful connection
    if (status === 'connected' && !_scannerStarted) {
        _scannerStarted = true;
        startScanner();
    }
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className   = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}