// Single source of truth for activity colors, display labels, and stack order.
// IDs match the keys written by the Apps Script sync (Sync.gs COLOR_TO_ACTIVITY values).

// labelColor: '#000' when the bar fill is light enough that white text
// would wash out, '#fff' otherwise. Hardcoded per the user's spec — no luma
// guesswork — so adjacent shades like Strength vs Side Projects come out
// readable every time.
export const ACTIVITIES = [
  { id: 'Work',         label: 'Work',          color: '#b45f06', labelColor: '#fff' },
  { id: 'Cardio',       label: 'Cardio',        color: '#cadcfd', labelColor: '#000' },
  { id: 'GameDev',      label: 'Game Dev',      color: '#f44336', labelColor: '#fff' },
  { id: 'Strength',     label: 'Strength',      color: '#69a84e', labelColor: '#fff' },
  { id: 'SideProjects', label: 'Side Projects', color: '#6fa8dc', labelColor: '#000' },
  { id: 'Stretch',      label: 'Stretch',       color: '#b4a4da', labelColor: '#000' },
  { id: 'MiscProjects', label: 'Misc Projects', color: '#d31779', labelColor: '#fff' },
  { id: 'Arts',         label: 'Arts',          color: '#cddc39', labelColor: '#000' },
  { id: 'Music',        label: 'Music',         color: '#8bffff', labelColor: '#000' },
  { id: 'JobHunt',      label: 'Job Hunt',      color: '#f5c6ff', labelColor: '#000' },
  { id: 'AI',           label: 'AI',            color: '#92d4c0', labelColor: '#000' },
  { id: 'School',       label: 'School',        color: '#ffad3f', labelColor: '#000' },
  // PE (#ff9900) is intentionally excluded from the stacked bar chart.
];

// PE is overlay-only in the source data — kept separate so it never sneaks
// into the stacked bar by default. Surfaced explicitly in the PE-only view
// and in the Gantt (where parallel activities are the whole point).
export const PE_ACTIVITY = { id: 'PE', label: 'PE', color: '#ff9900', labelColor: '#000' };

export const ALL_ACTIVITIES = [...ACTIVITIES, PE_ACTIVITY];
export const ACTIVITY_BY_ID = Object.fromEntries(ALL_ACTIVITIES.map(a => [a.id, a]));

// Activities to render in the default stacked bar (PE excluded).
export const STACK_ORDER = ACTIVITIES.map(a => a.id);

// Owner of the database — must match the Firebase Auth UID used in security rules.
export const OWNER_UID = 'G6LOOmF0nfQl8IeMeLGIDzEptYj1';

// First month with any data ever logged. Years/months before this are not shown.
export const DATA_START_YEAR = 2020;
export const DATA_START_MONTH = 10; // October 2020 (1-indexed)
