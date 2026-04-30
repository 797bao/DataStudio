import React, { useEffect, useMemo, useRef, useState } from 'react';
import './MonthYearPicker.css';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const MONTH_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/**
 * Click-to-open flat list of every available month, newest first
 * (e.g. "Apr 2026", "Mar 2026", …, "Oct 2020"). Picking one fires
 * onSelect(year, month) and closes the popover.
 */
function MonthYearPicker({
  year,
  month,
  onSelect,
  minYear,
  minMonthInMinYear = 1,
  currentYear,
  currentMonth,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Generate every valid (year, month) combo, newest-first.
  const options = useMemo(() => {
    const out = [];
    let y = currentYear;
    let m = currentMonth;
    while (y > minYear || (y === minYear && m >= minMonthInMinYear)) {
      out.push({ year: y, month: m });
      m -= 1;
      if (m < 1) { m = 12; y -= 1; }
    }
    return out;
  }, [minYear, minMonthInMinYear, currentYear, currentMonth]);

  // When the popover opens, scroll the active item into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector('.ymp-item.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [open]);

  return (
    <div className="ymp" ref={ref}>
      <button className="ymp-trigger" onClick={() => setOpen((o) => !o)} type="button">
        {MONTH_NAMES[month - 1]} {year}
        <span className="ymp-caret">▾</span>
      </button>
      {open && (
        <ul className="ymp-list" ref={listRef}>
          {options.map((opt) => {
            const isActive = opt.year === year && opt.month === month;
            return (
              <li
                key={`${opt.year}-${opt.month}`}
                className={`ymp-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  onSelect(opt.year, opt.month);
                  setOpen(false);
                }}
              >
                {MONTH_ABBR[opt.month - 1]} {opt.year}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default MonthYearPicker;
