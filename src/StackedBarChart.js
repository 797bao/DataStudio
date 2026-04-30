import React, { useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { ACTIVITIES } from './activities';
import { labelAnchor, labelAlign, labelOffset } from './labelLayout';

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

  // In-progress drag state — drives only the HTML overlay below, NOT the
  // chart redraw. The chart only re-renders on mouseup once the selection
  // is committed via onSelectRange().
  const dragRef = useRef(null);
  const [dragVis, setDragVis] = useState(null);
  const [overlayStyle, setOverlayStyle] = useState(null);

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d');
    const ym = `${year}-${String(month).padStart(2, '0')}`;

    // X labels: day numbers + weekday abbreviation, mirroring the screenshot.
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
          borderColor: '#232732',
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
            display: (ctx) => (ctx.dataset.data[ctx.dataIndex] || 0) >= 0.5,
            color: (ctx) => ctx.dataset._activity?.labelColor || '#fff',
            font: { weight: '500', size: 10 },
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
              autoSkip: false,
              maxRotation: 0,
              color: (ctx) => (isTodayCol(ctx.index) ? '#C58AF9' : '#9aa0a6'),
              font: (ctx) =>
                isTodayCol(ctx.index)
                  ? { size: 12, weight: '600' }
                  : { size: 11, weight: 'normal' },
            },
            grid: { display: false },             // 4. no vertical grid lines
            border: { color: 'rgba(255,255,255,0.15)' },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            min: 0,
            suggestedMax: 16,                     // 3. floor of 16h, scales beyond if needed
            ticks: {
              color: '#e8eaed',                   // 5. white-ish y-axis labels
              font: { size: 11, weight: '500' },  // 5. slight weight bump
              stepSize: 2,
            },
            grid: { color: 'rgba(255,255,255,0.16)' },  // 5. more visible row gridlines
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
  }, [year, month, daysInMonth, dailyTotals, visible, activities, selectedRange]);

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

  // When the bar pane becomes visible after being hidden, the canvas
  // was sized at 0×0 — force chart.js to re-measure and redraw.
  useEffect(() => {
    if (active && chartRef.current) {
      // Defer one frame so the parent's display:block has actually applied.
      const id = requestAnimationFrame(() => {
        if (chartRef.current) {
          chartRef.current.resize();
          chartRef.current.update();
        }
      });
      return () => cancelAnimationFrame(id);
    }
  }, [active]);

  // Destroy on unmount
  useEffect(() => {
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, []);

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <canvas ref={canvasRef} />
      {overlayStyle && (
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
      )}
    </div>
  );
}

export default StackedBarChart;
