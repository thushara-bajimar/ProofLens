/** Small inline SVG icon set (no external icon library needed). */
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const Icon = ({ name, size = 18 }) => {
  const p = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, ...base };
  switch (name) {
    case 'check': return <svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
    case 'x': return <svg {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>;
    case 'question': return <svg {...p}><path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5" /><circle cx="12" cy="18" r="0.6" fill="currentColor" /></svg>;
    case 'alert': return <svg {...p}><path d="M12 8v5" /><circle cx="12" cy="16.5" r="0.6" fill="currentColor" /><path d="M10.3 3.9L2.4 17.6A2 2 0 0 0 4.1 20.6h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>;
    case 'minus': return <svg {...p}><path d="M6 12h12" /></svg>;
    case 'info': return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="8" r="0.6" fill="currentColor" /></svg>;
    case 'upload': return <svg {...p}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>;
    case 'shield': return <svg {...p}><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-4.5" /></svg>;
    case 'key': return <svg {...p}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></svg>;
    case 'hash': return <svg {...p}><path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16" /></svg>;
    case 'eye': return <svg {...p}><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'drop': return <svg {...p}><path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z" /></svg>;
    case 'file': return <svg {...p}><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5" /></svg>;
    case 'phone': return <svg {...p}><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M11 18h2" /></svg>;
    case 'arrow': return <svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case 'download': return <svg {...p}><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></svg>;
    case 'lock': return <svg {...p}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>;
    case 'layers': return <svg {...p}><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></svg>;
    default: return null;
  }
};

export const STATUS_ICON = { passed: 'check', failed: 'x', warning: 'alert', absent: 'minus', not_checked: 'minus', info: 'info' };
export const STATUS_LABEL = { passed: 'Passed', failed: 'Failed', warning: 'Caution', absent: 'Not found', not_checked: 'Not checked', info: 'Info' };
export const VERDICT_ICON = { VERIFIED: 'shield', UNKNOWN: 'question', CONTRADICTED: 'alert' };
