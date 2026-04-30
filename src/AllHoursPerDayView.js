import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { ACTIVITIES, PE_ACTIVITY, STACK_ORDER } from './activities';
import { useAllDailyTotals } from './useAllDailyTotals';
import { labelAnchor, labelAlign, labelOffset } from './labelLayout';
import DateInput from './DateInput';
import { useIsMobile } from './useIsMobile';
import './HoursPerDayView.css';

Chart.register(...registerables, ChartDataLabels);

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dowIdx = (jsDay) => (jsDay + 6) % 7; // 0 = Monday

function AllHoursPerDayView() {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState('total'); // 'total' | 'daily' | 'totalPe' | 'dailyPe'
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(() => new Set(STACK_ORDER));
  const [chartReady, setChartReady] = useState(false);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

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

  const span = useMemo(() => {
    const keys = Object.keys(dailyTotals).sort();
    if (keys.length === 0) return { min: '', max: '' };
    return { min: keys[0], max: keys[keys.length - 1] };
  }, [dailyTotals]);

  const range = useMemo(() => ({
    start: startDate || span.min,
    end: endDate || span.max,
  }), [startDate, endDate, span]);

  const { buckets, counts } = useMemo(() => {
    const buckets = Array.from({ length: 7 }, () => ({}));
    const counts = Array.from({ length: 7 }, () => 0);
    for (const [date, day] of Object.entries(dailyTotals)) {
      if (!day) continue;
      if (range.start && date < range.start) continue;
      if (range.end && date > range.end) continue;
      const [yy, mm, dd] = date.split('-').map(Number);
      const wd = dowIdx(new Date(yy, mm - 1, dd).getDay());
      counts[wd]++;
      for (const [act, hrs] of Object.entries(day)) {
        buckets[wd][act] = (buckets[wd][act] || 0) + hrs;
      }
    }
    return { buckets, counts };
  }, [dailyTotals, range]);

  const totals = useMemo(() => {
    const out = {};
    for (const wd of buckets) {
      for (const [act, hrs] of Object.entries(wd)) out[act] = (out[act] || 0) + hrs;
    }
    return out;
  }, [buckets]);

  const hasData = useMemo(
    () => counts.some((c) => c > 0),
    [counts]
  );

  const isPe = mode === 'totalPe' || mode === 'dailyPe';
  const isDaily = mode === 'daily' || mode === 'dailyPe';
  const activities = isPe ? [PE_ACTIVITY] : ACTIVITIES;
  const visibleSet = isPe ? new Set(['PE']) : visible;

  const panelActivities = useMemo(() => {
    const source = isPe ? [PE_ACTIVITY] : ACTIVITIES;
    return [...source]
      .filter((a) => a.label.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (totals[b.id] || 0) - (totals[a.id] || 0));
  }, [search, totals, isPe]);

  const toggle = (id) => {
    setVisible((prev) => {
      if (prev.has(id) && prev.size === 1) return new Set(STACK_ORDER);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const only = (id) => setVisible(new Set([id]));

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
          borderColor: '#202124',
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
            display: (ctx) => {
              const v = ctx.dataset.data[ctx.dataIndex] || 0;
              return isDaily ? v >= 0.2 : v >= 20;
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
          x: { stacked: true, ticks: { color: '#9aa0a6', font: { size: 11 } }, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { color: '#e8eaed', font: { size: 11, weight: '500' } }, grid: { color: 'rgba(255,255,255,0.16)' } },
        },
      },
    };

    if (chartRef.current) {
      chartRef.current.data = config.data;
      chartRef.current.options = config.options;
      chartRef.current.update();
      setChartReady(true);
    } else {
      chartRef.current = new Chart(canvasRef.current.getContext('2d'), config);
      requestAnimationFrame(() => {
        if (chartRef.current) { chartRef.current.resize(); chartRef.current.update(); setChartReady(true); }
      });
    }
  }, [buckets, counts, activities, visibleSet, mode, loaded, isDaily]);

  useEffect(() => () => {
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }
  }, []);

  const titleText = (startDate || endDate) ? 'Range Hours Per Day' : 'All-Time Hours Per Day';
  const titleEl = <h1 className="hpd-title">{titleText}</h1>;

  return (
    <div className="hpd-view">
      {isMobile && (
        <div className="hpd-mobile-topbar">{titleEl}</div>
      )}
      <div className="hpd-chart-area">
        <div className="hpd-header">
          <div className="view-toggle">
            <button className={mode === 'total' ? 'active' : ''} onClick={() => setMode('total')}>Total</button>
            <button className={mode === 'daily' ? 'active' : ''} onClick={() => setMode('daily')}>Daily</button>
          </div>
          {!isMobile && titleEl}
          <div className="view-toggle right-group">
            <button className={mode === 'totalPe' ? 'active' : ''} onClick={() => setMode('totalPe')}>Total PE</button>
            <button className={mode === 'dailyPe' ? 'active' : ''} onClick={() => setMode('dailyPe')}>Daily PE</button>
          </div>
        </div>

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
            <button className="range-clear" onClick={() => { setStartDate(''); setEndDate(''); }}>
              Clear
            </button>
          )}
          <span className="range-info">
            Showing {span.min || '—'} → {span.max || '—'}
          </span>
        </div>

        <div className="hpd-canvas">
          {(!loaded || !chartReady) && (
            <div className="hpd-loading">
              <div className="loading-spinner" />
              <div>Loading…</div>
            </div>
          )}
          {loaded && chartReady && !hasData && (
            <div className="no-data-msg">No data for this range</div>
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
            const hrs = totals[a.id] || 0;
            const isOn = visibleSet.has(a.id);
            return (
              <li key={a.id} className={`activity-row ${isOn ? '' : 'off'}`} onClick={() => !isPe && toggle(a.id)}>
                <span className="activity-checkbox" style={{ borderColor: a.color, background: isOn ? a.color : 'transparent' }} />
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

export default AllHoursPerDayView;
