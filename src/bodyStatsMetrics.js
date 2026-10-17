// Everything the Body Stats page computes from the raw DEXA scans:
// chart series per tab, KPI cards, percentile bands, goal pace, and the
// "what to work on" list. Raw values are BodySpec's; derived ones are marked *.

export const LB_KG = 0.45359237;
export const MS_DAY = 86400000;
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dateMs = (d) => new Date(d + 'T00:00:00').getTime();

// region Formatting
export function ageAt(dob, date) {
  if (!dob) return null;
  const [by, bm, bd] = dob.split('-').map(Number);
  const [y, m, d] = date.split('-').map(Number);
  return y - by - ((m < bm || (m === bm && d < bd)) ? 1 : 0);
}

export function fmt(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function signed(v, digits = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const r = Number(v.toFixed(digits));
  if (r === 0) return (0).toFixed(digits);
  return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(digits);
}

/** 'YYYY-MM-DD' -> ['Oct', '2026'] (two-line chart.js category label). */
export const scanLabel = (date) => {
  const [y, m] = date.split('-');
  return [MONTHS_SHORT[Number(m) - 1], y];
};

/** 'YYYY-MM-DD' -> '10/26' (compact single-line label for phone widths). */
export const scanLabelShort = (date) => {
  const [y, m] = date.split('-');
  return `${Number(m)}/${y.slice(2)}`;
};

export function addMonths(date, months) {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + Math.round(months * 30.44));
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}
// endregion

// region Derived indexes (height from the BodySpec intake form)
const heightM = (profile) => (profile?.heightIn || 72) * 0.0254;
export const rsmi = (s, p) => (s.regions.arms.leanLbs + s.regions.legs.leanLbs) * LB_KG / heightM(p) ** 2;
export const ffmi = (s, p) => (s.summary.leanLbs + s.summary.bmcLbs) * LB_KG / heightM(p) ** 2;
export const fmi = (s, p) => s.summary.fatLbs * LB_KG / heightM(p) ** 2;
// endregion

// region Detail chart tabs
// Each series: { id, label, unit, color, get(scan, profile), axis: 'y'|'y2', dash?, on?, ref?, digits? }
export const REGION_META = [
  { id: 'arms', label: 'Arms', color: '#8ab4f8' },
  { id: 'legs', label: 'Legs', color: '#81c995' },
  { id: 'trunk', label: 'Trunk', color: '#f28b82' },
  { id: 'android', label: 'Android (belly)', color: '#fcad70' },
  { id: 'gynoid', label: 'Gynoid (hips)', color: '#c58af9' },
  { id: 'total', label: 'Whole body', color: '#e8eaed' },
];

export const REGION_METRICS = [
  { id: 'fatPct', label: 'Fat %', unit: '%' },
  { id: 'fatLbs', label: 'Fat lbs', unit: 'lbs' },
  { id: 'leanLbs', label: 'Lean lbs', unit: 'lbs' },
];

const BONE_REGIONS = ['head', 'arms', 'legs', 'trunk', 'ribs', 'spine', 'pelvis'];
const BONE_COLORS = ['#9aa0a6', '#8ab4f8', '#81c995', '#f28b82', '#fdd663', '#c58af9', '#fcad70'];

