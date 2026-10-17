import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { ref, onValue, set as fbSet } from 'firebase/database';
import { database } from './firebase';
import DateInput from './DateInput';
import { useBodyStats } from './useBodyStats';
import { useIsMobile } from './useIsMobile';
import {
  TABS, KPIS, REGION_METRICS, MS_DAY,
  tabSeries, bestOf, focusAreas, ageAt, dateMs, fmt, signed, scanLabel, scanLabelShort, addMonths,
  fatBand, bandsFor, fatColor, fatToLose, recentPace,
} from './bodyStatsMetrics';
import './TotalsView.css';
import './BodyStatsView.css';

Chart.register(...registerables, ChartDataLabels);

const GAP_DAYS = 400; // consecutive scans further apart than this get a gap marker
const COMPARE = [
  { id: 'prev', short: 'Previous', label: 'previous scan' },
  { id: 'first', short: 'First', label: 'first scan in range' },
  { id: 'best', short: 'Best', label: 'personal best' },
];
const GOAL_PATH = 'meta/uiPrefs/bodyFatGoal';

// region Chart plumbing
/** Create the chart once, then update it in place when deps change. */
function useChart(canvasRef, build, deps) {
  const inst = useRef(null);
  useEffect(() => {
    if (!canvasRef.current) return;
    const config = build();
    if (!config) return;
    if (inst.current) {
      // Plugins are fixed at creation (Chart.js v4); they read their inputs from
      // options.plugins.<id>, which is what changes here.
      inst.current.data = config.data;
      inst.current.options = config.options;
      inst.current.update();
    } else {
      inst.current = new Chart(canvasRef.current.getContext('2d'), config);
    }
  }, deps);
  useEffect(() => () => { inst.current?.destroy(); inst.current = null; }, []);
}

const isGap = (scans, i) => i + 1 < scans.length && dateMs(scans[i + 1].date) - dateMs(scans[i].date) > GAP_DAYS * MS_DAY;

// Chart plugins: fixed objects that read their inputs from options.plugins.<id>.

/** Dashed divider + "N-yr gap" label between scans far apart in time. options: { dates } */
const gapPlugin = {
  id: 'scanGaps',
  beforeDatasetsDraw(chart, _args, opts) {
    const scans = (opts.dates || []).map((date) => ({ date }));
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    for (let i = 0; i < scans.length - 1; i++) {
      if (!isGap(scans, i)) continue;
      const x = (scales.x.getPixelForValue(i) + scales.x.getPixelForValue(i + 1)) / 2;
      const yrs = (dateMs(scans[i + 1].date) - dateMs(scans[i].date)) / (365.25 * MS_DAY);
      ctx.strokeStyle = 'rgba(255,255,255,0.28)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom); ctx.stroke();
      ctx.setLineDash([]);
      if (opts.labels === false) continue;
      ctx.fillStyle = '#9aa0a6';
      ctx.font = '600 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${yrs.toFixed(1)} yr gap`, x, chartArea.top + 10);
    }
    ctx.restore();
  },
};

/** Soft column behind the selected scan. options: { idx } */
const selectPlugin = {
  id: 'selectedScan',
  beforeDatasetsDraw(chart, _args, opts) {
    const idx = opts.idx ?? -1;
    if (idx < 0) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x.getPixelForValue(idx);
    const w = scales.x.width / Math.max(1, scales.x.ticks.length);
    ctx.save();
    ctx.fillStyle = 'rgba(138,180,248,0.10)';
    ctx.fillRect(x - w / 2, chartArea.top, w, chartArea.bottom - chartArea.top);
    ctx.restore();
  },
};

/** Body-fat percentile bands shaded on the right-hand (%) axis. options: { bands } */
const bandsPlugin = {
  id: 'fatBands',
  beforeDatasetsDraw(chart, _args, opts) {
    const bands = opts.bands || [];
    const { ctx, chartArea, scales } = chart;
    const y2 = scales[opts.axis || 'y'];
    if (!y2) return;
    ctx.save();
    for (const b of bands) {
      const top = y2.getPixelForValue(Math.min(b.hi, y2.max));
      const bottom = y2.getPixelForValue(Math.max(b.lo, y2.min));
      if (bottom <= top) continue;
      ctx.fillStyle = b.color + '14';
      ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, bottom - top);
      ctx.fillStyle = b.color + 'cc';
      ctx.font = '600 10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(b.label, chartArea.right + 8, (top + bottom) / 2 + 3); // in the right padding
    }
    ctx.restore();
  },
};

const tooltipBase = { backgroundColor: 'rgba(0,0,0,0.92)', titleColor: '#fff', bodyColor: '#e8eaed', footerColor: '#C58AF9' };
// endregion

