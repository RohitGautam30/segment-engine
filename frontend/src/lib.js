/* Shared helpers: tiers, formatting, the API→view-model adapter, and the
   same template renderer the backend uses. */

export const DAY = 86400000;

/* The four lifecycle stages, in funnel order. */
export const STAGES = [
  { key: 'SIGNED_UP', label: 'Signed up', shade: '#B9BFC9' },
  { key: 'PROFILE_COMPLETE', label: 'Profile complete', shade: '#8E9AAF' },
  { key: 'ADDED_TO_CART', label: 'Added to cart', shade: '#6E5BC7' },
  { key: 'ORDERED', label: 'Ordered', shade: '#4F32D9' },
];
export const stageLabel = (k) => STAGES.find((s) => s.key === k)?.label || 'Signed up';

export const TIERS = [
  { name: 'PLATINUM', min: 750, metal: '#5B7C99' },
  { name: 'GOLD', min: 500, metal: '#C79A2B' },
  { name: 'SILVER', min: 250, metal: '#8E9AAF' },
  { name: 'BRONZE', min: 0, metal: '#A15C2B' },
];

export const tierFor = (s) => TIERS.find((t) => s >= t.min) || TIERS[3];
export const tierColor = (name) => (TIERS.find((t) => t.name === name) || TIERS[3]).metal;

export const inr = (n) =>
  '₹' + (n >= 100000 ? (n / 100000).toFixed(1) + 'L' : n >= 1000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n));
export const inrFull = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
export const pct = (n) => (Math.round(n * 10) / 10).toFixed(1) + '%';

export function ago(ts) {
  if (!ts) return 'never';
  const d = Math.floor((Date.now() - ts) / DAY);
  if (d <= 0) return 'today';
  if (d === 1) return '1d ago';
  if (d < 30) return d + 'd ago';
  return Math.floor(d / 30) + 'mo ago';
}

/** Flattens the API's nested user document into what the views want. */
export function adaptUser(u) {
  const ms = (v) => (v ? new Date(v).getTime() : null);
  const lastActivityAt = ms(u.stats?.lastActivityAt) || ms(u.createdAt);
  const purchaseCount = u.stats?.purchaseCount || 0;
  const totalRevenue = u.stats?.totalRevenue || 0;

  return {
    id: u.id || u._id,
    externalId: u.externalId || '—',
    email: u.email,
    firstName: u.profile?.firstName || '',
    lastName: u.profile?.lastName || '',
    displayName:
      [u.profile?.firstName, u.profile?.lastName].filter(Boolean).join(' ') || u.email.split('@')[0],
    city: u.profile?.city || '—',
    country: u.profile?.country || '—',
    source: u.source || 'unknown',
    category: u.stats?.topCategory || '', 
    stage: u.stats?.lifecycleStage || 'SIGNED_UP',
    stageLabel: stageLabel(u.stats?.lifecycleStage),
    status: u.status,
    role: u.role,
    completion: u.profile?.completion || 0,
    score: Math.round(u.score?.value || 0),
    tier: u.score?.tier || 'BRONZE',
    breakdown: u.score?.breakdown || {},
    productViews: u.stats?.productViews || 0,
    cartAdds: u.stats?.cartAdds || 0,
    purchaseCount,
    totalRevenue,
    aov: u.stats?.averageOrderValue || (purchaseCount ? totalRevenue / purchaseCount : 0),
    lastActivityAt,
    daysIdle: lastActivityAt ? Math.floor((Date.now() - lastActivityAt) / DAY) : 999,
    createdAt: ms(u.createdAt),
    emailConsent: u.consent?.email !== false,
    lastContactedAt: ms(u.lastContactedAt),
    tags: u.tags || [],
  };
}

/* Mirrors template.service.js: {{ path }} with an optional | default:value */
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*default\s*:\s*([^}]*?)\s*)?\}\}/g;