export function tabSeries(tabId, regionMetric = 'fatPct') {
  switch (tabId) {
    case 'regions': {
      const m = REGION_METRICS.find((x) => x.id === regionMetric) || REGION_METRICS[0];
      return {
        axes: { y: m.label },
        series: REGION_META.map((r) => ({
          id: r.id, label: r.label, unit: m.unit, color: r.color, axis: 'y',
          on: r.id !== 'total' || m.id === 'fatPct',
          dash: r.id === 'total' ? [6, 4] : undefined,
          get: (s) => (r.id === 'total' ? s.summary[m.id] : s.regions[r.id]?.[m.id]),
        })),
      };
    }
    case 'visceral':
      return {
        axes: { y: 'Visceral fat (lbs)', y2: 'A/G ratio' },
        series: [
          { id: 'vat', label: 'Visceral fat', unit: 'lbs', color: '#f28b82', get: (s) => s.vatLbs, axis: 'y', on: true, digits: 2 },
          { id: 'ag', label: 'A/G ratio', unit: '', color: '#fcad70', get: (s) => s.agRatio, axis: 'y2', on: true, digits: 2 },
          { id: 'agTarget', label: 'A/G target 1.0', unit: '', color: '#80868b', get: () => 1, axis: 'y2', dash: [3, 3], on: true, ref: true, digits: 1 },
          { id: 'vatIn3', label: 'Visceral volume', unit: 'in³', color: '#c58af9', get: (s) => s.vatIn3, axis: 'y', on: false, digits: 2 },
        ],
      };
    case 'balance':
      return {
        axes: { y: 'Right − left (lbs)' },
        series: [
          { id: 'armLean', label: 'Arms lean R−L', unit: 'lbs', color: '#8ab4f8', get: (s) => s.limbs.rightArm.leanLbs - s.limbs.leftArm.leanLbs, axis: 'y', on: true },
          { id: 'legLean', label: 'Legs lean R−L', unit: 'lbs', color: '#81c995', get: (s) => s.limbs.rightLeg.leanLbs - s.limbs.leftLeg.leanLbs, axis: 'y', on: true },
          { id: 'armFat', label: 'Arms fat R−L', unit: 'lbs', color: '#c58af9', get: (s) => s.limbs.rightArm.fatLbs - s.limbs.leftArm.fatLbs, axis: 'y', on: false },
          { id: 'legFat', label: 'Legs fat R−L', unit: 'lbs', color: '#fcad70', get: (s) => s.limbs.rightLeg.fatLbs - s.limbs.leftLeg.fatLbs, axis: 'y', on: false },
          { id: 'flagHi', label: 'Flag at +2 lbs', unit: 'lbs', color: '#80868b', get: () => 2, axis: 'y', dash: [3, 3], on: true, ref: true },
          { id: 'flagLo', label: 'Flag at −2 lbs', unit: 'lbs', color: '#80868b', get: () => -2, axis: 'y', dash: [3, 3], on: true, ref: true },
        ],
      };
    case 'bone':
      return {
        axes: { y: 'BMD (g/cm²)', y2: 'Score (SD)' },
        series: [
          { id: 'bmd', label: 'Total BMD', unit: 'g/cm²', color: '#e8eaed', get: (s) => s.bone?.total, axis: 'y', on: true, digits: 3 },
          { id: 'z', label: 'Z-score', unit: '', color: '#81c995', get: (s) => s.bone?.zScore, axis: 'y2', dash: [6, 4], on: true },
          { id: 't', label: 'T-score', unit: '', color: '#8ab4f8', get: (s) => s.bone?.tScore, axis: 'y2', dash: [2, 3], on: false },
          ...BONE_REGIONS.map((r, i) => ({
            id: 'bmd_' + r, label: r[0].toUpperCase() + r.slice(1) + ' BMD', unit: 'g/cm²', color: BONE_COLORS[i],
            get: (s) => s.bone?.[r], axis: 'y', on: false, digits: 3,
          })),
        ],
      };
    case 'metabolic':
      return {
        axes: { y: 'cal/day', y2: 'kg/m²' },
        series: [
          { id: 'rmr', label: 'Resting metabolic rate', unit: 'cal', color: '#fdd663', get: (s) => s.rmr, axis: 'y', on: true, digits: 0 },
          { id: 'ffmi', label: 'Fat-free mass index*', unit: 'kg/m²', color: '#81c995', get: (s, p) => ffmi(s, p), axis: 'y2', on: true },
          { id: 'fmi', label: 'Fat mass index*', unit: 'kg/m²', color: '#f28b82', get: (s, p) => fmi(s, p), axis: 'y2', on: true },
          { id: 'rsmi', label: 'Limb muscle index*', unit: 'kg/m²', color: '#8ab4f8', get: (s, p) => rsmi(s, p), axis: 'y2', on: false, digits: 2 },
        ],
      };
    default:
      return { axes: {}, series: [] };
  }
}

export const TABS = [
  { id: 'regions', label: 'Regions' },
  { id: 'visceral', label: 'Belly & Visceral' },
  { id: 'balance', label: 'Left / Right' },
  { id: 'bone', label: 'Bone' },
  { id: 'metabolic', label: 'Metabolic' },
];
// endregion

