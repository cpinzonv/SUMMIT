/**
 * Custom Summit-brand SVG icons for the Learn tab (replaces emojis).
 * 24x24 viewBox, 2px strokes, currentColor — set color via the wrapping element.
 */
const base = (size, p) => ({ width: size, height: size, viewBox: '0 0 24 24', xmlns: 'http://www.w3.org/2000/svg', ...p });

export const FireIcon = ({ size = 20, ...p }) => (
  <svg {...base(size, p)}>
    {/* Outer flame silhouette (classic flame shape). */}
    <path
      d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"
      fill="currentColor"
    />
    {/* Inner flame highlight for depth. */}
    <path
      d="M12 14.5c1.5 0 2.5-1 2.5-2.4 0-1.1-.7-1.9-1.4-2.6-.3.8-.9 1.1-1.4 1.2.4-1.3-.2-2.5-1-3.4-.4 1.8-1.7 2.6-1.7 4.2 0 1.7 1.2 3 2 3z"
      fill="#fff"
      opacity="0.35"
    />
  </svg>
);

export const BrainIcon = ({ size = 20, ...p }) => (
  <svg {...base(size, p)}>
    <path d="M 6 12 Q 6 8, 8 6 Q 10 4, 12 4 Q 14 4, 16 6 Q 18 8, 18 12 L 18 16 Q 16 18, 12 19 Q 8 18, 6 16 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="10" cy="11" r="1.2" fill="currentColor" />
    <circle cx="12" cy="10" r="1.2" fill="currentColor" />
    <circle cx="14" cy="11" r="1.2" fill="currentColor" />
  </svg>
);

export const QuestionIcon = ({ size = 20, ...p }) => (
  <svg {...base(size, p)}>
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
    <text x="12" y="16.5" textAnchor="middle" fontSize="13" fontWeight="bold" fill="currentColor">?</text>
  </svg>
);

export const HeadphonesIcon = ({ size = 20, ...p }) => (
  <svg {...base(size, p)}>
    <path d="M 8 10 Q 6 8, 6 6 Q 6 4, 8 4 Q 10 4, 12 5 Q 14 4, 16 4 Q 18 4, 18 6 Q 18 8, 16 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="6" cy="14" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
    <circle cx="18" cy="14" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
  </svg>
);

export const BookIcon = ({ size = 20, ...p }) => (
  <svg {...base(size, p)}>
    <path d="M 5 4 L 5 20 Q 5 22, 7 22 L 19 22 L 19 4 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <line x1="7" y1="4" x2="7" y2="22" stroke="currentColor" strokeWidth="2" />
    <line x1="9" y1="9" x2="17" y2="9" stroke="currentColor" strokeWidth="1.5" />
    <line x1="9" y1="13" x2="17" y2="13" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export const NetworkIcon = ({ size = 20, ...p }) => (
  <svg {...base(size, p)}>
    <line x1="12" y1="12" x2="8" y2="8" stroke="currentColor" strokeWidth="1.5" />
    <line x1="12" y1="12" x2="16" y2="8" stroke="currentColor" strokeWidth="1.5" />
    <line x1="12" y1="12" x2="8" y2="16" stroke="currentColor" strokeWidth="1.5" />
    <line x1="12" y1="12" x2="16" y2="16" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    <circle cx="8" cy="8" r="1.6" fill="currentColor" />
    <circle cx="16" cy="8" r="1.6" fill="currentColor" />
    <circle cx="8" cy="16" r="1.6" fill="currentColor" />
    <circle cx="16" cy="16" r="1.6" fill="currentColor" />
  </svg>
);

export const ChartIcon = ({ size = 20, ...p }) => (
  <svg {...base(size, p)}>
    <rect x="4" y="14" width="3.5" height="6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <rect x="10.25" y="9" width="3.5" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    <rect x="16.5" y="5" width="3.5" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
  </svg>
);

// Gear: a toothed ring + center hub, drawn as a single stroked path so it scales
// cleanly and inherits currentColor.
export const SettingsIcon = ({ size = 20, ...p }) => (
  <svg {...base(size, p)}>
    <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
    <path
      d="M12 1.8 l1.6 2.7 a8.2 8.2 0 0 1 2.2 0.9 l3-0.8 1.6 2.8 -2 2.3 a8.2 8.2 0 0 1 0 2.6 l2 2.3 -1.6 2.8 -3-0.8 a8.2 8.2 0 0 1-2.2 0.9 L12 22.2 l-1.6-2.7 a8.2 8.2 0 0 1-2.2-0.9 l-3 0.8 -1.6-2.8 2-2.3 a8.2 8.2 0 0 1 0-2.6 l-2-2.3 1.6-2.8 3 0.8 a8.2 8.2 0 0 1 2.2-0.9 Z"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"
    />
  </svg>
);