export function renderTemplate(tpl, user) {
  const ctx = {
    user: {
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.displayName,
      city: user.city,
      tier: user.tier,
      score: user.score,
      purchaseCount: user.purchaseCount,
      completion: user.completion,
      category: user.category,
      stage: user.stageLabel,
    },
  };
  return String(tpl || '').replace(TOKEN_RE, (_m, path, fallback) => {
    const val = path.split('.').reduce((a, k) => (a == null ? a : a[k]), ctx);
    return val == null || val === '' ? fallback ?? '' : String(val);
  });
}

export const TOKENS = [
  'user.firstName', 'user.tier', 'user.score',
  'user.city', 'user.category', 'user.stage', 'user.completion',
];

export const EMPTY_FILTERS = {
  q: '',
  status: 'ACTIVE',
  tiers: [],
  categories: [],
  cities: [],
  stages: [],
  scoreMin: 0,
  scoreMax: 1000,
  minCompletion: 0,
  buyersOnly: false,
  consentOnly: false,
  idleMin: 0,
};

export function applyFilters(users, f) {
  const q = f.q.trim().toLowerCase();
  return users.filter((u) => {
    if (f.status !== 'ALL' && u.status !== f.status) return false;
    if (q && !`${u.displayName} ${u.email} ${u.externalId}`.toLowerCase().includes(q)) return false;
    if (f.tiers.length && !f.tiers.includes(u.tier)) return false;
    if (f.stages.length && !f.stages.includes(u.stage)) return false;
    if (f.categories.length && !f.categories.includes(u.category)) return false;
    if (f.cities.length && !f.cities.includes(u.city)) return false;
    if (u.score < f.scoreMin || u.score > f.scoreMax) return false;
    if (u.completion < f.minCompletion) return false;
    if (f.buyersOnly && u.purchaseCount === 0) return false;
    if (f.consentOnly && !u.emailConsent) return false;
    if (u.daysIdle < f.idleMin) return false;
    return true;
  });
}

/** Cumulative totals for whatever slice is currently selected. */
export function summarise(rows, allCount) {
  const revenue = rows.reduce((a, u) => a + u.totalRevenue, 0);
  const orders = rows.reduce((a, u) => a + u.purchaseCount, 0);
  const buyers = rows.filter((u) => u.purchaseCount > 0).length;
  const avgScore = rows.length ? rows.reduce((a, u) => a + u.score, 0) / rows.length : 0;
  const avgCompletion = rows.length ? rows.reduce((a, u) => a + u.completion, 0) / rows.length : 0;
  const reachable = rows.filter((u) => u.emailConsent && u.status === 'ACTIVE').length;

  const weeks = 26;
  const now = Date.now();
  const buckets = new Array(weeks).fill(0);
  rows.forEach((u) => {
    const w = weeks - 1 - Math.floor((now - u.createdAt) / (7 * DAY));
    if (w >= 0 && w < weeks) buckets[w] += 1;
  });
  let run = 0;
  const cumulative = buckets.map((b) => (run += b));

  const tierCounts = TIERS.map((t) => ({ ...t, n: rows.filter((u) => u.tier === t.name).length }));

  // Funnel view: each stage counts everyone who reached it or went further,
  // so 'added to cart' includes the people who went on to order.
  const atStage = STAGES.map((s) => rows.filter((u) => u.stage === s.key).length);
  let running = 0;
  const reached = atStage.map(() => 0);
  for (let i = STAGES.length - 1; i >= 0; i -= 1) { running += atStage[i]; reached[i] = running; }
  let prev = null;
  const funnel = STAGES.map((s, i) => {
    const conv = prev ? (reached[i] / prev) * 100 : 100;
    prev = reached[i] || prev;
    return { ...s, atStage: atStage[i], reached: reached[i], conversion: conv };
  });

  return {
    revenue, orders, buyers, avgScore, avgCompletion, reachable,
    cumulative, tierCounts, funnel, share: allCount ? (rows.length / allCount) * 100 : 0,
  };
}