// region KPI cards (better: 'down' | 'up' | null = neutral)
export const KPIS = [
  { id: 'fatPct', label: 'Body fat', unit: '%', get: (s) => s.summary.fatPct, better: 'down', digits: 1, color: '#fdd663' },
  { id: 'weight', label: 'Weight', unit: 'lbs', get: (s) => s.summary.totalLbs, better: null, digits: 1, color: '#8ab4f8' },
  { id: 'lean', label: 'Lean mass', unit: 'lbs', get: (s) => s.summary.leanLbs, better: 'up', digits: 1, color: '#81c995' },
  { id: 'fat', label: 'Fat mass', unit: 'lbs', get: (s) => s.summary.fatLbs, better: 'down', digits: 1, color: '#f28b82' },
  { id: 'vat', label: 'Visceral fat', unit: 'lbs', get: (s) => s.vatLbs, better: 'down', digits: 2, color: '#f28b82' },
  { id: 'ag', label: 'A/G ratio', unit: '', get: (s) => s.agRatio, better: 'down', digits: 2, color: '#fcad70' },
  { id: 'rmr', label: 'RMR', unit: 'cal', get: (s) => s.rmr, better: null, digits: 0, color: '#fdd663' },
  { id: 'z', label: 'Bone Z-score', unit: '', get: (s) => s.bone?.zScore, better: 'up', digits: 1, color: '#81c995' },
];

/** Best scan for a KPI among `scans` (null when the KPI has no direction). */
export function bestOf(kpi, scans) {
  if (!kpi.better) return null;
  let best = null;
  for (const s of scans) {
    const v = kpi.get(s);
    if (v === null || v === undefined) continue;
    if (!best || (kpi.better === 'down' ? v < best.v : v > best.v)) best = { v, date: s.date };
  }
  return best;
}
// endregion

// region Body-fat percentile bands (BodySpec chart, men)
const MEN_BF = [
  { from: 0, to: 29, cuts: [16, 20, 24, 27] },
  { from: 30, to: 39, cuts: [18, 22, 26, 30] },
  { from: 40, to: 49, cuts: [20, 24, 27, 31] },
  { from: 50, to: 59, cuts: [21, 25, 29, 33] },
  { from: 60, to: 200, cuts: [21, 25, 30, 33] },
];
const BANDS = ['0–20th', '20–40th', '40–60th', '60–80th', '80–99th'];
export const BAND_COLORS = ['#81c995', '#a8dab5', '#fdd663', '#fcad70', '#f28b82'];

export function fatBand(age, fatPct) {
  const row = MEN_BF.find((r) => age >= r.from && age <= r.to) || MEN_BF[0];
  let i = row.cuts.findIndex((c) => fatPct < c);
  if (i === -1) i = 4;
  const ageLabel = row.from === 0 ? '20–29' : row.to === 200 ? '60+' : `${row.from}–${row.to}`;
  return { band: BANDS[i], index: i, cuts: row.cuts, ageLabel };
}

/** Bands for an age as [{ lo, hi, label, color }] in body-fat %. */
export function bandsFor(age) {
  const row = MEN_BF.find((r) => age >= r.from && age <= r.to) || MEN_BF[0];
  const edges = [6, ...row.cuts, 38];
  return BANDS.map((label, i) => ({ lo: edges[i], hi: edges[i + 1], label, color: BAND_COLORS[i] }));
}

