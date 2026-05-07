import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import {
  ACTIVITY_BY_ID,
  activitiesForYear,
  stackOrderForYear,
  DATA_START_YEAR,
  DATA_START_MONTH,
} from './activities';
import { useYearTotals } from './useYearTotals';
import { useGoals } from './useGoals';
import { labelAnchor, labelAlign, labelOffset } from './labelLayout';
import { useIsMobile } from './useIsMobile';
import YearMonthPicker from './YearMonthPicker';
import './TotalsView.css';

Chart.register(...registerables, ChartDataLabels);

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function TotalsView({ year }) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const minMonthInYear = year === DATA_START_YEAR ? DATA_START_MONTH : 1;
  const maxMonthInYear = year === currentYear ? currentMonth : 12;

  // null = whole year (default). Set to a month number (1-12) to filter
  // every aggregation/chart on this page to just that month's daily data.
  const [selectedMonth, setSelectedMonth] = useState(null);
  // Reset the month filter whenever the user navigates to a different year.
  useEffect(() => { setSelectedMonth(null); }, [year]);

  const handlePick = ({ month: m }) => {
    setSelectedMonth(m == null ? null : m);
  };

  // School was retired in 2024 — drop it for views in 2024+. Pre-2024
  // years still see School (historical data).
  const ACTIVITIES = useMemo(() => activitiesForYear(year), [year]);
  const STACK_ORDER = useMemo(() => stackOrderForYear(year), [year]);
  const isMobile = useIsMobile();

  const [visible, setVisible] = useState(() => new Set(STACK_ORDER));
  const [search, setSearch] = useState('');
  const [hbarMode, setHbarMode] = useState('total'); // 'total' | 'avg'
  const [barReady, setBarReady] = useState(false);
  const [pieReady, setPieReady] = useState(false);
  const [hbarReady, setHbarReady] = useState(false);
  const { data: dailyTotalsFull, loaded } = useYearTotals(year);

  // Filter the year's daily totals down to the selected month when one is
  // active. Every downstream aggregation (monthly buckets, yearly totals,
  // daysWithData) reads `dailyTotals` so flipping the picker re-renders
  // the whole page with just that month's slice.
  const dailyTotals = useMemo(() => {
    if (selectedMonth == null) return dailyTotalsFull;
    const out = {};
    const mm = String(selectedMonth).padStart(2, '0');
    for (const [date, day] of Object.entries(dailyTotalsFull)) {
      if (date.slice(5, 7) === mm) out[date] = day;
    }
    return out;
  }, [dailyTotalsFull, selectedMonth]);
  // Yearly goals — stored at goals/<year>/<activityId>: hours
  const { goals, setGoal, removeGoal } = useGoals(`${year}`);

  // Goal editor state (mirrors MonthView)
  const [editingGoal, setEditingGoal] = useState(null);
  useEffect(() => { setEditingGoal(null); }, [year]);

  const startAddGoal = () => setEditingGoal({ activityId: '', target: 100, isNew: true });
  const startEditGoal = (id, target) => setEditingGoal({ activityId: id, target, isNew: false });
  const cancelGoal = () => setEditingGoal(null);
  const saveGoal = () => {
    if (!editingGoal || !editingGoal.activityId || editingGoal.target <= 0) return;
    setGoal(editingGoal.activityId, editingGoal.target);
    setEditingGoal(null);
  };
  const deleteGoal = () => {
    if (!editingGoal || editingGoal.isNew) return;
    removeGoal(editingGoal.activityId);
    setEditingGoal(null);
  };

  // Charts must redraw when the year switches.
  useEffect(() => {
    setBarReady(false);
    setPieReady(false);
    setHbarReady(false);
  }, [year]);

  const allChartsReady = barReady && pieReady && hbarReady;

  // Aggregate by month, then year
  const monthly = useMemo(() => {
    const out = Array.from({ length: 12 }, () => ({}));
    for (const [date, day] of Object.entries(dailyTotals)) {
      const m = parseInt(date.slice(5, 7), 10) - 1;
      if (m < 0 || m > 11 || !day) continue;
      for (const [act, hrs] of Object.entries(day)) {
        if (act === 'PE') continue;
        out[m][act] = (out[m][act] || 0) + hrs;
      }
    }
    return out;
  }, [dailyTotals]);

  const yearly = useMemo(() => {
    const out = {};
    for (const m of monthly) {
      for (const [act, hrs] of Object.entries(m)) out[act] = (out[act] || 0) + hrs;
    }
    return out;
  }, [monthly]);

  // # of days with any logged activity — denominator for "average per day"
  const daysWithData = useMemo(() => Object.keys(dailyTotals).length, [dailyTotals]);
  const hasData = daysWithData > 0;

  const totalSum = useMemo(() => {
    let s = 0;
    for (const id of visible) s += yearly[id] || 0;
    return Math.round(s * 100) / 100;
  }, [yearly, visible]);

  const panelActivities = useMemo(() => {
    return [...ACTIVITIES]
      .filter((a) => a.label.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (yearly[b.id] || 0) - (yearly[a.id] || 0));
  }, [search, yearly]);

  const toggle = (id) => {
    setVisible((prev) => {
      if (prev.has(id) && prev.size === 1) return new Set(STACK_ORDER);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const only = (id) => setVisible(new Set([id]));

  // ── Refs for the three charts ──
  const barCanvas = useRef(null);
  const pieCanvas = useRef(null);
  const hbarCanvas = useRef(null);
  const barInst = useRef(null);
  const pieInst = useRef(null);
  const hbarInst = useRef(null);

  // Mobile only — HTML y-axis overlay state for the monthly bar chart.
  const [barYLabels, setBarYLabels] = useState([]);

  // Explicit y-max so the HTML y-axis stays in lockstep with the chart.
  // 16h floor (most stacked-month rarely exceeds), rounded up to next
  // multiple of stepSize when data is bigger.
  const barYMax = useMemo(() => {
    let m = 16;
    for (const month of monthly) {
      let total = 0;
      for (const a of ACTIVITIES) {
        if (visible.has(a.id)) total += month[a.id] || 0;
      }
      if (total > m) m = total;
    }
    // Round up to next multiple of 5 for tidy ticks on monthly totals.
    return Math.ceil(m / 5) * 5;
  }, [monthly, visible, ACTIVITIES]);

  // ── Monthly stacked bar (left 40%) ──
  useEffect(() => {
    if (!loaded || !barCanvas.current) return;

    const datasets = ACTIVITIES.filter((a) => visible.has(a.id)).map((a) => ({
      label: a.label,
      data: monthly.map((m) => Math.round((m[a.id] || 0) * 100) / 100),
      backgroundColor: a.color,
      borderColor: '#202124',
      borderWidth: { top: 1.5, bottom: 0, left: 0, right: 0 },
      borderSkipped: false,
      hoverBackgroundColor: lightenHex(a.color, 0.15),
      stack: 'hours',
      _activity: a,
    }));

    const config = {
      type: 'bar',
      data: { labels: MONTH_LABELS, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        // Hover anywhere over an X column → highlight every segment in that stack.
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
            display: (ctx) => (ctx.dataset.data[ctx.dataIndex] || 0) >= 4,
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
              // Mobile chart is rendered at 720px (forced via CSS
              // min-width on the canvas wrapper), so all 12 month
              // labels fit without skipping.
              autoSkip: !isMobile,
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
        // Tight left padding on mobile so bars start near the y-axis
        // overlay edge (no wasted gutter). top: 8 so the topmost
        // HTML y-label isn't half-clipped at the chart-area edge.
        layout: isMobile ? { padding: { left: 4, right: 2, top: 8 } } : {},
      },
    };

    if (barInst.current) {
      barInst.current.data = config.data;
      barInst.current.options = config.options;
      barInst.current.update();
      setBarReady(true);
    } else {
      const firstPaint = {
        id: 'firstPaintBar_' + Math.random().toString(36).slice(2),
        afterDraw(chart) {
          if (chart._firstPaintFired) return;
          chart._firstPaintFired = true;
          setBarReady(true);
        },
      };
      barInst.current = new Chart(barCanvas.current.getContext('2d'), {
        ...config,
        plugins: [firstPaint],
      });
      requestAnimationFrame(() => {
        if (!barInst.current) return;
        barInst.current.resize();
        barInst.current.update();
      });
    }

    // Populate the HTML y-axis overlay on mobile.
    if (isMobile) {
      requestAnimationFrame(() => {
        if (!barInst.current) return;
        const yScale = barInst.current.scales?.y;
        if (!yScale) return;
        const out = [];
        // Choose stepSize 5 for the monthly chart since values run 0–60+h.
        const step = barYMax > 30 ? 10 : 5;
        for (let v = 0; v <= barYMax; v += step) {
          out.push({ value: v, top: yScale.getPixelForValue(v) });
        }
        setBarYLabels(out);
      });
    } else if (barYLabels.length) {
      setBarYLabels([]);
    }
  }, [monthly, visible, loaded, isMobile, barYMax]);

  // ── Doughnut (top-middle, 40%) ──
  useEffect(() => {
    if (!loaded || !pieCanvas.current) return;

    const labels = [];
    const data = [];
    const colors = [];
    const labelColors = [];
    for (const a of ACTIVITIES) {
      if (!visible.has(a.id)) continue;
      const hrs = yearly[a.id] || 0;
      if (hrs <= 0) continue;
      labels.push(a.label);
      data.push(Math.round(hrs * 100) / 100);
      colors.push(a.color);
      labelColors.push(a.labelColor);
    }

    const config = {
      type: 'doughnut',
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: colors,
            borderColor: '#202124',
            borderWidth: 2,
            _labelColors: labelColors,
          },
        ],
      },
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
      const firstPaint = {
        id: 'firstPaintPie_' + Math.random().toString(36).slice(2),
        afterDraw(chart) {
          if (chart._firstPaintFired) return;
          chart._firstPaintFired = true;
          setPieReady(true);
        },
      };
      pieInst.current = new Chart(pieCanvas.current.getContext('2d'), {
        ...config,
        plugins: [firstPaint],
      });
      requestAnimationFrame(() => {
        if (!pieInst.current) return;
        pieInst.current.resize();
        pieInst.current.update();
      });
    }
  }, [yearly, visible, loaded]);

  // ── Horizontal Total/Avg bar (bottom-middle, 40%) ──
  useEffect(() => {
    if (!loaded || !hbarCanvas.current) return;

    const items = ACTIVITIES.filter((a) => visible.has(a.id))
      .map((a) => {
        const total = yearly[a.id] || 0;
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
        datasets: [
          {
            data: items.map((d) => d.value),
            backgroundColor: items.map((d) => d.activity.color),
            borderColor: items.map((d) => d.activity.color),
            borderWidth: 0,
            categoryPercentage: 0.85,
            barPercentage: 0.95,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        // Leave room on the right for the value label of the longest bar
        // (e.g. Work at 1187h) — otherwise the label overshoots the canvas.
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
      const firstPaint = {
        id: 'firstPaintHbar_' + Math.random().toString(36).slice(2),
        afterDraw(chart) {
          if (chart._firstPaintFired) return;
          chart._firstPaintFired = true;
          setHbarReady(true);
        },
      };
      hbarInst.current = new Chart(hbarCanvas.current.getContext('2d'), {
        ...config,
        plugins: [firstPaint],
      });
      requestAnimationFrame(() => {
        if (!hbarInst.current) return;
        hbarInst.current.resize();
        hbarInst.current.update();
      });
    }
  }, [yearly, visible, hbarMode, daysWithData, loaded]);

  // Cleanup
  useEffect(
    () => () => {
      if (barInst.current) { barInst.current.destroy(); barInst.current = null; }
      if (pieInst.current) { pieInst.current.destroy(); pieInst.current = null; }
      if (hbarInst.current) { hbarInst.current.destroy(); hbarInst.current = null; }
    },
    []
  );

  return (
    <div className="totals-view">
      <h1 className="totals-title">
        <YearMonthPicker
          year={year}
          yearLabel="Totals"
          selectedMonth={selectedMonth}
          onSelect={handlePick}
          minMonthInYear={minMonthInYear}
          maxMonthInYear={maxMonthInYear}
        />
      </h1>
      <div className="totals-body">
        {/* Loading overlay floats above the (always-mounted) canvases so
            chart.js can size them correctly even before data arrives.
            Stays up until ALL three charts have completed first paint. */}
        {(!loaded || !allChartsReady) && (
          <div className="totals-loading">
            <div className="loading-spinner" />
            <div>Loading {year}…</div>
          </div>
        )}
        {loaded && allChartsReady && !hasData && (
          <div className="no-data-msg">No data for {year}</div>
        )}

        {/* 40% — monthly stacked bar.
            Mobile: HTML y-axis overlay (sticky left) + horizontally-
            scrollable canvas with all 12 month labels visible. */}
        <div className="totals-bar-wrap">
          {isMobile ? (
            <div style={{ display: 'flex', height: '100%', width: '100%' }}>
              <div
                style={{
                  width: '32px',
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
                <div style={{ position: 'relative', height: '100%', minWidth: '866px' }}>
                  <canvas ref={barCanvas} />
                </div>
              </div>
            </div>
          ) : (
            <canvas ref={barCanvas} />
          )}
        </div>

        {/* 40% — pie on top, horizontal toggle bar below */}
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
                <button
                  className={hbarMode === 'total' ? 'active' : ''}
                  onClick={() => setHbarMode('total')}
                >
                  Total
                </button>
                <button
                  className={hbarMode === 'avg' ? 'active' : ''}
                  onClick={() => setHbarMode('avg')}
                >
                  Avg
                </button>
              </div>
            </div>
            <div className="hbar-canvas">
              <canvas ref={hbarCanvas} />
            </div>
          </div>
        </div>

          {/* 20% — filter panel, full height */}
          <div className="totals-filters">
            {/* ── Yearly goals ── */}
            <div className="goals-section">
              <div className="goals-header">
                <span>Goals</span>
                {!editingGoal && (
                  <button className="goals-add" onClick={startAddGoal} title="Add a goal">+</button>
                )}
              </div>

              {editingGoal ? (
                <div className="goal-editor">
                  <select
                    value={editingGoal.activityId}
                    onChange={(e) => setEditingGoal({ ...editingGoal, activityId: e.target.value })}
                    disabled={!editingGoal.isNew}
                  >
                    <option value="">Select activity…</option>
                    {ACTIVITIES.map((a) => (
                      <option
                        key={a.id}
                        value={a.id}
                        disabled={editingGoal.isNew && goals[a.id] != null}
                      >
                        {a.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={editingGoal.target}
                    onChange={(e) => setEditingGoal({ ...editingGoal, target: Number(e.target.value) })}
                    placeholder="Hours"
                  />
                  <div className="goal-editor-actions">
                    <div className="goal-editor-row">
                      <button
                        className="goal-save"
                        disabled={!editingGoal.activityId || editingGoal.target <= 0}
                        onClick={saveGoal}
                      >
                        Save
                      </button>
                      {!editingGoal.isNew && (
                        <button className="goal-delete" onClick={deleteGoal}>Delete</button>
                      )}
                    </div>
                    <button className="goal-cancel" onClick={cancelGoal}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="goals-list">
                  {Object.keys(goals).length === 0 && (
                    <div className="goals-empty">No goals set</div>
                  )}
                  {Object.entries(goals).map(([id, target]) => {
                    const a = ACTIVITY_BY_ID[id];
                    if (!a) return null;
                    const current = yearly[id] || 0;
                    const pct = target > 0 ? (current / target) * 100 : 0;
                    return (
                      <div
                        key={id}
                        className="goal-badge"
                        style={{ background: a.color, color: a.labelColor }}
                        onClick={() => startEditGoal(id, target)}
                        title={`Edit ${a.label} goal`}
                      >
                        <div className="goal-current">{current.toFixed(2)}</div>
                        <div className="goal-target">
                          {pct.toFixed(1)}% / {target}h
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <input
              type="text"
              className="search-input"
              placeholder="Search activity…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ul className="activity-list">
              {panelActivities.map((a) => {
                const hrs = yearly[a.id] || 0;
                const isOn = visible.has(a.id);
                return (
                  <li
                    key={a.id}
                    className={`activity-row ${isOn ? '' : 'off'}`}
                    onClick={() => toggle(a.id)}
                  >
                    <span
                      className="activity-checkbox"
                      style={{ borderColor: a.color, background: isOn ? a.color : 'transparent' }}
                    />
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

// Lighten a hex color by a fraction (0..1) for hover highlight on stacked bars.
function lightenHex(hex, frac) {
  if (!hex || hex[0] !== '#') return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lighten = (c) => Math.min(255, Math.round(c + (255 - c) * frac));
  const to2 = (c) => c.toString(16).padStart(2, '0');
  return `#${to2(lighten(r))}${to2(lighten(g))}${to2(lighten(b))}`;
}

export default TotalsView;
