import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ACTIVITY_BY_ID } from './activities';
import { useIsMobile } from './useIsMobile';
import './GanttChart.css';

// 'HH:MM' or 'HH:MM:SS' -> minutes since midnight ('24:00' -> 1440)
function parseMin(s) {
  if (!s) return 0;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
}

// '09:00' -> '9:00 AM', '17:30' -> '5:30 PM', '24:00' -> '12:00 AM'.
function formatTimeAmPm(hhmm) {
  if (!hhmm) return '';
  const [h, m = 0] = hhmm.split(':').map(Number);
  const hh = h % 24;
  const mm = String(m).padStart(2, '0');
  if (hh === 0) return `12:${mm} AM`;
  if (hh === 12) return `12:${mm} PM`;
  if (hh < 12) return `${hh}:${mm} AM`;
  return `${hh - 12}:${mm} PM`;
}

// Lay out a day's entries into render-blocks.
// Single-stream stretches stay full width; only the actually-overlapping
// portion of an entry shrinks to share width with its parallel partner(s).
//
// Algorithm:
//   1. Greedy stable lane assignment (entry -> laneIdx) so a given activity
//      keeps the same lane across every segment it appears in.
//   2. Slice the day at every start/end boundary; for each slice, count
//      how many entries are active and emit a render-block per active entry
//      with width = 1/maxLane and left = laneIdx/maxLane.
function layoutDay(entries) {
  if (!entries.length) return [];

  const parsed = entries
    .map((e) => ({ ...e, startMin: parseMin(e.start), endMin: parseMin(e.end) }))
    .filter((e) => e.endMin > e.startMin);
  if (!parsed.length) return [];

  // Stable lane per entry
  const sorted = [...parsed].sort((a, b) => a.startMin - b.startMin);
  const laneEnds = []; // when each lane next becomes free
  const entryLane = new Map();
  for (const e of sorted) {
    let lane = laneEnds.findIndex((end) => end <= e.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(e.endMin);
    } else {
      laneEnds[lane] = e.endMin;
    }
    entryLane.set(e, lane);
  }

  // Boundary times → segments
  const boundaries = new Set();
  for (const e of parsed) {
    boundaries.add(e.startMin);
    boundaries.add(e.endMin);
  }
  const sortedBoundaries = [...boundaries].sort((a, b) => a - b);

  const blocks = [];
  for (let i = 0; i < sortedBoundaries.length - 1; i++) {
    const segStart = sortedBoundaries[i];
    const segEnd = sortedBoundaries[i + 1];
    const active = parsed.filter((e) => e.startMin <= segStart && e.endMin >= segEnd);
    if (!active.length) continue;
    const maxLane = Math.max(...active.map((e) => entryLane.get(e))) + 1;
    for (const e of active) {
      blocks.push({
        entry: e,
        startMin: segStart,
        endMin: segEnd,
        laneIdx: entryLane.get(e),
        laneCount: maxLane,
      });
    }
  }
  return blocks;
}

const HOUR_TICKS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

