import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { ACTIVITIES, STACK_ORDER } from './activities';
import { useAllDailyTotals } from './useAllDailyTotals';
import { labelAnchor, labelAlign, labelOffset } from './labelLayout';
import DateInput from './DateInput';
import { useIsMobile } from './useIsMobile';
import './TotalsView.css';

Chart.register(...registerables, ChartDataLabels);

function AllTotalsView() {
  const isMobile = useIsMobile();
  const [visible, setVisible] = useState(() => new Set(STACK_ORDER));
  const [search, setSearch] = useState('');
  const [hbarMode, setHbarMode] = useState('total');
  const [barReady, setBarReady] = useState(false);
  const [pieReady, setPieReady] = useState(false);
  const [hbarReady, setHbarReady] = useState(false);

  // User-settable date range. '' = "use full data span".
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Auto-swap if the user picks dates out of order — keeps {start <= end} always true.
  const onPickStart = (newStart) => {
    if (newStart && endDate && newStart > endDate) {
      setStartDate(endDate);
      setEndDate(newStart);
    } else {
      setStartDate(newStart);
    }
  };
  const onPickEnd = (newEnd) => {
    if (newEnd && startDate && newEnd < startDate) {
      setStartDate(newEnd);
      setEndDate(startDate);
    } else {
      setEndDate(newEnd);
    }
  };

  const { data: dailyTotals, loaded } = useAllDailyTotals();

  // Derive the actual data span (min/max date keys we have data for).
  const span = useMemo(() => {
    const keys = Object.keys(dailyTotals).sort();
    if (keys.length === 0) return { min: '', max: '' };
    return { min: keys[0], max: keys[keys.length - 1] };
  }, [dailyTotals]);

  // Effective range: user input takes precedence; else full data span.
  const range = useMemo(() => ({
    start: startDate || span.min,
    end: endDate || span.max,
  }), [startDate, endDate, span]);

  // If the user has narrowed to <1 year, switch the bar's X axis to month
  // granularity so we don't lose detail to a single fat year-bar.
  const isMonthlyView = useMemo(() => {
    if (!range.start || !range.end) return false;
    const startMs = Date.parse(range.start + 'T00:00:00');
    const endMs = Date.parse(range.end + 'T00:00:00');
    if (!isFinite(startMs) || !isFinite(endMs)) return false;
    const days = (endMs - startMs) / (24 * 3600 * 1000);
    return days < 365;
  }, [range]);

  // Aggregate by either year ('YYYY') or month ('YYYY-MM') based on the range.
  const aggregated = useMemo(() => {
    const out = {};
    for (const [date, day] of Object.entries(dailyTotals)) {
      if (!day) continue;
      if (range.start && date < range.start) continue;
      if (range.end && date > range.end) continue;
      const key = isMonthlyView ? date.slice(0, 7) : date.slice(0, 4);
      if (!out[key]) out[key] = {};
      for (const [act, hrs] of Object.entries(day)) {
        if (act === 'PE') continue;
        out[key][act] = (out[key][act] || 0) + hrs;
      }
    }
    return out;
  }, [dailyTotals, range, isMonthlyView]);

  const aggregatedKeys = useMemo(
    () => Object.keys(aggregated).sort(),
    [aggregated]
  );

  const allTimeTotals = useMemo(() => {
    const out = {};
    for (const k of aggregatedKeys) {
      for (const [act, hrs] of Object.entries(aggregated[k])) {
        out[act] = (out[act] || 0) + hrs;
      }
    }
    return out;
  }, [aggregatedKeys, aggregated]);

  const hasData = useMemo(
    () => Object.keys(aggregated).length > 0,
    [aggregated]
  );

  // Days in the active range that actually have data, for "Avg per day".
  const daysWithData = useMemo(() => {
    let n = 0;
    for (const date of Object.keys(dailyTotals)) {
      if (range.start && date < range.start) continue;
      if (range.end && date > range.end) continue;
      n++;
    }
    return n;
  }, [dailyTotals, range]);

  const totalSum = useMemo(() => {
    let s = 0;
    for (const id of visible) s += allTimeTotals[id] || 0;
    return Math.round(s * 100) / 100;
  }, [allTimeTotals, visible]);

  const panelActivities = useMemo(() => {
    return [...ACTIVITIES]
      .filter((a) => a.label.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (allTimeTotals[b.id] || 0) - (allTimeTotals[a.id] || 0));
  }, [search, allTimeTotals]);

  const toggle = (id) => {
    setVisible((prev) => {
      if (prev.has(id) && prev.size === 1) return new Set(STACK_ORDER);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const only = (id) => setVisible(new Set([id]));

  // When the range or visibility changes, charts must redraw (already happens
  // via useEffect below) but the loading overlay shouldn't reappear.
  // Reset chart-ready only on first mount / data load, not on filter changes.

  const barCanvas = useRef(null);
  const pieCanvas = useRef(null);
  const hbarCanvas = useRef(null);
  const barInst = useRef(null);
  const pieInst = useRef(null);
  const hbarInst = useRef(null);

  // Mobile-only: HTML y-axis overlay labels for the bar chart.
  const [barYLabels, setBarYLabels] = useState([]);

  // Explicit y-max so the HTML overlay aligns with the chart's gridlines.
  const barYMax = useMemo(() => {
    let m = 0;
    for (const k of aggregatedKeys) {
      let total = 0;
      for (const a of ACTIVITIES) {
        if (visible.has(a.id)) total += aggregated[k][a.id] || 0;
      }
      if (total > m) m = total;
    }
    if (m === 0) return 100;
    // Round up to a tidy number: 50 if <50, 100 if <100, 500 step otherwise.
    if (m <= 50) return Math.ceil(m / 10) * 10;
    if (m <= 200) return Math.ceil(m / 25) * 25;
    if (m <= 1000) return Math.ceil(m / 100) * 100;
    return Math.ceil(m / 500) * 500;
  }, [aggregatedKeys, aggregated, visible]);

  // ── Stacked bar (years OR months depending on range size) ──
  useEffect(() => {
    if (!loaded || !barCanvas.current) return;

    const datasets = ACTIVITIES.filter((a) => visible.has(a.id)).map((a) => ({
      label: a.label,
      data: aggregatedKeys.map((k) => Math.round((aggregated[k][a.id] || 0) * 100) / 100),
      backgroundColor: a.color,
      borderColor: '#232732',
      borderWidth: { top: 1.5, bottom: 0, left: 0, right: 0 },
      borderSkipped: false,
      hoverBackgroundColor: lightenHex(a.color, 0.15),
      stack: 'hours',
      _activity: a,
    }));

    // Multi-line "Mar / 2025" labels in monthly mode (chart.js renders array
    // values as stacked text rows). Yearly mode is just "2025".
    const chartLabels = isMonthlyView
      ? aggregatedKeys.map(formatMonthYear)
      : aggregatedKeys;

    const config = {
      type: 'bar',
      data: { labels: chartLabels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        interaction: { mode: 'index', intersect: false, axis: 'x' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.9)',
            titleColor: '#fff',
            bodyColor: '#e8eaed',
            footerColor: '#C58AF9',
            footerFont: { weight: 'bold' },
            mode: 'index',
            intersect: true,
            axis: 'x',
            callbacks: {
              label: (ctx) => (ctx.parsed.y ? `${ctx.dataset.label}: ${ctx.parsed.y}h` : null),
              footer: (items) => {
                if (!items.length) return '';
                const idx = items[0].dataIndex;
                let total = 0;
                for (const ds of items[0].chart.data.datasets) total += ds.data[idx] || 0;
                return `Total: ${Math.round(total * 100) / 100}h`;
              },
            },
            filter: (item) => item.parsed.y > 0,
          },
          datalabels: {
            display: (ctx) => (ctx.dataset.data[ctx.dataIndex] || 0) >= 20,
            color: (ctx) => ctx.dataset._activity?.labelColor || '#fff',
            font: { weight: '500', size: 10 },
            formatter: (v) => (v ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : ''),
            anchor: labelAnchor,
            align: labelAlign,
            offset: labelOffset,
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: {
              color: '#e8eaed',
              font: { size: isMobile ? 11 : 13, weight: '500' },
              autoSkip: !isMobile,           // mobile renders ALL labels (chart is 720px wide)
              maxRotation: 0,
            },
            grid: { display: false },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            min: 0,
            max: barYMax,
            ticks: {
              color: '#e8eaed',
              font: { size: 11, weight: '500' },
              display: !isMobile,    // HTML overlay handles labels on mobile
            },
            grid: { color: 'rgba(255,255,255,0.16)' },
          },
        },
        // top: 8 keeps the topmost HTML y-label from clipping at the
        // chart-area edge (label is centered on its tick line).
        layout: isMobile ? { padding: { left: 4, right: 2, top: 8 } } : {},
      },
    };

    if (barInst.current) {
      barInst.current.data = config.data;
      barInst.current.options = config.options;
      barInst.current.update();
      setBarReady(true);
    } else {
      barInst.current = new Chart(barCanvas.current.getContext('2d'), config);
      requestAnimationFrame(() => {
        if (barInst.current) { barInst.current.resize(); barInst.current.update(); setBarReady(true); }
      });
    }

    // Populate HTML y-axis labels on mobile.
    if (isMobile) {
      requestAnimationFrame(() => {
        if (!barInst.current) return;
        const yScale = barInst.current.scales?.y;
        if (!yScale) return;
        // Pick a sensible step: ~5 ticks total.
        const step = barYMax <= 50 ? 10 : barYMax <= 200 ? 50 : barYMax <= 1000 ? 200 : 500;
        const out = [];
        for (let v = 0; v <= barYMax; v += step) {
          out.push({ value: v, top: yScale.getPixelForValue(v) });
        }
        setBarYLabels(out);
      });
    } else if (barYLabels.length) {
      setBarYLabels([]);
    }
  }, [aggregatedKeys, aggregated, isMonthlyView, visible, loaded, isMobile, barYMax]);

  // ── Doughnut ──
  useEffect(() => {
    if (!loaded || !pieCanvas.current) return;

    const labels = [];
    const data = [];
    const colors = [];
    const labelColors = [];
    for (const a of ACTIVITIES) {
      if (!visible.has(a.id)) continue;
      const hrs = allTimeTotals[a.id] || 0;
      if (hrs <= 0) continue;
      labels.push(a.label);
      data.push(Math.round(hrs * 100) / 100);
      colors.push(a.color);
      labelColors.push(a.labelColor);
    }

    const config = {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: '#232732', borderWidth: 2, _labelColors: labelColors }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        cutout: '55%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.9)',
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed;
                const tot = ctx.dataset.data.reduce((s, x) => s + x, 0);
                const pct = tot > 0 ? ((v / tot) * 100).toFixed(1) : 0;
                return `${ctx.label}: ${v}h (${pct}%)`;
              },
            },
          },
          datalabels: {
            color: (ctx) => ctx.dataset._labelColors?.[ctx.dataIndex] || '#fff',
            font: { weight: '600', size: 11 },
            formatter: (v, ctx) => {
              const tot = ctx.dataset.data.reduce((s, x) => s + x, 0);
              const pct = tot > 0 ? (v / tot) * 100 : 0;
              return pct >= 3 ? `${pct.toFixed(1)}%` : '';
            },
          },
        },
      },
    };

    if (pieInst.current) {
      pieInst.current.data = config.data;
      pieInst.current.options = config.options;
      pieInst.current.update();
      setPieReady(true);
    } else {
      pieInst.current = new Chart(pieCanvas.current.getContext('2d'), config);
      requestAnimationFrame(() => {
        if (pieInst.current) { pieInst.current.resize(); pieInst.current.update(); setPieReady(true); }
      });
    }
  }, [allTimeTotals, visible, loaded]);

  // ── Horizontal Total/Avg ──
  useEffect(() => {
    if (!loaded || !hbarCanvas.current) return;

    const items = ACTIVITIES.filter((a) => visible.has(a.id))
      .map((a) => {
        const total = allTimeTotals[a.id] || 0;
        const value = hbarMode === 'total'
          ? total
          : (daysWithData > 0 ? total / daysWithData : 0);
        return { activity: a, value: Math.round(value * 100) / 100 };
      })
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);

    const config = {
      type: 'bar',
      data: {
        labels: items.map((d) => d.activity.label),
        datasets: [{
          data: items.map((d) => d.value),
          backgroundColor: items.map((d) => d.activity.color),
          borderColor: items.map((d) => d.activity.color),
          borderWidth: 0,
          categoryPercentage: 0.85,
          barPercentage: 0.95,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        layout: { padding: { right: 60 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.9)',
            callbacks: {
              label: (ctx) => `${ctx.parsed.x}${hbarMode === 'avg' ? ' h/day' : 'h'}`,
            },
          },
          datalabels: {
            color: '#e8eaed',
            anchor: 'end',
            align: 'end',
            offset: 2,
            font: { weight: '500', size: 11 },
            formatter: (v) =>
              hbarMode === 'avg'
                ? v.toFixed(2)
                : (Number.isInteger(v) ? String(v) : v.toFixed(2)),
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: '#9aa0a6', font: { size: 10 } },
            grid: { color: 'rgba(255,255,255,0.08)' },
          },
          y: {
            ticks: {
              color: (ctx) => items[ctx.index]?.activity.color || '#e8eaed',
              font: { size: 11, weight: '600' },
            },
            grid: { display: false },
          },
        },
      },
    };

    if (hbarInst.current) {
      hbarInst.current.data = config.data;
      hbarInst.current.options = config.options;
      hbarInst.current.update();
      setHbarReady(true);
    } else {
      hbarInst.current = new Chart(hbarCanvas.current.getContext('2d'), config);
      requestAnimationFrame(() => {
        if (hbarInst.current) { hbarInst.current.resize(); hbarInst.current.update(); setHbarReady(true); }
      });
    }
  }, [allTimeTotals, visible, hbarMode, daysWithData, loaded]);

  useEffect(() => () => {
    if (barInst.current) { barInst.current.destroy(); barInst.current = null; }
    if (pieInst.current) { pieInst.current.destroy(); pieInst.current = null; }
    if (hbarInst.current) { hbarInst.current.destroy(); hbarInst.current = null; }
  }, []);

  const allChartsReady = barReady && pieReady && hbarReady;
  const titleText = (startDate || endDate) ? 'Range Totals' : 'All-Time Totals';

  return (
    <div className="totals-view">
      <h1 className="totals-title">{titleText}</h1>

      <div className="range-bar">
        <label>From:</label>
        <DateInput
          value={startDate}
          min={span.min}
          max={span.max}
          onChange={onPickStart}
        />
        <label>To:</label>
        <DateInput
          value={endDate}
          min={span.min}
          max={span.max}
          onChange={onPickEnd}
        />
        {(startDate || endDate) && (
          <button
            className="range-clear"
            onClick={() => { setStartDate(''); setEndDate(''); }}
          >
            Clear
          </button>
        )}
        <span className="range-info">
          Showing {span.min || '—'} → {span.max || '—'} ({daysWithData} days with data)
        </span>
      </div>

      <div className="totals-body">
        {(!loaded || !allChartsReady) && (
          <div className="totals-loading">
            <div className="loading-spinner" />
            <div>Loading…</div>
          </div>
        )}
        {loaded && allChartsReady && !hasData && (
          <div className="no-data-msg">No data for this range</div>
        )}

        <div className="totals-bar-wrap">
          {isMobile ? (
            <div style={{ display: 'flex', height: '100%', width: '100%' }}>
              <div
                style={{
                  width: '38px',     // wider than MonthView since values can hit 4-digit hours
                  flexShrink: 0,
                  height: '100%',
                  position: 'relative',
                }}
              >
                {barYLabels.map(({ value, top }) => (
                  <div
                    key={value}
                    style={{
                      position: 'absolute',
                      top: `${top}px`,
                      right: 2,
                      transform: 'translateY(-50%)',
                      fontSize: '10px',
                      fontWeight: 500,
                      color: '#e8eaed',
                      fontVariantNumeric: 'tabular-nums',
                      lineHeight: 1,
                      pointerEvents: 'none',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {value}
                  </div>
                ))}
              </div>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: '100%',
                  overflowX: 'auto',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                <div style={{ position: 'relative', height: '100%', minWidth: '860px' }}>
                  <canvas ref={barCanvas} />
                </div>
              </div>
            </div>
          ) : (
            <canvas ref={barCanvas} />
          )}
        </div>

        <div className="totals-side">
          <div className="totals-pie-wrap">
            <div className="pie-center">
              <div className="pie-center-label">Total</div>
              <div className="pie-center-value">{totalSum.toFixed(2)}h</div>
            </div>
            <canvas ref={pieCanvas} />
          </div>

          <div className="totals-hbar-wrap">
            <div className="hbar-header">
              <div className="view-toggle">
                <button className={hbarMode === 'total' ? 'active' : ''} onClick={() => setHbarMode('total')}>Total</button>
                <button className={hbarMode === 'avg' ? 'active' : ''} onClick={() => setHbarMode('avg')}>Avg</button>
              </div>
            </div>
            <div className="hbar-canvas">
              <canvas ref={hbarCanvas} />
            </div>
          </div>
        </div>

        <div className="totals-filters">
          <input
            type="text"
            className="search-input"
            placeholder="Search activity…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <ul className="activity-list">
            {panelActivities.map((a) => {
              const hrs = allTimeTotals[a.id] || 0;
              const isOn = visible.has(a.id);
              return (
                <li key={a.id} className={`activity-row ${isOn ? '' : 'off'}`} onClick={() => toggle(a.id)}>
                  <span className="activity-checkbox" style={{ borderColor: a.color, background: isOn ? a.color : 'transparent' }} />
                  <span className="activity-name" style={{ color: isOn ? a.color : '#666' }}>
                    {a.label}
                  </span>
                  <span className="activity-hours">{hrs ? hrs.toFixed(1) : '0'}</span>
                  <button className="only-btn" onClick={(e) => { e.stopPropagation(); only(a.id); }}>
                    ONLY
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM' -> ['Mar', '2025'] so chart.js renders the year on a second line.
function formatMonthYear(ym) {
  const [y, m] = ym.split('-');
  const idx = parseInt(m, 10) - 1;
  return [MONTH_ABBR[idx] || m, y];
}

function lightenHex(hex, frac) {
  if (!hex || hex[0] !== '#') return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lighten = (c) => Math.min(255, Math.round(c + (255 - c) * frac));
  const to2 = (c) => c.toString(16).padStart(2, '0');
  return `#${to2(lighten(r))}${to2(lighten(g))}${to2(lighten(b))}`;
}

export default AllTotalsView;
