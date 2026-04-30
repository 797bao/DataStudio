import React, { useEffect, useState } from 'react';
import { DATA_START_YEAR, DATA_START_MONTH } from './activities';
import './Sidebar.css';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function Sidebar({ view, onSelect, user, onSignOut, width, onWidthChange, mobileOpen, onMobileClose }) {
  // Drag-to-resize. Listeners are attached to document so the user can drag
  // beyond the handle without losing the gesture.
  const startDrag = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev) => onWidthChange(startW + (ev.clientX - startX));
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Years from DATA_START_YEAR up to current year, descending? Actually
  // the screenshot shows ascending (2024, 2025, 2026). Mirror that.
  const years = [];
  for (let y = DATA_START_YEAR; y <= currentYear; y++) years.push(y);

  // Default-expand the currently-selected year.
  const [expanded, setExpanded] = useState({ [view.year]: true });
  const toggle = (y) => setExpanded((prev) => ({ ...prev, [y]: !prev[y] }));

  // When the active view's year changes (e.g. user picked a different year
  // in the MonthView dropdown), expand that year automatically so the
  // sidebar reveals the matching month.
  useEffect(() => {
    if (view.year != null) {
      setExpanded((prev) => (prev[view.year] ? prev : { ...prev, [view.year]: true }));
    }
  }, [view.year]);

  const isActive = (kind, y, m) =>
    view.kind === kind && view.year === y && (m === undefined || view.month === m);

  const monthsForYear = (y) => {
    let start = 1, end = 12;
    if (y === DATA_START_YEAR) start = DATA_START_MONTH;
    if (y === currentYear) end = currentMonth;
    const out = [];
    for (let m = start; m <= end; m++) out.push(m);
    return out;
  };

  return (
    <nav
      className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}
      style={{ width: width, minWidth: width }}
    >
      <button
        className="mobile-close-btn"
        onClick={onMobileClose}
        aria-label="Close menu"
      >
        ✕
      </button>
      <div className="sidebar-header">Life Log</div>
      <ul className="year-list">
        {/* All-time pages — above the year list. Default to entire data span; */}
        {/* the views themselves expose a date-range filter. */}
        <li
          className={`alltime-item ${view.kind === 'allTotals' ? 'active' : ''}`}
          onClick={() => onSelect({ kind: 'allTotals' })}
        >
          Totals
        </li>
        <li
          className={`alltime-item ${view.kind === 'allHoursPerDay' ? 'active' : ''}`}
          onClick={() => onSelect({ kind: 'allHoursPerDay' })}
        >
          Hours Per Day
        </li>

        {years.map((y) => (
          <li key={y} className="year-section">
            <div
              className={`year-header ${expanded[y] ? 'expanded' : ''}`}
              onClick={() => toggle(y)}
            >
              <span className={`chevron ${expanded[y] ? 'open' : ''}`}>&#x25B8;</span>
              <span className="year-text">{y}</span>
            </div>
            {expanded[y] && (
              <ul className="month-list">
                <li
                  className={`month-item special ${isActive('totals', y) ? 'active' : ''}`}
                  onClick={() => onSelect({ kind: 'totals', year: y })}
                >
                  Totals
                </li>
                <li
                  className={`month-item special ${isActive('hoursPerDay', y) ? 'active' : ''}`}
                  onClick={() => onSelect({ kind: 'hoursPerDay', year: y })}
                >
                  Hours Per Day
                </li>
                {monthsForYear(y).map((m) => (
                  <li
                    key={m}
                    className={`month-item ${isActive('month', y, m) ? 'active' : ''}`}
                    onClick={() => onSelect({ kind: 'month', year: y, month: m })}
                  >
                    {MONTH_NAMES[m - 1]}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <div className="sidebar-footer">
        {user && (
          <button className="signout-btn" onClick={onSignOut} title={user.email}>
            {user.photoURL && (
              <img src={user.photoURL} alt="" className="avatar" referrerPolicy="no-referrer" />
            )}
            <span className="signout-text">Sign out</span>
          </button>
        )}
      </div>

      <div className="resize-handle" onMouseDown={startDrag} />
    </nav>
  );
}

export default Sidebar;
