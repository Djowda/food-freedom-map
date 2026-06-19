/**
 * DIFP component type definitions and avatar config — warm orange palette.
 */

export const AVATAR_BASE =
    'https://cdn.jsdelivr.net/npm/@djowda/difp@latest/assets/avatars';

export const AVATAR_COUNTS = {
  s:  25, u: 25, f:  9, fa: 9, w:  9,
  r:   9, sp: 9, t:  9, d:  9, a:  9,
};

export const COMPONENT_TYPES = [
  { code: 's',  label: 'Store',      icon: '🏪' },
  { code: 'f',  label: 'Farmer',     icon: '🌾' },
  { code: 'r',  label: 'Restaurant', icon: '🍽️' },
  { code: 'fa', label: 'Factory',    icon: '🏭' },
  { code: 'w',  label: 'Wholesale',  icon: '📦' },
  { code: 'u',  label: 'User',       icon: '👤' },
  { code: 'sp', label: 'Seed',       icon: '🌱' },
  { code: 't',  label: 'Transport',  icon: '🚚' },
  { code: 'd',  label: 'Delivery',   icon: '🛵' },
  { code: 'a',  label: 'Admin',      icon: '⚙️' },
];

export function avatarUrl(typeCode, avatarId) {
  return `${AVATAR_BASE}/${typeCode}/${avatarId}.webp`;
}

export function fallbackAvatarSvg(typeCode) {
  const type = COMPONENT_TYPES.find(t => t.code === typeCode) || COMPONENT_TYPES[0];
  const colors = {
    s:'#f97316', f:'#fbbf24', r:'#ef4444', fa:'#a78bfa',
    w:'#fb923c', u:'#fcd34d', sp:'#86efac', t:'#fdba74',
    d:'#fca5a5', a:'#d97706',
  };
  const bg = colors[typeCode] || '#f97316';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <circle cx="20" cy="20" r="20" fill="${bg}"/>
    <text x="20" y="26" font-size="20" text-anchor="middle" fill="white">${type.icon}</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Warm-orange ring colors per type
export const TYPE_COLORS = {
  s: '#f97316', f: '#fbbf24', r: '#ef4444', fa: '#a78bfa',
  w: '#fb923c', u: '#fcd34d', sp: '#86efac', t: '#fdba74',
  d: '#fca5a5', a: '#d97706',
};

export const DEMO_NAMES = [
  // Arabic (1 remaining)
  'Marché El Baraka',

  // Western / European (French, German, Anglo, Italian)
  'Épicerie de Provence', 'Bauer Schmidt Farm', 'Trattoria Milano',
  'Le Bistro Parisien', 'Green Valley Store', 'City Market',
  'Fresh Hub', 'Community Depot', 'Harvest Hub',
  'Garden Gate', 'Field to Fork', 'Roots Market', 'Sunrise Market',

  // Russian
  'Volga Logistics', 'Ferma Petrov', 'Sibir Market', 'Krasny Cooperative',

  // Chinese
  'Great Wall Wholesale', 'Lotus Garden', 'Dragon Hub', 'Silk Road Market'
];