// region Small components
function Sparkline({ values, index, color }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p) => p.v !== null && p.v !== undefined);
  if (pts.length < 2) return <div className="bs-spark" />;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const X = (i) => (values.length === 1 ? 50 : (i / (values.length - 1)) * 100);
  const Y = (v) => (hi === lo ? 13 : 23 - ((v - lo) / (hi - lo)) * 20);
  const cur = pts.find((p) => p.i === index);
  return (
    <svg className="bs-spark" viewBox="0 0 100 26" preserveAspectRatio="none">
      <polyline points={pts.map((p) => `${X(p.i)},${Y(p.v)}`).join(' ')} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      {cur && <circle cx={X(cur.i)} cy={Y(cur.v)} r="2.6" fill="#fff" stroke={color} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

function FatGauge({ scan, age, firstScan, leanest, goal }) {
  const bands = bandsFor(age);
  const lo = bands[0].lo, hi = bands[bands.length - 1].hi;
  const pos = (v) => `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100))}%`;
  const band = fatBand(age, scan.summary.fatPct);
  const marks = [];
  if (firstScan && firstScan.date !== scan.date) marks.push({ v: firstScan.summary.fatPct, label: `first ${fmt(firstScan.summary.fatPct)}`, cls: 'first' });
  if (leanest && leanest.date !== scan.date) marks.push({ v: leanest.summary.fatPct, label: `best ${fmt(leanest.summary.fatPct)}`, cls: 'best' });
  return (
    <div className="bs-gauge">
      <div className="bs-gauge-track">
        {bands.map((b) => (
          <div key={b.label} className="bs-gauge-band" style={{ left: pos(b.lo), width: `calc(${pos(b.hi)} - ${pos(b.lo)})`, background: b.color + '55' }}>
            <span>{b.label}</span>
          </div>
        ))}
        {goal && <div className="bs-gauge-goal" style={{ left: pos(goal) }}><span>goal {fmt(goal)}%</span></div>}
        {marks.map((m) => (
          <div key={m.cls} className={`bs-gauge-mark ${m.cls}`} style={{ left: pos(m.v) }}><span>{m.label}</span></div>
        ))}
        <div className="bs-gauge-now" style={{ left: pos(scan.summary.fatPct) }}><span>{fmt(scan.summary.fatPct)}%</span></div>
      </div>
      <div className="bs-gauge-scale">
        {bands.slice(1).map((b) => <span key={b.lo} style={{ left: pos(b.lo) }}>{b.lo}%</span>)}
      </div>
      <div className="bs-gauge-caption">Men {band.ageLabel}, BodySpec percentiles. Lower = leaner.</div>
    </div>
  );
}

function BodyMap({ scan, cmp }) {
  const L = scan.limbs, R = scan.regions;
  const parts = [
    { id: 'rightArm', label: 'Right arm', pct: L.rightArm.fatPct, fat: L.rightArm.fatLbs, lean: L.rightArm.leanLbs, was: cmp?.limbs.rightArm.fatPct },
    { id: 'leftArm', label: 'Left arm', pct: L.leftArm.fatPct, fat: L.leftArm.fatLbs, lean: L.leftArm.leanLbs, was: cmp?.limbs.leftArm.fatPct },
    { id: 'trunk', label: 'Trunk', pct: R.trunk.fatPct, fat: R.trunk.fatLbs, lean: R.trunk.leanLbs, was: cmp?.regions.trunk.fatPct },
    { id: 'android', label: 'Belly (android)', pct: R.android.fatPct, fat: R.android.fatLbs, lean: R.android.leanLbs, was: cmp?.regions.android.fatPct },
    { id: 'gynoid', label: 'Hips (gynoid)', pct: R.gynoid.fatPct, fat: R.gynoid.fatLbs, lean: R.gynoid.leanLbs, was: cmp?.regions.gynoid.fatPct },
    { id: 'rightLeg', label: 'Right leg', pct: L.rightLeg.fatPct, fat: L.rightLeg.fatLbs, lean: L.rightLeg.leanLbs, was: cmp?.limbs.rightLeg.fatPct },
    { id: 'leftLeg', label: 'Left leg', pct: L.leftLeg.fatPct, fat: L.leftLeg.fatLbs, lean: L.leftLeg.leanLbs, was: cmp?.limbs.leftLeg.fatPct },
    { id: 'total', label: 'Whole body', pct: scan.summary.fatPct, fat: scan.summary.fatLbs, lean: scan.summary.leanLbs, was: cmp?.summary.fatPct },
  ];
  const by = Object.fromEntries(parts.map((p) => [p.id, p]));
  const [hover, setHover] = useState(null);
  const shape = (id, el) => React.cloneElement(el, {
    fill: fatColor(by[id].pct), stroke: hover === id ? '#fff' : '#202124', strokeWidth: hover === id ? 2 : 1.5,
    onMouseEnter: () => setHover(id), onMouseLeave: () => setHover(null),
  });
  const tag = (id, x, y) => (
    <text x={x} y={y} textAnchor="middle" className="bs-map-pct">{fmt(by[id].pct)}</text>
  );
  return (
    <div className="bs-map">
      <svg viewBox="0 0 220 380" className="bs-map-svg" role="img" aria-label="Body fat % by region">
        <circle cx="110" cy="34" r="21" fill="#3c3f47" />
        <rect x="102" y="54" width="16" height="12" fill="#3c3f47" />
        {shape('rightLeg', <rect x="74" y="200" width="34" height="168" rx="13" />)}
        {shape('leftLeg', <rect x="112" y="200" width="34" height="168" rx="13" />)}
        {shape('gynoid', <rect x="70" y="190" width="80" height="40" rx="10" />)}
        {shape('trunk', <rect x="72" y="64" width="76" height="132" rx="16" />)}
        {shape('android', <rect x="72" y="146" width="76" height="34" rx="6" />)}
        {shape('rightArm', <rect x="42" y="68" width="28" height="122" rx="12" />)}
        {shape('leftArm', <rect x="150" y="68" width="28" height="122" rx="12" />)}
        {tag('trunk', 110, 112)}{tag('android', 110, 168)}{tag('gynoid', 110, 214)}
        {tag('rightArm', 56, 132)}{tag('leftArm', 164, 132)}
        {tag('rightLeg', 91, 300)}{tag('leftLeg', 129, 300)}
        <text x="57" y="200" textAnchor="middle" className="bs-map-side">R</text>
        <text x="163" y="200" textAnchor="middle" className="bs-map-side">L</text>
      </svg>
      <table className="bs-map-table">
        <thead><tr><th>Region</th><th>Fat %</th><th>Fat</th><th>Lean</th><th>{cmp ? 'vs ' + cmp.date.slice(0, 7) : ''}</th></tr></thead>
        <tbody>
          {parts.map((p) => {
            const d = p.was !== undefined && p.was !== null ? p.pct - p.was : null;
            return (
              <tr key={p.id} className={hover === p.id ? 'hot' : ''} onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}>
                <td><i style={{ background: fatColor(p.pct) }} />{p.label}</td>
                <td>{fmt(p.pct)}%</td>
                <td>{fmt(p.fat)}</td>
                <td>{fmt(p.lean)}</td>
                <td className={d === null ? '' : d <= 0 ? 'good' : 'bad'}>{d === null ? '' : signed(d) + ' pts'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="bs-map-scale">
        <span>12%</span><div className="bs-map-gradient" /><span>38%+</span>
      </div>
    </div>
  );
}
// endregion

function BodyStatsView() {
  const isMobile = useIsMobile();
  const { profile, scans, loaded } = useBodyStats();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [tab, setTab] = useState('regions');
  const [regionMetric, setRegionMetric] = useState('fatPct');
  const [visibleByTab, setVisibleByTab] = useState({});
  const [selected, setSelected] = useState(null);
  const [compare, setCompare] = useState('prev');

  // region Goal (persisted like the sidebar width)
  const [goal, setGoalState] = useState(null);
  useEffect(() => onValue(ref(database, GOAL_PATH), (snap) => {
    const v = snap.val();
    if (typeof v === 'number') setGoalState(v);
  }), []);
  const setGoal = (v) => {
    setGoalState(v);
    fbSet(ref(database, GOAL_PATH), v).catch(console.error);
  };
  // endregion

  // region Range + selected scan
  const span = { min: scans[0]?.date || '', max: scans[scans.length - 1]?.date || '' };
  const inRange = useMemo(
    () => scans.filter((s) => (!startDate || s.date >= startDate) && (!endDate || s.date <= endDate)),
    [scans, startDate, endDate]
  );
  const current = inRange.find((s) => s.date === selected) || inRange[inRange.length - 1] || null;
  const curIdx = current ? inRange.indexOf(current) : -1;
  const isLatest = curIdx === inRange.length - 1;
  const upToCurrent = useMemo(() => inRange.slice(0, curIdx + 1), [inRange, curIdx]);
  const age = current ? ageAt(profile?.dob, current.date) ?? 25 : 25;

  const onPickStart = (v) => {
    if (v && endDate && v > endDate) { setStartDate(endDate); setEndDate(v); } else setStartDate(v);
  };
  const onPickEnd = (v) => {
    if (v && startDate && v < startDate) { setStartDate(v); setEndDate(startDate); } else setEndDate(v);
  };

  const leanest = useMemo(
    () => upToCurrent.reduce((b, s) => (!b || s.summary.fatPct < b.summary.fatPct ? s : b), null),
    [upToCurrent]
  );
  const compareScan = useMemo(() => {
    if (!current) return null;
    if (compare === 'prev') return curIdx > 0 ? inRange[curIdx - 1] : null;
    if (compare === 'first') return inRange[0] !== current ? inRange[0] : null;
    return leanest && leanest !== current ? leanest : null;
  }, [compare, current, curIdx, inRange, leanest]);
  // endregion

  // region Goal maths
  const pace = useMemo(() => (current ? recentPace(current, upToCurrent) : null), [current, upToCurrent]);
  const goalOptions = useMemo(() => {
    if (!current) return [];
    const cuts = fatBand(age, current.summary.fatPct).cuts;
    const opts = cuts.map((c, i) => ({ v: c, label: ['20th', '40th', '60th', '80th'][i] + ' pct' }));
    if (leanest && leanest.date !== current.date) opts.push({ v: leanest.summary.fatPct, label: 'your best' });
    return opts.filter((o) => o.v < current.summary.fatPct + 0.05).sort((a, b) => b.v - a.v).slice(0, 4);
  }, [current, age, leanest]);
  const activeGoal = goal ?? goalOptions.find((o) => o.label.startsWith('40th'))?.v ?? goalOptions[0]?.v ?? null;
  // endregion

  // region Detail tab series
  const def = useMemo(() => tabSeries(tab, regionMetric), [tab, regionMetric]);
  const visKey = tab === 'regions' ? `regions:${regionMetric}` : tab;
  const visible = useMemo(
    () => visibleByTab[visKey] || new Set(def.series.filter((s) => s.on).map((s) => s.id)),
    [visibleByTab, visKey, def]
  );
  const setVisible = (next) => setVisibleByTab((p) => ({ ...p, [visKey]: next }));
  const toggleSeries = (id) => {
    const next = new Set(visible);
    if (next.has(id)) next.delete(id); else next.add(id);
    const real = [...next].filter((x) => !def.series.find((s) => s.id === x)?.ref);
    setVisible(real.length ? next : new Set(def.series.filter((s) => s.on).map((s) => s.id)));
  };
  const onlySeries = (id) => setVisible(new Set([id, ...def.series.filter((s) => s.ref && visible.has(s.id)).map((s) => s.id)]));
  // endregion

  // region Body fat % over percentile bands (top) + stacked lean / fat / bone (bottom).
  // Two charts sharing one x axis; fixed y-axis widths keep their plot areas aligned.
  const AXIS_W = isMobile ? 36 : 46;
  const RIGHT_PAD = isMobile ? 46 : 58; // room for the percentile band labels; same on both charts
  const fixAxis = (scale) => { scale.width = AXIS_W; };
  const xLabel = (d) => (isMobile ? scanLabelShort(d) : scanLabel(d));
  const xTicks = { color: '#bdc1c6', font: { size: isMobile ? 9 : 11 }, maxRotation: 0, autoSkip: false };
  const scanTooltip = (extra) => ({
    ...tooltipBase,
    callbacks: {
      title: (items) => {
        const s = inRange[items[0].dataIndex];
        return `${s.date} · age ${ageAt(profile?.dob, s.date)}`;
      },
      ...extra,
    },
  });

  const bfCanvas = useRef(null);
  useChart(bfCanvas, () => {
    if (!inRange.length) return null;
    const bands = bandsFor(age);
    const vals = inRange.map((s) => s.summary.fatPct);
    // Even 4-point ticks around the data (and the goal line), clamped to the band range.
    const lo = Math.max(4, Math.floor((Math.min(...vals, activeGoal ?? 99) - 2) / 4) * 4);
    const hi = Math.min(40, Math.ceil((Math.max(...vals) + 3) / 4) * 4);
    const datasets = [{
      label: 'Body fat %', data: vals,
      borderColor: '#fdd663', backgroundColor: '#fdd663', borderWidth: 2.5, tension: 0.2,
      pointRadius: (ctx) => (ctx.dataIndex === curIdx ? 6 : 4),
      pointBackgroundColor: (ctx) => (ctx.dataIndex === curIdx ? '#fff' : '#fdd663'),
      pointBorderColor: '#fdd663', pointBorderWidth: 2,
      segment: { borderDash: (ctx) => (isGap(inRange, ctx.p0DataIndex) ? [5, 5] : undefined) },
      datalabels: {
        display: (ctx) => !isMobile || ctx.dataIndex === curIdx, color: '#fdd663', align: 'top', anchor: 'end', offset: 5,
        font: { size: 11, weight: '700' }, formatter: (v) => `${fmt(v)}%`,
      },
    }];
    if (activeGoal !== null) {
      datasets.push({
        label: 'Goal', data: inRange.map(() => activeGoal), borderColor: '#C58AF9', borderWidth: 1.5,
        borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 0, _goal: true,
        datalabels: {
          display: (ctx) => ctx.dataIndex === 0, color: '#C58AF9', align: 'bottom', anchor: 'start',
          font: { size: 10, weight: '700' }, formatter: (v) => `goal ${fmt(v)}%`,
        },
      });
    }
    return {
      type: 'line',
      data: { labels: inRange.map((s) => xLabel(s.date)), datasets },
      plugins: [bandsPlugin, gapPlugin, selectPlugin],
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 18, right: RIGHT_PAD } },
        onClick: (_e, els) => { if (els[0]) setSelected(inRange[els[0].index].date); },
        plugins: {
          legend: { display: false },
          fatBands: { bands, axis: 'y' },
          scanGaps: { dates: inRange.map((s) => s.date), labels: !isMobile },
          selectedScan: { idx: curIdx },
          tooltip: scanTooltip({
            label: (ctx) => (ctx.dataset._goal ? ` Goal: ${fmt(ctx.parsed.y)}%` : ` Body fat: ${fmt(ctx.parsed.y)}% (${fatBand(ageAt(profile?.dob, inRange[ctx.dataIndex].date) ?? 25, ctx.parsed.y).band} pct)`),
          }),
        },
        scales: {
          x: { offset: true, ticks: { display: false }, grid: { display: false } }, // offset: centre on the bars below
          y: {
            min: lo, max: hi, afterFit: fixAxis,
            ticks: { color: '#fdd663', stepSize: 4, callback: (v) => v + '%' },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
      },
    };
  }, [loaded, inRange, curIdx, age, profile, activeGoal, isMobile]);

  const compCanvas = useRef(null);
  useChart(compCanvas, () => {
    if (!inRange.length) return null;
    const bar = (label, color, get, textColor) => ({
      label, stack: 'mass',
      data: inRange.map(get), backgroundColor: color, borderColor: '#202124', borderWidth: { top: 1 }, borderSkipped: false,
      barPercentage: 0.72, categoryPercentage: 0.9,
      datalabels: {
        display: !isMobile && label !== 'Bone', color: textColor, font: { size: 10, weight: '600' },
        formatter: (v) => fmt(v), anchor: 'center', align: 'center',
      },
    });
    return {
      type: 'bar',
      data: {
        labels: inRange.map((s) => xLabel(s.date)),
        datasets: [
          bar('Bone', '#9aa0a6', (s) => s.summary.bmcLbs, '#202124'),
          bar('Lean', '#4f9a6a', (s) => s.summary.leanLbs, '#e8eaed'),
          bar('Fat', '#d9665c', (s) => s.summary.fatLbs, '#fff'),
        ],
      },
      plugins: [gapPlugin, selectPlugin],
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { right: RIGHT_PAD } },
        onClick: (_e, els) => { if (els[0]) setSelected(inRange[els[0].index].date); },
        plugins: {
          legend: { display: false },
          scanGaps: { dates: inRange.map((s) => s.date), labels: false },
          selectedScan: { idx: curIdx },
          datalabels: {},
          tooltip: scanTooltip({
            label: (ctx) => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)} lbs`,
            footer: (items) => `Weight: ${fmt(inRange[items[0].dataIndex].summary.totalLbs)} lbs`,
          }),
        },
        scales: {
          x: { stacked: true, ticks: xTicks, grid: { display: false } },
          y: {
            stacked: true, beginAtZero: true, afterFit: fixAxis,
            ticks: { color: '#9aa0a6', callback: (v) => v }, grid: { color: 'rgba(255,255,255,0.07)' },
            title: { display: true, text: 'lbs', color: '#9aa0a6', font: { size: 11 } },
          },
        },
      },
    };
  }, [loaded, inRange, curIdx, profile, isMobile]);
  // endregion

  // region Detail line chart (category axis: one slot per scan)
  const detailCanvas = useRef(null);
  useChart(detailCanvas, () => {
    if (!inRange.length) return null;
    const shown = def.series.filter((s) => visible.has(s.id));
    const datasets = shown.map((s) => ({
      label: s.label, yAxisID: s.axis, _series: s,
      data: inRange.map((scan) => {
        const v = s.ref ? s.get() : s.get(scan, profile);
        return v === undefined || v === null ? null : v;
      }),
      borderColor: s.color, backgroundColor: s.color,
      borderWidth: s.ref ? 1 : 2, borderDash: s.dash,
      pointRadius: s.ref ? 0 : (ctx) => (ctx.dataIndex === curIdx ? 6 : 3.5),
      pointHoverRadius: s.ref ? 0 : 7,
      pointBackgroundColor: (ctx) => (ctx.dataIndex === curIdx ? '#fff' : s.color),
      pointBorderColor: s.color, pointBorderWidth: 2, tension: 0.15, spanGaps: true,
      segment: s.ref ? undefined : { borderDash: (ctx) => (isGap(inRange, ctx.p0DataIndex) ? [4, 5] : s.dash) },
    }));
    const hasY2 = shown.some((s) => s.axis === 'y2');
    return {
      type: 'line',
      data: { labels: inRange.map((s) => xLabel(s.date)), datasets },
      plugins: [gapPlugin, selectPlugin],
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
        interaction: { mode: 'index', intersect: false },
        onClick: (_e, els) => { if (els[0]) setSelected(inRange[els[0].index].date); },
        plugins: {
          legend: { display: false },
          datalabels: { display: false },
          scanGaps: { dates: inRange.map((s) => s.date), labels: !isMobile },
          selectedScan: { idx: curIdx },
          tooltip: {
            ...tooltipBase,
            filter: (item) => !item.dataset._series.ref && item.raw !== null,
            callbacks: {
              title: (items) => {
                const s = inRange[items[0].dataIndex];
                return `${s.date} · age ${ageAt(profile?.dob, s.date)}`;
              },
              label: (ctx) => {
                const s = ctx.dataset._series;
                return ` ${s.label}: ${fmt(ctx.raw, s.digits ?? 1)}${s.unit ? (s.unit === '%' ? '%' : ' ' + s.unit) : ''}`;
              },
            },
          },
        },
        scales: {
          x: { ticks: xTicks, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: {
            title: { display: !!def.axes.y, text: def.axes.y, color: '#9aa0a6', font: { size: 11 } },
            ticks: { color: '#9aa0a6' },
            grid: { color: (ctx) => (tab === 'balance' && ctx.tick?.value === 0 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.08)') },
          },
          y2: {
            display: hasY2, position: 'right',
            title: { display: !!def.axes.y2, text: def.axes.y2, color: '#9aa0a6', font: { size: 11 } },
            ticks: { color: '#9aa0a6' }, grid: { display: false },
          },
        },
      },
    };
  }, [loaded, inRange, def, visible, curIdx, profile, tab, isMobile]);
  // endregion

  // region KPI cards + work-on list
  const kpis = useMemo(() => {
    if (!current) return [];
    return KPIS.map((k) => {
      const v = k.get(current);
      const best = bestOf(k, upToCurrent);
      let refV = null;
      if (compare === 'best') refV = best && best.date !== current.date ? best.v : null;
      else if (compareScan) refV = k.get(compareScan);
      const d = v !== undefined && v !== null && refV !== null && refV !== undefined ? v - refV : null;
      const good = d === null || !k.better || Math.abs(d) < 10 ** -k.digits / 2 ? null : (k.better === 'down' ? d < 0 : d > 0);
      return { ...k, v, d, good, best, series: inRange.map((s) => k.get(s)) };
    });
  }, [current, compareScan, compare, inRange, upToCurrent]);

  const focus = useMemo(() => focusAreas(current, inRange, profile), [current, inRange, profile]);
  // endregion

  if (!loaded || !scans.length) {
    return (
      <div className="totals-view body-stats">
        <h1 className="totals-title">Body Stats</h1>
        {!loaded
          ? <div className="totals-loading"><div className="loading-spinner" /><div>Loading…</div></div>
          : <div className="no-data-msg">No body scans yet. Scans live in the database under bodyStats/scans.</div>}
      </div>
    );
  }

  const cmpLabel = COMPARE.find((c) => c.id === compare).label;
  const band = current ? fatBand(age, current.summary.fatPct) : null;
  const lbsToGoal = current && activeGoal !== null ? fatToLose(current, activeGoal) : null;
  const keep = current ? current.summary.leanLbs + current.summary.bmcLbs : 0;
  const goalWeight = activeGoal !== null ? keep / (1 - activeGoal / 100) : null;
  const paceStart = pace?.from || inRange[0];
  const progress = current && activeGoal !== null && paceStart && paceStart.summary.fatPct > activeGoal
    ? Math.max(0, Math.min(1, (paceStart.summary.fatPct - current.summary.fatPct) / (paceStart.summary.fatPct - activeGoal)))
    : null;
  const etaMonths = lbsToGoal > 0 && pace && pace.fatPerMonth < -0.05 ? lbsToGoal / -pace.fatPerMonth : null;

  return (
    <div className="totals-view body-stats">
      <h1 className="totals-title">Body Stats</h1>

      <div className="range-bar">
        <label>From:</label>
        <DateInput value={startDate} min={span.min} max={span.max} onChange={onPickStart} />
        <label>To:</label>
        <DateInput value={endDate} min={span.min} max={span.max} onChange={onPickEnd} />
        {(startDate || endDate) && (
          <button className="range-clear" onClick={() => { setStartDate(''); setEndDate(''); }}>Clear</button>
        )}
        <label className="bs-compare-label">Compare with:</label>
        <div className="view-toggle">
          {COMPARE.map((c) => (
            <button key={c.id} className={compare === c.id ? 'active' : ''} onClick={() => setCompare(c.id)}>{c.short}</button>
          ))}
        </div>
        <span className="range-info">
          {inRange.length} of {scans.length} DEXA scans · {inRange[0]?.date || '—'} → {inRange[inRange.length - 1]?.date || '—'}
        </span>
      </div>

      {!current ? (
        <div className="no-data-msg">No scans in this range</div>
      ) : (
        <>
          <div className="bs-scan-head">
            <span className="bs-scan-date">{current.date}</span>
            <span className="bs-scan-sub">
              {isLatest ? 'latest scan' : 'selected scan'} · age {age} · changes vs {cmpLabel}
              {compare !== 'best' && (compareScan ? ` (${compareScan.date})` : ' (none)')}
            </span>
            {!isLatest && <button className="range-clear" onClick={() => setSelected(null)}>Back to latest</button>}
          </div>

          <div className="bs-kpis">
            {kpis.map((k) => (
              <div key={k.id} className="bs-kpi">
                <div className="bs-kpi-label">{k.label}</div>
                <div className="bs-kpi-value">
                  {fmt(k.v, k.digits)}<span className="bs-kpi-unit">{k.unit === '%' ? '%' : k.unit ? ' ' + k.unit : ''}</span>
                </div>
                <div className={`bs-kpi-delta ${k.good === true ? 'good' : k.good === false ? 'bad' : ''}`}>
                  {k.d === null ? '—' : `${signed(k.d, k.digits)} vs ${compare === 'prev' ? 'prev' : compare}`}
                </div>
                <Sparkline values={k.series} index={curIdx} color={k.color} />
              </div>
            ))}
          </div>

          <div className="bs-hero">
            <div className="bs-card bs-fat-card">
              <div className="bs-panel-title">Body fat</div>
              <div className="bs-fat-head">
                <span className="bs-fat-big">{fmt(current.summary.fatPct)}%</span>
                <span className="bs-fat-band" style={{ color: bandsFor(age)[band.index].color }}>{band.band} percentile</span>
              </div>
              <FatGauge scan={current} age={age} firstScan={inRange[0]} leanest={leanest} goal={activeGoal} />
              {pace && (
                <div className="bs-since">
                  Since your {pace.from.date} high of {fmt(pace.from.summary.fatPct)}%:
                  <b className={current.summary.fatLbs <= pace.from.summary.fatLbs ? 'good' : 'bad'}> fat {signed(current.summary.fatLbs - pace.from.summary.fatLbs)} lbs</b>,
                  <b className={current.summary.leanLbs >= pace.from.summary.leanLbs - 0.5 ? 'good' : 'bad'}> lean {signed(current.summary.leanLbs - pace.from.summary.leanLbs)} lbs</b>,
                  <b> weight {signed(current.summary.totalLbs - pace.from.summary.totalLbs)} lbs</b>.
                </div>
              )}
            </div>

            <div className="bs-card bs-goal-card">
              <div className="bs-panel-title">Goal</div>
              <div className="view-toggle bs-goal-opts">
                {goalOptions.map((o) => (
                  <button key={o.v} className={Math.abs((activeGoal ?? -1) - o.v) < 0.01 ? 'active' : ''} onClick={() => setGoal(o.v)}>
                    {fmt(o.v)}% <small>{o.label}</small>
                  </button>
                ))}
              </div>
              {activeGoal !== null && (lbsToGoal > 0 ? (
                <>
                  <div className="bs-goal-big">Lose {fmt(lbsToGoal)} lbs of fat</div>
                  <div className="bs-goal-sub">
                    to reach {fmt(activeGoal)}% while keeping {fmt(keep)} lbs of lean + bone · about {fmt(goalWeight)} lbs body weight
                  </div>
                  {progress !== null && (
                    <div className="bs-progress">
                      <div className="bs-progress-bar"><div style={{ width: `${progress * 100}%` }} /></div>
                      <div className="bs-progress-label">
                        <span>{fmt(paceStart.summary.fatPct)}% ({paceStart.date.slice(0, 7)})</span>
                        <span>{Math.round(progress * 100)}% of the way</span>
                        <span>{fmt(activeGoal)}%</span>
                      </div>
                    </div>
                  )}
                  <div className="bs-goal-pace">
                    {pace && pace.fatPerMonth < -0.05 ? (
                      <>At your pace since {pace.from.date} (<b>{signed(pace.fatPerMonth, 2)} lbs fat/month</b>,
                        lean {signed(pace.leanPerMonth, 2)}/month) you'd get there around <b>{addMonths(current.date, etaMonths)}</b>.</>
                    ) : pace ? (
                      <>Fat has gone {pace.fatPerMonth > 0 ? 'up' : 'flat'} since {pace.from.date}; no arrival date at this pace.</>
                    ) : (
                      <>Not enough recent scans to estimate a pace.</>
                    )}
                  </div>
                </>
              ) : (
                <div className="bs-goal-big good">Goal reached · {fmt(-lbsToGoal)} lbs under</div>
              ))}
            </div>
          </div>

          <div className="bs-card">
            <div className="bs-panel-title">
              Body fat % and composition by scan
              <span className="bs-legend">
                <i className="line" style={{ background: '#fdd663' }} />Body fat %
                <i className="line dashed" style={{ borderColor: '#C58AF9' }} />Goal
                <i style={{ background: '#d9665c' }} />Fat
                <i style={{ background: '#4f9a6a' }} />Lean
                <i style={{ background: '#9aa0a6' }} />Bone
              </span>
            </div>
            <div className="bs-bf-chart"><canvas ref={bfCanvas} /></div>
            <div className="bs-comp-chart"><canvas ref={compCanvas} /></div>
            <div className="bs-footnote">
              Top: body fat % over BodySpec percentile bands for men {band.ageLabel}. Bottom: lean + fat + bone stack to body weight (lbs).
              Click any scan to inspect it.
            </div>
          </div>

          <div className="bs-lower">
            <div className="bs-card">
              <div className="bs-panel-title">What to work on · {current.date}</div>
              <ul className="bs-focus">
                {focus.map((f) => (
                  <li key={f.id} className={`bs-focus-item ${f.status}`}>
                    <span className={`bs-status ${f.status}`}>{f.status === 'work' ? 'Work on' : f.status === 'watch' ? 'Watch' : 'Good'}</span>
                    <span className="bs-focus-title">{f.title}</span>
                    <span className="bs-focus-value">{f.value}</span>
                    {f.trend && <span className={`bs-focus-trend ${f.trendGood ? 'good' : 'bad'}`}>{f.trend}</span>}
                    <div className="bs-focus-line">{f.line}</div>
                  </li>
                ))}
              </ul>
              <div className="bs-footnote">Trend = change since the previous scan. * computed from BodySpec values.</div>
            </div>

            <div className="bs-card">
              <div className="bs-panel-title">Where the fat sits · fat % by region</div>
              <BodyMap scan={current} cmp={compareScan} />
            </div>
          </div>

          <div className="bs-main">
            <div className="bs-card bs-chart-card">
              <div className="bs-chart-head">
                <div className="view-toggle bs-tabs">
                  {TABS.map((t) => (
                    <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
                  ))}
                </div>
                {tab === 'regions' && (
                  <div className="view-toggle">
                    {REGION_METRICS.map((m) => (
                      <button key={m.id} className={regionMetric === m.id ? 'active' : ''} onClick={() => setRegionMetric(m.id)}>{m.label}</button>
                    ))}
                  </div>
                )}
              </div>
              <div className="bs-chart"><canvas ref={detailCanvas} /></div>
              {tab === 'metabolic' && <div className="bs-footnote">* computed from BodySpec values (height 72 in).</div>}
            </div>

            <div className="totals-filters bs-series">
              <div className="bs-panel-title">Lines on the chart</div>
              <ul className="activity-list">
                {def.series.map((s) => {
                  const on = visible.has(s.id);
                  const v = s.ref ? s.get() : s.get(current, profile);
                  return (
                    <li key={s.id} className={`activity-row ${on ? '' : 'off'}`} onClick={() => toggleSeries(s.id)}>
                      <span className="activity-checkbox" style={{ borderColor: s.color, background: on ? s.color : 'transparent' }} />
                      <span className="activity-name" style={{ color: on ? s.color : '#666' }}>{s.label}</span>
                      <span className="activity-hours">{v === null || v === undefined ? '—' : fmt(v, s.digits ?? 1)}</span>
                      {!s.ref && (
                        <button className="only-btn" onClick={(e) => { e.stopPropagation(); onlySeries(s.id); }}>ONLY</button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="bs-card">
            <div className="bs-panel-title">All scans · click a row to inspect it</div>
            <div className="bs-table-wrap">
              <table className="bs-table">
                <thead>
                  <tr>
                    <th>Date</th><th>Age</th><th>Weight</th><th>Body fat</th><th>Fat</th><th>Lean</th>
                    <th>Visceral</th><th>A/G</th><th>RMR</th><th>BMD</th><th>Z</th>
                  </tr>
                </thead>
                <tbody>
                  {[...inRange].reverse().map((s) => (
                    <tr key={s.date} className={s.date === current.date ? 'sel' : ''} onClick={() => setSelected(s.date)}>
                      <td>{s.date}</td>
                      <td>{ageAt(profile?.dob, s.date) ?? '—'}</td>
                      <td>{fmt(s.summary.totalLbs)}</td>
                      <td><span className="bs-dot" style={{ background: fatColor(s.summary.fatPct) }} />{fmt(s.summary.fatPct)}%</td>
                      <td>{fmt(s.summary.fatLbs)}</td>
                      <td>{fmt(s.summary.leanLbs)}</td>
                      <td>{fmt(s.vatLbs, 2)}</td>
                      <td>{fmt(s.agRatio, 2)}</td>
                      <td>{fmt(s.rmr, 0)}</td>
                      <td>{fmt(s.bone?.total, 3)}</td>
                      <td>{fmt(s.bone?.zScore)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="bs-footnote">Mass in lbs. Source: BodySpec DEXA reports.{current.note ? ` ${current.date}: ${current.note}` : ''}</div>
          </div>
        </>
      )}
    </div>
  );
}

export default BodyStatsView;
