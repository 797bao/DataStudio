import React, { useEffect, useMemo, useRef, useState } from 'react';
import './DateInput.css';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Custom date picker. Replaces <input type="date"> so the month/year
 * navigation in the calendar header is an overlay dropdown rather than
 * the native picker's "swap-the-calendar-out" mode.
 *
 * Props:
 *   value: 'YYYY-MM-DD' | ''      — current selection ('' for unset)
 *   onChange(newValue: string)    — fires with 'YYYY-MM-DD' or '' (clear)
 *   min, max: 'YYYY-MM-DD'        — selectable bounds (clamps the picker)
 *   placeholder: string           — shown when value is empty
 */
function DateInput({ value, onChange, min, max, placeholder = 'mm/dd/yyyy' }) {
  const [open, setOpen] = useState(false);
  const [ymOpen, setYmOpen] = useState(false);
  // Initial state — overridden by the useEffect below the moment the
  // popover opens (seeds to the current value, or min, or today).
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth() + 1);
  const ref = useRef(null);

  // When the popover opens, seed the view to the current selection (or min).
  useEffect(() => {
    if (!open) return;
    const seed = value
      ? parseDateStr(value)
      : (min ? parseDateStr(min) : new Date());
    setViewYear(seed.getFullYear());
    setViewMonth(seed.getMonth() + 1);
    setYmOpen(false);
  }, [open, value, min]);

  // Click-outside to close everything.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setYmOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Build month/year options for the header dropdown — every month between
  // min and max, newest-first.
  const ymOptions = useMemo(() => {
    if (!min || !max) return [];
    const start = parseDateStr(min);
    const end = parseDateStr(max);
    const out = [];
    let y = end.getFullYear();
    let m = end.getMonth() + 1;
    const startY = start.getFullYear();
    const startM = start.getMonth() + 1;
    while (y > startY || (y === startY && m >= startM)) {
      out.push({ year: y, month: m });
      m -= 1;
      if (m < 1) { m = 12; y -= 1; }
    }
    return out;
  }, [min, max]);

  const cells = useMemo(() => buildCalendar(viewYear, viewMonth), [viewYear, viewMonth]);

  const inBounds = (dateStr) => {
    if (min && dateStr < min) return false;
    if (max && dateStr > max) return false;
    return true;
  };

  const prevMonth = () => {
    let y = viewYear, m = viewMonth - 1;
    if (m < 1) { m = 12; y -= 1; }
    setViewYear(y); setViewMonth(m);
  };
  const nextMonth = () => {
    let y = viewYear, m = viewMonth + 1;
    if (m > 12) { m = 1; y += 1; }
    setViewYear(y); setViewMonth(m);
  };

  const today = todayStr();

  return (
    <div className="dp" ref={ref}>
      <button
        type="button"
        className={`dp-trigger ${value ? '' : 'placeholder'}`}
        onClick={() => setOpen((o) => !o)}
      >
        {value ? formatDisplay(value) : placeholder}
        <span className="dp-icon">▾</span>
      </button>

      {open && (
        <div className="dp-popover">
          <div className="dp-header">
            <button type="button" className="dp-nav" onClick={prevMonth}>‹</button>

            <div className="dp-ym-wrap">
              <button
                type="button"
                className="dp-ym"
                onClick={() => setYmOpen((o) => !o)}
              >
                {MONTH_NAMES[viewMonth - 1]} {viewYear}
                <span className="dp-caret">▾</span>
              </button>

              {/* Month/year DROPDOWN that overlays the calendar — calendar
                  stays in place behind it; this is *not* a context swap. */}
              {ymOpen && (
                <ul className="dp-ym-list">
                  {ymOptions.map((opt) => {
                    const active = opt.year === viewYear && opt.month === viewMonth;
                    return (
                      <li
                        key={`${opt.year}-${opt.month}`}
                        className={`dp-ym-item ${active ? 'active' : ''}`}
                        onClick={() => {
                          setViewYear(opt.year);
                          setViewMonth(opt.month);
                          setYmOpen(false);
                        }}
                      >
                        {MONTH_ABBR[opt.month - 1]} {opt.year}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <button type="button" className="dp-nav" onClick={nextMonth}>›</button>
          </div>

          <div className="dp-weekdays">
            {WEEKDAY_ABBR.map((d) => (
              <div key={d} className="dp-weekday">{d}</div>
            ))}
          </div>

          <div className="dp-grid">
            {cells.map((cell) => {
              const ok = inBounds(cell.date);
              const isSelected = cell.date === value;
              const isToday = cell.date === today;
              return (
                <button
                  key={cell.date}
                  type="button"
                  className={`dp-day ${cell.dim ? 'dim' : ''} ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                  disabled={!ok}
                  onClick={() => {
                    onChange(cell.date);
                    setOpen(false);
                  }}
                >
                  {parseInt(cell.date.slice(8, 10), 10)}
                </button>
              );
            })}
          </div>

          {value && (
            <button
              type="button"
              className="dp-clear"
              onClick={() => { onChange(''); setOpen(false); }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── helpers ──
function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDisplay(s) {
  const [y, m, d] = s.split('-');
  return `${m}/${d}/${y}`;
}

function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

function buildCalendar(year, month) {
  const firstDay = new Date(year, month - 1, 1);
  const startDow = firstDay.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysInPrev = new Date(year, month - 1, 0).getDate();

  const cells = [];
  // Leading days from previous month
  const prevYear = month - 1 < 1 ? year - 1 : year;
  const prevMonth = month - 1 < 1 ? 12 : month - 1;
  for (let i = startDow - 1; i >= 0; i--) {
    const d = daysInPrev - i;
    cells.push({
      date: `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      dim: true,
    });
  }
  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      date: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      dim: false,
    });
  }
  // Trailing days from next month — pad to a clean 6 rows.
  const nextYear = month + 1 > 12 ? year + 1 : year;
  const nextMonth = month + 1 > 12 ? 1 : month + 1;
  let trailing = 1;
  while (cells.length < 42) {
    cells.push({
      date: `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(trailing).padStart(2, '0')}`,
      dim: true,
    });
    trailing += 1;
  }
  return cells;
}

export default DateInput;
