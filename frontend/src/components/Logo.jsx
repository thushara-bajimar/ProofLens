export const Logo = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="#1d4ed8" />
    <circle cx="14" cy="14" r="7" fill="none" stroke="#fff" strokeWidth="3" />
    <path d="M19 19l6 6" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    <path d="M11 14l2.2 2.2L17.5 12" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