/** Colour for a fat % (green lean -> yellow -> red); used by the body map. */
const FAT_STOPS = [[12, [129, 201, 149]], [20, [253, 214, 99]], [28, [242, 139, 130]], [38, [217, 48, 37]]];
export function fatColor(pct) {
  if (pct === null || pct === undefined) return '#3c3f47';
  if (pct <= FAT_STOPS[0][0]) return `rgb(${FAT_STOPS[0][1].join(',')})`;
  for (let i = 1; i < FAT_STOPS.length; i++) {
    const [p1, c1] = FAT_STOPS[i];
    const [p0, c0] = FAT_STOPS[i - 1];
    if (pct <= p1) {
      const t = (pct - p0) / (p1 - p0);
      return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * t)).join(',')})`;
    }
  }
  return `rgb(${FAT_STOPS[FAT_STOPS.length - 1][1].join(',')})`;
}
// endregion

// region Goal maths
/** Fat to lose (lbs) to reach `pct` body fat if lean + bone stay where they are. */
export function fatToLose(s, pct) {
  const keep = s.summary.leanLbs + s.summary.bmcLbs;
  const target = (pct / 100) * keep / (1 - pct / 100);
  return s.summary.fatLbs - target;
}

/**
 * Pace of the current stretch: from the fattest scan in the 30 months before
 * `scan` up to `scan`. Returns { from, months, fatPerMonth, leanPerMonth, pctPerMonth } or null.
 */
export function recentPace(scan, history) {
  const t = dateMs(scan.date);
  const window = history.filter((s) => s.date < scan.date && t - dateMs(s.date) <= 913 * MS_DAY);
  if (!window.length) return null;
  const from = window.reduce((b, s) => (s.summary.fatPct > b.summary.fatPct ? s : b));
  const months = (t - dateMs(from.date)) / (30.44 * MS_DAY);
  if (months < 1) return null;
  return {
    from, months,
    fatPerMonth: (scan.summary.fatLbs - from.summary.fatLbs) / months,
    leanPerMonth: (scan.summary.leanLbs - from.summary.leanLbs) / months,
    pctPerMonth: (scan.summary.fatPct - from.summary.fatPct) / months,
  };
}
// endregion

// region What to work on — judged on the selected scan, one line each
// status: 'work' | 'watch' | 'good'
export function focusAreas(scan, history, profile) {
  if (!scan) return [];
  const idx = history.findIndex((s) => s.date === scan.date);
  const prev = idx > 0 ? history[idx - 1] : null;
  const upTo = history.slice(0, idx + 1);
  const bf = scan.summary.fatPct;
  const out = [];
  const trend = (now, before, digits, lowerIsBetter, unit = '') =>
    before === undefined || before === null ? {} : { trend: signed(now - before, digits) + unit, trendGood: lowerIsBetter ? now <= before : now >= before };

  // Belly fat
  const a = scan.androidPct, ag = scan.agRatio;
  out.push({ id: 'belly', title: 'Belly fat', value: `A/G ${fmt(ag, 2)}`,
    status: ag >= 1 && a > bf ? 'work' : ag >= 1 || a > bf ? 'watch' : 'good',
    ...trend(ag, prev?.agRatio, 2, true),
    line: `Belly ${fmt(a)}% vs body ${fmt(bf)}%. Target: belly under body fat, A/G under 1.0.` });

  // Visceral fat
  const vat = scan.vatLbs;
  const vatLow = upTo.reduce((b, s) => (s.vatLbs < b.vatLbs ? s : b));
  out.push({ id: 'vat', title: 'Visceral fat', value: `${fmt(vat, 2)} lbs`,
    status: vat - vatLow.vatLbs > 0.75 ? 'work' : vat - vatLow.vatLbs > 0.25 ? 'watch' : 'good',
    ...trend(vat, prev?.vatLbs, 2, true, ' lbs'),
    line: `Organ fat. Your low was ${fmt(vatLow.vatLbs, 2)} lbs (${vatLow.date}); target as low as possible.` });

  // Lean mass vs peak
  const lean = scan.summary.leanLbs;
  const peak = upTo.reduce((b, s) => (s.summary.leanLbs > b.summary.leanLbs ? s : b));
  const gap = lean - peak.summary.leanLbs;
  out.push({ id: 'lean', title: 'Lean mass', value: `${fmt(lean)} lbs`,
    status: gap < -3 ? 'work' : gap < -1 ? 'watch' : 'good',
    ...trend(lean, prev?.summary.leanLbs, 1, false, ' lbs'),
    line: gap < 0 ? `${fmt(-gap)} lbs under your peak (${fmt(peak.summary.leanLbs)}, ${peak.date}). Keep it while cutting.` : 'Highest lean mass on record.' });

  // Left / right balance
  const armD = scan.limbs.rightArm.leanLbs - scan.limbs.leftArm.leanLbs;
  const legD = scan.limbs.rightLeg.leanLbs - scan.limbs.leftLeg.leanLbs;
  const worst = Math.max(Math.abs(armD), Math.abs(legD));
  out.push({ id: 'balance', title: 'Left / right', value: `${fmt(worst)} lbs`,
    status: worst > 2 ? 'work' : worst > 1 ? 'watch' : 'good',
    line: `Lean R−L: arms ${signed(armD)}, legs ${signed(legD)}. BodySpec flags over 2 lbs.` });

  // Bone
  const z = scan.bone?.zScore;
  if (z !== undefined && z !== null) {
    out.push({ id: 'bone', title: 'Bone density', value: `Z ${fmt(z)}`,
      status: z >= 1 ? 'good' : z >= 0 ? 'watch' : 'work',
      ...trend(z, prev?.bone?.zScore, 1, false),
      line: `Total BMD ${fmt(scan.bone.total, 3)} g/cm². Z 2.0–2.5 = stronger than 97–99% of men your age.` });
  }

  // Limb muscle (derived)
  const r = rsmi(scan, profile);
  out.push({ id: 'rsmi', title: 'Limb muscle*', value: fmt(r, 2),
    status: r >= 7.26 ? 'good' : 'work',
    ...(prev ? trend(r, rsmi(prev, profile), 2, false) : {}),
    line: 'Arm + leg lean ÷ height² (kg/m²). Men: above 7.26.' });

  const order = { work: 0, watch: 1, good: 2 };
  return out.sort((x, y) => order[x.status] - order[y.status]);
}
// endregion
