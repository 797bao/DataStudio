import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { ACTIVITIES, PE_ACTIVITY, STACK_ORDER } from './activities';
import { useYearTotals } from './useYearTotals';
import { labelAnchor, labelAlign, labelOffset } from './labelLayout';
import './HoursPerDayView.css';

Chart.register(...registerables, ChartDataLabels);

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// JS getDay(): 0=Sun..6=Sat. Map to our Mon-first index 0..6.
const dowIdx = (jsDay) => (jsDay + 6) % 7;

function HoursPerDayView({ year }) {
  // 'total' | 'daily' | 'totalPe' | 'dailyPe' — exactly one is active across both groups.
  const [mode, setMode] = useState('total');
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(() => new Set(STACK_ORDER));
  // Tracks whether chart.js has finished its first paint for this year.
  // Loading overlay stays up until BOTH data is loaded AND the chart is drawn.
  const [chartReady, setChartReady] = useState(false);

  const { data: dailyTotals, loaded } = useYearTotals(year);
  const hasData = useMemo(
    () => Object.keys(dailyTotals).length > 0,
    [dailyTotals]
  );

  // Reset chart-ready state when the year changes (chart needs to redraw).
  useEffect(() => { setChartReady(false); }, [year]);

  // ── Bucket by weekday ──
  const { buckets, counts } = useMemo(() => {
    // buckets[wd][activityId] = total hours across all matching weekdays in year
    const buckets = Array.from({ length: 7 }, () => ({}));
    const counts = Array.from({ length: 7 }, () => 0);

    for (const [date, day] of Object.entries(dailyTotals)) {
      if (!day) continue;
      const [yy, mm, dd] = date.split('-').map(Number);
      const wd = dowIdx(new Date(yy, mm - 1, dd).getDay());
      counts[wd]++;
      for (const [act, hrs] of Object.entries(day)) {
        buckets[wd][act] = (buckets[wd][act] || 0) + hrs;
      }
    }
    return { buckets, counts };
  }, [dailyTotals]);

  // Year-wide totals for the panel
  const yearly = useMemo(() => {
    const out = {};
    for (const wd of buckets) {
      for (const [act, hrs] of Object.entries(wd)) out[act] = (out[act] || 0) + hrs;
    }
    return out;
  }, [buckets]);

  const isPe = mode === 'totalPe' || mode === 'dailyPe';
  const isDaily = mode === 'daily' || mode === 'dailyPe';

  const activities = isPe ? [PE_ACTIVITY] : ACTIVITIES;
  const visibleSet = isPe ? new Set(['PE']) : visible;

  const panelActivities = useMemo(() => {
    const source = isPe ? [PE_ACTIVITY] : ACTIVITIES;
    return [...source]
      .filter((a) => a.label.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (yearly[b.id] || 0) - (yearly[a.id] || 0));
  }, [search, yearly, isPe]);

  const toggle = (id) => {
    setVisible((prev) => {
      if (prev.has(id) && prev.size === 1) return new Set(STACK_ORDER);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const only = (id) => setVisible(new Set([id]));

  // ── Chart ──
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!loaded || !canvasRef.current) return;

    const datasets = activities
      .filter((a) => visibleSet.has(a.id))
      .map((a) => {
        const data = buckets.map((wd, i) => {
          const total = wd[a.id] || 0;
          const value = isDaily && counts[i] > 0 ? total / counts[i] : total;
          return Math.round(value * 100) / 100;
        });
        return {
          label: a.label,
          data,
          backgroundColor: a.color,
          borderColor: '#232732',
          borderWidth: { top: 1.5, bottom: 0, left: 0, right: 0 },
          borderSkipped: false,
          stack: 'hours',
          _activity: a,
        };
      });

    const config = {
      type: 'bar',
      data: { labels: WEEKDAYS, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 }, // instant render — feels snappier on revisit
        // Hover anywhere over a weekday → highlight every segment in that stack.
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
            display: (ctx) => {
              const v = ctx.dataset.data[ctx.dataIndex] || 0;
              return isDaily ? v >= 0.2 : v >= 4;
            },
            color: (ctx) => ctx.dataset._activity?.labelColor || '#fff',
            font: { weight: '500', size: 10 },
            formatter: (v) => (v ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : ''),
            anchor: labelAnchor,
            align: labelAlign,
            offset: labelOffset,
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: { color: '#9aa0a6', font: { size: 11 } },
            grid: { display: false },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            ticks: { color: '#e8eaed', font: { size: 11, weight: '500' } },
            grid: { color: 'rgba(255,255,255,0.16)' },
          },
        },
      },
    };

    if (chartRef.current) {
      chartRef.current.data = config.data;
      chartRef.current.options = config.options;
      chartRef.current.update();
      setChartReady(true);
    } else {
      // First mount: attach a one-shot plugin that fires AFTER chart.js
      // has actually painted to canvas. RAF alone races against chart.js's
      // own RAF, so hiding the overlay too early left the canvas blank.
      const firstPaint = {
        id: 'firstPaint_' + Math.random().toString(36).slice(2),
        afterDraw(chart) {
          if (chart._firstPaintFired) return;
          chart._firstPaintFired = true;
          setChartReady(true);
        },
      };
      chartRef.current = new Chart(canvasRef.current.getContext('2d'), {
        ...config,
        plugins: [firstPaint],
      });
      // Force a resize after one frame so the chart picks up the actual
      // flex-settled canvas dimensions; afterDraw will then fire.
      requestAnimationFrame(() => {
        if (!chartRef.current) return;
        chartRef.current.resize();
        chartRef.current.update();
      });
    }
  }, [buckets, counts, activities, visibleSet, mode, loaded, isDaily]);

  useEffect(() => () => {
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
  }, []);

  return (
    <div className="hpd-view">
      <div className="hpd-chart-area">
        <div className="hpd-header">
          <div className="view-toggle">
            <button className={mode === 'total' ? 'active' : ''} onClick={() => setMode('total')}>Total</button>
            <button className={mode === 'daily' ? 'active' : ''} onClick={() => setMode('daily')}>Daily</button>
          </div>
          <h1 className="hpd-title">{year} Hours Per Day</h1>
          <div className="view-toggle right-group">
            <button className={mode === 'totalPe' ? 'active' : ''} onClick={() => setMode('totalPe')}>Total PE</button>
            <button className={mode === 'dailyPe' ? 'active' : ''} onClick={() => setMode('dailyPe')}>Daily PE</button>
          </div>
        </div>
        <div className="hpd-canvas">
          {/* Canvas is always mounted so chart.js can size & render reliably.
              Loading overlay covers it while data is in flight OR while the
              chart hasn't completed its first paint yet. */}
          {(!loaded || !chartReady) && (
            <div className="hpd-loading">
              <div className="loading-spinner" />
              <div>Loading {year}…</div>
            </div>
          )}
          {loaded && chartReady && !hasData && (
            <div className="no-data-msg">No data for {year}</div>
          )}
          <canvas ref={canvasRef} />
        </div>
      </div>

      <aside className="hpd-panel">
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
            const isOn = visibleSet.has(a.id);
            return (
              <li
                key={a.id}
                className={`activity-row ${isOn ? '' : 'off'}`}
                onClick={() => !isPe && toggle(a.id)}
              >
                <span
                  className="activity-checkbox"
                  style={{
                    borderColor: a.color,
                    background: isOn ? a.color : 'transparent',
                  }}
                />
                <span className="activity-name" style={{ color: isOn ? a.color : '#666' }}>
                  {a.label}
                </span>
                <span className="activity-hours">{hrs ? hrs.toFixed(1) : '0'}</span>
                {!isPe && (
                  <button className="only-btn" onClick={(e) => { e.stopPropagation(); only(a.id); }}>
                    ONLY
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}

export default HoursPerDayView;
