import React, { useEffect, useMemo, useRef, useState } from 'react';
import './MonthYearPicker.css';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Year-level picker for the Totals / Hours-Per-Day pages.
 * Lists "{year} {yearLabel}" plus every month in that year (newest-first),
 * capped at currentMonth for the current year and at minMonthInYear for
 * the data-start year.
 *
 * Selecting the year-level option fires onSelect({ year }).
 * Selecting a month     fires onSelect({ year, month }).
 */
function YearMonthPicker({
  year,
  yearLabel,
  selectedMonth = null, // null means the year-level option is active
  onSelect,
  minMonthInYear = 1,
  maxMonthInYear = 12,
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

  // Newest-first months within the bounds.
  const monthOptions = useMemo(() => {
    const out = [];
    for (let m = maxMonthInYear; m >= minMonthInYear; m--) out.push(m);
    return out;
  }, [minMonthInYear, maxMonthInYear]);

  // Scroll active item into view when popover opens.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector('.ymp-item.active');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const triggerLabel = selectedMonth
    ? `${year} ${MONTH_NAMES[selectedMonth - 1]}`
    : `${year} ${yearLabel}`;

  return (
    <div className="ymp" ref={ref}>
      <button className="ymp-trigger" onClick={() => setOpen((o) => !o)} type="button">
        {triggerLabel}
        <span className="ymp-caret">▾</span>
      </button>
      {open && (
        <ul className="ymp-list" ref={listRef}>
          <li
            className={`ymp-item ${selectedMonth == null ? 'active' : ''}`}
            onClick={() => { onSelect({ year }); setOpen(false); }}
          >
            {year} {yearLabel}
          </li>
          {monthOptions.map((m) => (
            <li
              key={m}
              className={`ymp-item ${selectedMonth === m ? 'active' : ''}`}
              onClick={() => { onSelect({ year, month: m }); setOpen(false); }}
            >
              {year} {MONTH_NAMES[m - 1]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default YearMonthPicker;
