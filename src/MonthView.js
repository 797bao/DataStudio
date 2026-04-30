import React, { useState, useEffect, useMemo } from 'react';
import {
  ACTIVITY_BY_ID,
  PE_ACTIVITY,
  DATA_START_YEAR,
  DATA_START_MONTH,
  activitiesForYear,
  stackOrderForYear,
} from './activities';
import { useMonthData } from './useMonthData';
import { useEntriesData } from './useEntriesData';
import { useGoals } from './useGoals';
import StackedBarChart from './StackedBarChart';
import GanttChart from './GanttChart';
import MonthYearPicker from './MonthYearPicker';
import { useIsMobile } from './useIsMobile';
import './MonthView.css';

function MonthView({ year, month, onChangeView }) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const isMobile = useIsMobile();

  // School was retired in 2024 — for views in 2024+ these helpers
  // drop School from the activity list and stack order, so it won't
  // appear in chart legends, the panel filter, or the TOTAL stat.
  // Pre-2024 views still see it (historical data is preserved).
  const ACTIVITIES = useMemo(() => activitiesForYear(year), [year]);
  const STACK_ORDER = useMemo(() => stackOrderForYear(year), [year]);

  const [search, setSearch] = useState('');
  const [view, setView] = useState('bar'); // 'bar' | 'gantt' | 'pe'
  // Tracked activities only — PE is *not* in here by default; it's toggled
  // separately on the Gantt view via showPe (avoids the orange/School clash).
  const [visible, setVisible] = useState(() => new Set(STACK_ORDER));
  // Day-range filter from drag-on-bar; null = whole month.
  const [selectedRange, setSelectedRange] = useState(null);
  // Gantt-only PE overlay toggle. Default off — School is also orange.
  const [showPe, setShowPe] = useState(false);

  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const daysInMonth = new Date(year, month, 0).getDate();

  // Cached, persistent subscriptions
  const { data: dailyTotals, loaded: totalsLoaded } = useMonthData(ym);
  const { data: entriesByDate, loaded: entriesLoaded } = useEntriesData(ym);
  const { goals, setGoal, removeGoal } = useGoals(ym);
  // Loading state matches whichever view is active
  const loading = view === 'gantt' ? !entriesLoaded : !totalsLoaded;

  // Reset filter + day-range when month changes
  useEffect(() => {
    setVisible(new Set(STACK_ORDER));
    setSelectedRange(null);
    setShowPe(false);
  }, [year, month]);

  // Per-view data presence. Each view shows "No data" independently:
  //   bar  → any non-PE activity > 0
  //   pe   → any PE > 0
  //   gantt → any entry exists
  const hasBarData = useMemo(() => {
    for (const day of Object.values(dailyTotals)) {
      if (!day) continue;
      for (const [act, hrs] of Object.entries(day)) {
        if (act !== 'PE' && hrs > 0) return true;
      }
    }
    return false;
  }, [dailyTotals]);

  const hasPeData = useMemo(() => {
    for (const day of Object.values(dailyTotals)) {
      if (day && day.PE > 0) return true;
    }
    return false;
  }, [dailyTotals]);

  const hasGanttData = useMemo(() => {
    for (const dayEntries of Object.values(entriesByDate)) {
      if (Array.isArray(dayEntries) ? dayEntries.length > 0 : (dayEntries && Object.keys(dayEntries).length > 0)) {
        return true;
      }
    }
    return false;
  }, [entriesByDate]);

  // Goal-progress view always uses the whole-month totals — drag-selecting
  // a day range shouldn't change whether you "hit" your monthly goal.
  const monthlyTotalsFull = useMemo(() => {
    const totals = {};
    for (const day of Object.values(dailyTotals)) {
      if (!day) continue;
      for (const [act, hrs] of Object.entries(day)) {
        totals[act] = (totals[act] || 0) + hrs;
      }
    }
    return totals;
  }, [dailyTotals]);

  // Per-activity monthly totals — restricted to the selected day-range when active.
  const monthlyTotals = useMemo(() => {
    const totals = {};
    for (const dateKey of Object.keys(dailyTotals)) {
      if (selectedRange) {
        const dayNum = parseInt(dateKey.slice(8, 10), 10); // 1..31
        // selectedRange uses 0-based indices (day 1 = index 0)
        if (dayNum - 1 < selectedRange.start || dayNum - 1 > selectedRange.end) continue;
      }
      const day = dailyTotals[dateKey] || {};
      for (const [act, hrs] of Object.entries(day)) {
        totals[act] = (totals[act] || 0) + hrs;
      }
    }
    return totals;
  }, [dailyTotals, selectedRange]);

  const dayCount = selectedRange
    ? (selectedRange.end - selectedRange.start + 1)
    : daysInMonth;

  // Visible-sum / ratio depend on view: PE-only view is just PE hours.
  const visibleSum = useMemo(() => {
    if (view === 'pe') return Math.round((monthlyTotals.PE || 0) * 100) / 100;
    let s = 0;
    for (const id of visible) {
      if (id === 'PE') continue; // PE is excluded from the bar/gantt sum, matches the chart
      s += monthlyTotals[id] || 0;
    }
    return Math.round(s * 100) / 100;
  }, [monthlyTotals, visible, view]);

  const ratio = useMemo(() => {
    if (view === 'pe') return null;
    const work = visible.has('Work') ? (monthlyTotals['Work'] || 0) : 0;
    const other = visibleSum - work;
    if (work <= 0) return null;
    return Math.round((other / work) * 100) / 100;
  }, [monthlyTotals, visible, visibleSum, view]);

  const toggleActivity = (id) => {
    setVisible((prev) => {
      // If we're about to uncheck the *only* checked activity, restore all instead.
      if (prev.has(id) && prev.size === 1) {
        return new Set(STACK_ORDER);
      }
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const onlyActivity = (id) => {
    setVisible(new Set([id]));
  };

  // ── Goals add/edit state ──
  // null = list view; { activityId, target, isNew } = editor open
  const [editingGoal, setEditingGoal] = useState(null);
  useEffect(() => { setEditingGoal(null); }, [year, month]);

  // Tab key cycles bar ↔ gantt while this view is mounted. PE has its
  // own dedicated button (no key binding). We skip the toggle when
  // focus is inside an input — otherwise typing in the search field
  // or goal target would hijack the keystroke.
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key !== 'Tab') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      setView((v) => (v === 'bar' ? 'gantt' : 'bar'));
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const startAddGoal = () => setEditingGoal({ activityId: '', target: 30, isNew: true });
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

  // Right-panel activity list — sorted descending by month total so the
  // most active item always sits on top. Zero-hour rows fall to the bottom.
  const panelActivities = useMemo(() => {
    const source = view === 'pe' ? [PE_ACTIVITY] : ACTIVITIES;
    return [...source]
      .filter((a) => a.label.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => (monthlyTotals[b.id] || 0) - (monthlyTotals[a.id] || 0));
  }, [view, search, monthlyTotals]);

  // Picker is identical desktop/mobile; we just render it in different
  // locations so on phones the title sits up next to the hamburger
  // (rather than inside the chart card, eating vertical space).
  const picker = (
    <MonthYearPicker
      year={year}
      month={month}
      onSelect={(y, m) => onChangeView && onChangeView({ kind: 'month', year: y, month: m })}
      minYear={DATA_START_YEAR}
      maxYear={currentYear}
      minMonthInMinYear={DATA_START_MONTH}
      currentYear={currentYear}
      currentMonth={currentMonth}
    />
  );

  return (
    <div className="month-view">
      {isMobile && (
        <div className="month-mobile-topbar">{picker}</div>
      )}
      <div className="month-body">
        <div className="chart-area">
          <div className="month-header">
            <div className="view-toggle">
              <button className={view === 'bar' ? 'active' : ''} onClick={() => setView('bar')}>Bar</button>
              <button className={view === 'gantt' ? 'active' : ''} onClick={() => setView('gantt')}>Gantt</button>
              <button className={view === 'pe' ? 'active' : ''} onClick={() => setView('pe')}>PE</button>
            </div>
            {!isMobile && picker}
            <div className="header-right">
              {/* PE-overlay toggle is only useful when (a) Gantt view is
                  active AND (b) the month actually has PE entries to
                  show. Hide the button entirely otherwise — keeps the
                  header clean across desktop and mobile. */}
              {view === 'gantt' && hasPeData && (
                <div className="view-toggle right-group">
                  <button
                    className={showPe ? 'active' : ''}
                    onClick={() => setShowPe(v => !v)}
                    title="Show PE blocks (orange overlay)"
                  >
                    PE
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="chart-canvas">
            {/* Spinner overlays when the active view's data hasn't loaded yet */}
            {loading && (
              <div className="loading">
                <div className="loading-spinner" />
                <div>Loading {ym}…</div>
              </div>
            )}

            {/* "No data" message — per-view, since PE/Gantt/Bar have different sources */}
            {!loading && view === 'bar' && !hasBarData && (
              <div className="no-data-msg">No data for this month</div>
            )}
            {!loading && view === 'pe' && !hasPeData && (
              <div className="no-data-msg">No PE data for this month</div>
            )}
            {!loading && view === 'gantt' && !hasGanttData && (
              <div className="no-data-msg">No data for this month</div>
            )}

            {/* All three panes stay mounted after first load — toggling is just CSS. */}
            {totalsLoaded && (
              <div
                className="chart-pane"
                style={{ display: !loading && view === 'bar' ? 'block' : 'none' }}
              >
                <StackedBarChart
                  year={year}
                  month={month}
                  daysInMonth={daysInMonth}
                  dailyTotals={dailyTotals}
                  visible={visible}
                  activities={ACTIVITIES}
                  active={view === 'bar'}
                  selectedRange={selectedRange}
                  onSelectRange={setSelectedRange}
                />
              </div>
            )}

            {totalsLoaded && (
              <div
                className="chart-pane"
                style={{ display: !loading && view === 'pe' ? 'block' : 'none' }}
              >
                <StackedBarChart
                  year={year}
                  month={month}
                  daysInMonth={daysInMonth}
                  dailyTotals={dailyTotals}
                  visible={new Set(['PE'])}
                  activities={[PE_ACTIVITY]}
                  active={view === 'pe'}
                />
              </div>
            )}

            {entriesLoaded && (
              <div
                className="chart-pane"
                style={{ display: !loading && view === 'gantt' ? 'block' : 'none' }}
              >
                <GanttChart
                  year={year}
                  month={month}
                  daysInMonth={daysInMonth}
                  entriesByDate={entriesByDate}
                  visible={visible}
                  showPe={showPe}
                />
              </div>
            )}
          </div>
        </div>

        <aside className="totals-panel">
          <div className="totals-header">
            <div className="total-stat">
              <div className="stat-label">Total</div>
              <div className="stat-value">{visibleSum.toFixed(2)}</div>
            </div>
            <div className="total-stat">
              <div className="stat-label">Avg</div>
              <div className="stat-value">
                {(visibleSum / dayCount).toFixed(2)}
              </div>
            </div>
            <div className="total-stat">
              <div className="stat-label">Ratio</div>
              <div className="stat-value">{ratio === null ? '—' : ratio.toFixed(2)}</div>
            </div>
          </div>

          {/* ── Monthly goals ── */}
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
                  const current = monthlyTotalsFull[id] || 0;
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
              const hrs = monthlyTotals[a.id] || 0;
              const isOn = visible.has(a.id);
              return (
                <li
                  key={a.id}
                  className={`activity-row ${isOn ? '' : 'off'}`}
                  onClick={() => toggleActivity(a.id)}
                >
                  <span
                    className="activity-checkbox"
                    style={{
                      borderColor: a.color,
                      background: isOn ? a.color : 'transparent'
                    }}
                  />
                  <span className="activity-name" style={{ color: isOn ? a.color : '#666' }}>
                    {a.label}
                  </span>
                  <span className="activity-hours">{hrs ? hrs.toFixed(2) : '0'}</span>
                  <button
                    className="only-btn"
                    onClick={(e) => { e.stopPropagation(); onlyActivity(a.id); }}
                  >
                    ONLY
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}

export default MonthView;