function formatHour12(h) {
  if (h === 0 || h === 24) return '12 AM';
  if (h === 12) return '12 PM';
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

// Compact 24-hour format for the mobile y-axis ("0", "2", …, "24") —
// fits in a tighter column than "12 AM"/"2 PM".
function formatHour24(h) { return String(h); }

function GanttChart({ year, month, daysInMonth, entriesByDate, visible, showPe = false }) {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const isMobile = useIsMobile();

  const today = new Date();
  const todayDay =
    today.getFullYear() === year && today.getMonth() + 1 === month
      ? today.getDate()
      : null;

  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  useEffect(() => {
    if (todayDay === null) return;
    const id = setInterval(() => {
      const n = new Date();
      setNowMinutes(n.getHours() * 60 + n.getMinutes());
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [todayDay]);

  // Custom hover tooltip — instantaneous, styled to match the bar-chart tooltip.
  const wrapRef = useRef(null);
  const tooltipRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const showTooltip = (entry, e) => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setTooltip({
      entry,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  // Position the tooltip after each render: prefer down-right, but
  // flip up/left when it would clip the chart edges. We do this
  // imperatively in useLayoutEffect (before paint) so the user
  // never sees the tooltip in the wrong place.
  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current || !wrapRef.current) return;
    const tt = tooltipRef.current;
    const ttRect = tt.getBoundingClientRect();
    const wrapRect = wrapRef.current.getBoundingClientRect();
    const PAD = 8;
    const OFFSET = 12;

    let top = tooltip.y + OFFSET;
    let left = tooltip.x + OFFSET;
    if (top + ttRect.height > wrapRect.height - PAD) {
      top = tooltip.y - ttRect.height - OFFSET;
    }
    if (left + ttRect.width > wrapRect.width - PAD) {
      left = tooltip.x - ttRect.width - OFFSET;
    }
    tt.style.top = `${top}px`;
    tt.style.left = `${left}px`;
  }, [tooltip]);

  const days = useMemo(() => {
    const out = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateKey = `${ym}-${String(d).padStart(2, '0')}`;
      const all = entriesByDate[dateKey] || [];
      const list = Array.isArray(all) ? all : Object.values(all);
      const filtered = list.filter((e) => {
        if (e.activity === 'PE') return showPe;     // PE only when toggled on
        return visible.has(e.activity);
      });
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
        new Date(year, month - 1, d).getDay()
      ];
      out.push({ d, dow, blocks: layoutDay(filtered) });
    }
    return out;
  }, [ym, year, month, daysInMonth, entriesByDate, visible, showPe]);

  return (
    <div className="gantt-wrap" ref={wrapRef}>
      <div className="gantt-y-axis">
        {HOUR_TICKS.map((h) => (
          <div key={h} className="hour-tick" style={{ top: `${(h / 24) * 100}%` }}>
            <span className="hour-label">
              {isMobile ? formatHour24(h) : formatHour12(h)}
            </span>
          </div>
        ))}
      </div>

      <div className="gantt-grid">
        <div className="gantt-grid-inner">
          <div className="gantt-grid-bg">
            {HOUR_TICKS.slice(1, -1).map((h) => (
              <div key={h} className="hgrid" style={{ top: `${(h / 24) * 100}%` }} />
            ))}
            {todayDay !== null && (
              <div
                className="gantt-now-line"
                style={{ top: `${(nowMinutes / 1440) * 100}%` }}
              />
            )}
          </div>

          <div className="gantt-cols">
          {days.map(({ d, dow, blocks }) => {
            const isToday = todayDay === d;
            return (
              <div key={d} className={`gantt-col ${isToday ? 'today' : ''}`}>
                <div className="gantt-track">
                  {blocks.map((b, i) => {
                    const meta = ACTIVITY_BY_ID[b.entry.activity];
                    const color = meta ? meta.color : '#888';
                    const isPe = b.entry.activity === 'PE';
                    return (
                      <div
                        key={i}
                        className={`entry-block${isPe ? ' pe-overlay' : ''}`}
                        onMouseEnter={(e) => showTooltip(b.entry, e)}
                        onMouseMove={(e) => showTooltip(b.entry, e)}
                        onMouseLeave={() => setTooltip(null)}
                        style={{
                          top: `${(b.startMin / 1440) * 100}%`,
                          height: `${((b.endMin - b.startMin) / 1440) * 100}%`,
                          left: `${(b.laneIdx / b.laneCount) * 100}%`,
                          width: `${100 / b.laneCount}%`,
                          // PE entries get their visual from CSS (cross-hatch)
                          ...(isPe ? null : { background: color }),
                        }}
                      />
                    );
                  })}
                </div>
                <div className={`day-label ${isToday ? 'today' : ''}`}>
                  <div className="day-num">{d}</div>
                  <div className="day-dow">{dow}</div>
                </div>
              </div>
            );
          })}
        </div>
        </div>
      </div>

      {tooltip && (
        <div
          ref={tooltipRef}
          className="gantt-tooltip"
          // Off-screen initially; useLayoutEffect repositions before paint.
          style={{ left: '-9999px', top: '-9999px' }}
        >
          <div className="tt-title">
            <span
              className="tt-color"
              style={{ background: ACTIVITY_BY_ID[tooltip.entry.activity]?.color || '#888' }}
            />
            {ACTIVITY_BY_ID[tooltip.entry.activity]?.label || tooltip.entry.activity}
          </div>
          <div className="tt-row">
            {formatTimeAmPm(tooltip.entry.start)}–{formatTimeAmPm(tooltip.entry.end)}
          </div>
          {tooltip.entry.description && (
            <div className="tt-desc">{tooltip.entry.description}</div>
          )}
          <div className="tt-footer">
            Duration: {durationHours(tooltip.entry)}h
          </div>
        </div>
      )}
    </div>
  );
}

function durationHours(entry) {
  const v = (parseMin(entry.end) - parseMin(entry.start)) / 60;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

export default GanttChart;
