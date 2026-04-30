import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { ACTIVITIES } from './activities';
import { labelAnchor, labelAlign, labelOffset } from './labelLayout';
import { useIsMobile } from './useIsMobile';

Chart.register(...registerables, ChartDataLabels);

// Append AA to a #RRGGBB hex to make a translucent color for out-of-selection bars.
function withAlpha(hex, alpha) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return hex;
  return hex.slice(0, 7) + alpha;
}

function StackedBarChart({
  year,
  month,
  daysInMonth,
  dailyTotals,
  visible,
  activities = ACTIVITIES,
  active = true,
  selectedRange = null,           // { start, end } — committed selection in 0-based indices
  onSelectRange = null,           // callback(range|null); enables drag-to-select if provided
}) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const isMobile = useIsMobile();
  // Mobile only — y-axis labels rendered as HTML, positioned by reading
  // the main chart's y-scale after it lays out. We tried a second
  // Chart.js instance but its auto label-area calc kept clipping the
  // leading "1" of "16/14/12/10". HTML lets us place each label
  // exactly where its tick would be, in a tiny column with no chart.js
  // layout heuristics in the way.
  const [yLabels, setYLabels] = useState([]);

  // In-progress drag state — drives only the HTML overlay below, NOT the
  // chart redraw. The chart only re-renders on mouseup once the selection
  // is committed via onSelectRange().
  const dragRef = useRef(null);
  const [dragVis, setDragVis] = useState(null);
  const [overlayStyle, setOverlayStyle] = useState(null);

  // Explicit y-axis max so the side y-axis chart stays in lockstep with
  // the main chart. Floor of 16h, rounded up to the next even number
  // above the largest stacked-day total.
  const yMax = useMemo(() => {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    let m = 16;
    for (let d = 1; d <= daysInMonth; d++) {
      const day = dailyTotals[`${ym}-${String(d).padStart(2, '0')}`] || {};
      let total = 0;
      for (const a of activities) {
        if (visible.has(a.id)) total += day[a.id] || 0;
      }
      if (total > m) m = total;
    }
    return Math.ceil(m / 2) * 2;
  }, [year, month, daysInMonth, dailyTotals, activities, visible]);

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    const ym = `${year}-${String(month).padStart(2, '0')}`;

    // X labels: stacked [day, dow] on both desktop and mobile. Mobile
    // gets a 720px chart (horizontal scroll), so we have room for both lines.
    const labels = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d);
      const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
      labels.push([String(d), dow]);
    }

    // Per-bar background: full opacity for in-range, ~20% otherwise. When no
    // selection is committed, all bars stay full opacity.
    const colorForIdx = (color, idx) => {
      if (!selectedRange) return color;
      const inRange = idx >= selectedRange.start && idx <= selectedRange.end;
      return inRange ? color : withAlpha(color, '33');
    };

    // One dataset per visible activity in the order supplied (controls visual stacking).
    const datasets = activities
      .filter((a) => visible.has(a.id))
      .map((a) => {
        const data = [];
        for (let d = 1; d <= daysInMonth; d++) {
          const dateKey = `${ym}-${String(d).padStart(2, '0')}`;
          const day = dailyTotals[dateKey] || {};
          data.push(day[a.id] || 0);
        }
        return {
          label: a.label,
          data,
          backgroundColor: data.map((_, idx) => colorForIdx(a.color, idx)),
          // 1.5px chart-area-bg-colored top border = visible gap between
          // stacked segments without losing the activity color anywhere else.
          borderColor: '#202124',
          borderWidth: { top: 1.5, bottom: 0, left: 0, right: 0 },
          borderSkipped: false,
          stack: 'hours',
          // Hold a reference to the activity so the datalabel callback can
          // use its prebaked labelColor (no per-frame luma math).
          _activity: a,
        };
      });

    // Today highlighting on the X axis
    const today = new Date();
    const isTodayCol = (idx) =>
      today.getFullYear() === year &&
      today.getMonth() + 1 === month &&
      today.getDate() === idx + 1;

    const config = {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        // On mobile, kill the chart's default left padding — the
        // separate y-axis chart sits to our left, and any gap here
        // breaks the visual continuity between the two.
        // top: 8 leaves room for the topmost HTML y-label ("16")
        // which is centered on the gridline and would otherwise be
        // half-clipped by the chart-area edge.
        layout: isMobile ? { padding: { left: 2, right: 2, top: 8 } } : {},
        // Hover anywhere over a day → highlight every segment in that stack.
        interaction: { mode: 'index', intersect: false, axis: 'x' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.9)',
            titleColor: '#fff',
            bodyColor: '#e8eaed',
            footerColor: '#C58AF9',
            footerFont: { weight: 'bold' },
            // Tooltip only when actually hovering a bar segment (overrides
            // interaction.intersect: false, which is kept for hover highlight).
            mode: 'index',
            intersect: true,
            axis: 'x',
            callbacks: {
              title: (items) => {
                if (!items.length) return '';
                const dayNum = items[0].label.replace(',', ' ');
                return `${dayNum} ${month}/${year}`;
              },
              label: (ctx) => {
                if (!ctx.parsed.y) return null;
                return `${ctx.dataset.label}: ${ctx.parsed.y}h`;
              },
              // Sum every segment of this stacked bar so the tooltip ends with the
              // total for the day on top of the per-segment lines.
              footer: (items) => {
                if (!items.length) return '';
                const idx = items[0].dataIndex;
                let total = 0;
                for (const ds of items[0].chart.data.datasets) {
                  total += ds.data[idx] || 0;
                }
                return `Total: ${(Math.round(total * 100) / 100)}h`;
              },
            },
            filter: (item) => item.parsed.y > 0,
          },
          datalabels: {
            // Show hour value near the top of each non-trivial segment.
            // Higher threshold on mobile — thin bars + small segments
            // would otherwise pile labels on top of each other.
            display: (ctx) => {
              const v = ctx.dataset.data[ctx.dataIndex] || 0;
              return isMobile ? v >= 1 : v >= 0.5;
            },
            color: (ctx) => ctx.dataset._activity?.labelColor || '#fff',
            font: { weight: '500', size: isMobile ? 9 : 10 },
            formatter: (v) => {
              if (!v) return '';
              return Number.isInteger(v) ? String(v) : v.toFixed(1);
            },
            // Top-of-segment by default; center for thin segments
            // (see labelLayout.js for the pixel-height threshold).
            anchor: labelAnchor,
            align: labelAlign,
            offset: labelOffset,
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks: {
              // Chart is 720px on mobile (forced via min-width), so all 30
              // day labels fit comfortably without skipping.
              autoSkip: false,
              maxRotation: 0,
              color: (ctx) => (isTodayCol(ctx.index) ? '#C58AF9' : '#9aa0a6'),
              font: (ctx) =>
                isTodayCol(ctx.index)
                  ? { size: isMobile ? 11 : 12, weight: '600' }
                  : { size: isMobile ? 10 : 11, weight: 'normal' },
            },
            grid: { display: false },             // 4. no vertical grid lines
            border: { color: 'rgba(255,255,255,0.15)' },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            min: 0,
            // Explicit max instead of suggestedMax so the side y-axis
            // chart on mobile (separate Chart.js instance) stays
            // synchronized with the main chart.
            max: yMax,
            ticks: {
              color: '#e8eaed',                   // 5. white-ish y-axis labels
              font: { size: 11, weight: '500' },  // 5. slight weight bump
              stepSize: 2,
              // Hide on mobile — yAxisCanvasRef chart renders these
              // labels in a fixed-position column instead.
              display: !isMobile,
            },
            // Always show horizontal gridlines so the user has visual
            // reference for hour values, even on mobile where the y-axis
            // labels live in a separate column to the left.
            grid: { color: 'rgba(255,255,255,0.16)' },
            title: { display: false },
          },
        },
      },
    };

    if (chartRef.current) {
      chartRef.current.data = config.data;
      chartRef.current.options = config.options;
      chartRef.current.update();
    } else {
      chartRef.current = new Chart(ctx, config);
    }

    // Mobile: re-populate the HTML y-axis labels using the main
    // chart's actual scale pixel positions. rAF gives chart.js a
    // beat to settle scales after first creation.
    if (isMobile) {
      requestAnimationFrame(() => {
        if (!chartRef.current) return;
        const yScale = chartRef.current.scales?.y;
        if (!yScale) return;
        const out = [];
        for (let v = 0; v <= yMax; v += 2) {
          out.push({ value: v, top: yScale.getPixelForValue(v) });
        }
        setYLabels(out);
      });
    } else if (yLabels.length) {
      setYLabels([]);
    }
  }, [year, month, daysInMonth, dailyTotals, visible, activities, selectedRange, isMobile, yMax]);


  // ── Drag-to-select on the X axis ─────────────────────────────────────────
  // Click+drag horizontally over bars to select a day range; single click
  // (no movement) clears the selection.
  useEffect(() => {
    if (!onSelectRange) return; // disabled if no callback supplied
    const canvas = canvasRef.current;
    if (!canvas) return;

    const idxAtClientX = (clientX) => {
      const chart = chartRef.current;
      if (!chart) return 0;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const raw = chart.scales.x.getValueForPixel(px);
      const len = chart.data.labels.length;
      return Math.max(0, Math.min(len - 1, Math.round(raw)));
    };

    const isInChartArea = (clientX, clientY) => {
      const chart = chartRef.current;
      if (!chart) return false;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const a = chart.chartArea;
      return px >= a.left && px <= a.right && py >= a.top && py <= a.bottom;
    };

    const onDown = (e) => {
      if (e.button !== 0) return;
      // Let chart.js handle clicks outside the plot area (e.g. legend toggles)
      if (!isInChartArea(e.clientX, e.clientY)) return;
      e.preventDefault();
      const i = idxAtClientX(e.clientX);
      // Set up the drag but DON'T show the preview yet — wait until the user
      // actually moves the mouse. A pure click (no movement) clears.
      dragRef.current = { startIdx: i, endIdx: i, moved: false };
    };

    const computeOverlay = (startIdx, endIdx) => {
      const chart = chartRef.current;
      if (!chart) return null;
      const a = chart.chartArea;
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      const left = chart.scales.x.getPixelForValue(lo - 0.5);
      const right = chart.scales.x.getPixelForValue(hi + 0.5);
      const xLeft = Math.max(a.left, left);
      const xRight = Math.min(a.right, right);
      return {
        left: `${xLeft}px`,
        top: `${a.top}px`,
        width: `${Math.max(0, xRight - xLeft)}px`,
        height: `${a.bottom - a.top}px`,
      };
    };

    const onMove = (e) => {
      if (!dragRef.current) return;
      const i = idxAtClientX(e.clientX);
      // ANY mouse movement counts — preview reveals on first move, even if
      // the cursor hasn't crossed into a different day yet.
      dragRef.current.moved = true;
      dragRef.current.endIdx = i;
      const startIdx = dragRef.current.startIdx;
      setDragVis({ startIdx, endIdx: i });
      setOverlayStyle(computeOverlay(startIdx, i));
    };

    const onUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      setDragVis(null);
      setOverlayStyle(null);
      if (!drag.moved) {
        // single click — clear any committed selection
        onSelectRange(null);
      } else {
        const start = Math.min(drag.startIdx, drag.endIdx);
        const end = Math.max(drag.startIdx, drag.endIdx);
        onSelectRange({ start, end });
      }
    };

    canvas.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      canvas.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [onSelectRange]);

  // When the bar/PE pane becomes visible after being hidden, the canvas
  // was sized at 0×0 — force chart.js to re-measure and redraw.
  // ALSO: re-populate the HTML y-axis labels here. The data effect
  // already populated them, but if we rendered while hidden the y-scale
  // pixel positions all collapsed to 0; we need to recompute now that
  // the canvas has a real height.
  useEffect(() => {
    if (active && chartRef.current) {
      const id = requestAnimationFrame(() => {
        if (!chartRef.current) return;
        chartRef.current.resize();
        chartRef.current.update();
        if (isMobile) {
          const yScale = chartRef.current.scales?.y;
          if (yScale) {
            const out = [];
            for (let v = 0; v <= yMax; v += 2) {
              out.push({ value: v, top: yScale.getPixelForValue(v) });
            }
            setYLabels(out);
          }
        }
      });
      return () => cancelAnimationFrame(id);
    }
  }, [active, isMobile, yMax]);

  // Destroy on unmount.
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, []);

  // Drag-selection overlay — same on desktop and mobile, just sized to
  // whichever wrapper holds the canvas.
  const dragOverlay = overlayStyle && (
    <div
      style={{
        position: 'absolute',
        ...overlayStyle,
        background: 'rgba(197, 138, 249, 0.18)',
        border: '1px solid rgba(197, 138, 249, 0.6)',
        pointerEvents: 'none',
        borderRadius: '2px',
      }}
    />
  );

  if (!isMobile) {
    return (
      <div style={{ position: 'relative', height: '100%', width: '100%' }}>
        <canvas ref={canvasRef} />
        {dragOverlay}
      </div>
    );
  }

  // Mobile: pinned HTML y-axis on the left + horizontally-scrollable bars.
  // The y-axis lives outside the scroll container so it stays visible
  // when the user swipes through the 30 day columns. Each label's `top`
  // is the actual scale.y.getPixelForValue(v) of the main chart, so
  // they line up with the gridlines exactly.
  return (
    <div style={{ display: 'flex', height: '100%', width: '100%' }}>
      <div
        style={{
          width: '26px',
          flexShrink: 0,
          height: '100%',
          position: 'relative',
          // No clipping here — labels can overflow the column visually
          // if needed (they won't, but it's safer than overflow:hidden).
        }}
      >
        {yLabels.map(({ value, top }) => (
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
        <div
          style={{
            position: 'relative',
            height: '100%',
            // 26px y-axis + ~870px bars ≈ 896px effective width
            // (~2.3× a 390px viewport — wider day columns).
            minWidth: '870px',
          }}
        >
          <canvas ref={canvasRef} />
          {dragOverlay}
        </div>
      </div>
    </div>
  );
}

export default StackedBarChart;
