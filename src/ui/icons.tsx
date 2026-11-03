import type { ReactNode } from "react";

function I({ children, size = 20, fill = "none" }: { children: ReactNode; size?: number; fill?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Icons = {
  select: () => (
    <I>
      <path d="M5 3l14 8-6 1.6L10 19z" />
    </I>
  ),
  hand: () => (
    <I>
      <path d="M8 13V5.5a1.5 1.5 0 013 0V12M11 11.5v-7a1.5 1.5 0 013 0V12M14 11.5V6a1.5 1.5 0 013 0v7.5c0 4-2.5 7.5-6.5 7.5-2.6 0-4-1.2-5.5-3.4L3.6 14.5a1.5 1.5 0 012.5-1.6L8 15" />
    </I>
  ),
  rectangle: () => (
    <I>
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
    </I>
  ),
  diamond: () => (
    <I>
      <path d="M12 3l9 9-9 9-9-9z" />
    </I>
  ),
  ellipse: () => (
    <I>
      <circle cx="12" cy="12" r="8.5" />
    </I>
  ),
  arrow: () => (
    <I>
      <path d="M5 19L19 5M10 5h9v9" />
    </I>
  ),
  line: () => (
    <I>
      <path d="M5 19L19 5" />
    </I>
  ),
  freedraw: () => (
    <I>
      <path d="M4 20c2-1 3-4 5-8s4-7 6-6-1 5-2 8 0 4 2 3 3-3 5-4" />
    </I>
  ),
  text: () => (
    <I>
      <path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />
    </I>
  ),
  sticky: () => (
    <I>
      <path d="M4 4h16v10l-6 6H4z" />
      <path d="M14 20v-6h6" />
    </I>
  ),
  image: () => (
    <I>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="M20.5 16l-5-5-9 8.5" />
    </I>
  ),
  frame: () => (
    <I>
      <path d="M8 3v18M16 3v18M3 8h18M3 16h18" />
    </I>
  ),
  eraser: () => (
    <I>
      <path d="M8.5 20H20M4.6 15.4l9.9-9.9a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L11 19H8.2a2 2 0 01-1.4-.6l-2.2-2.2a1 1 0 010-.8z" />
      <path d="M9.5 10.5l5 5" />
    </I>
  ),
  laser: () => (
    <I>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
    </I>
  ),
  lock: () => (
    <I>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </I>
  ),
  unlock: () => (
    <I>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 017.7-1.5" />
    </I>
  ),
  undo: () => (
    <I>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 010 11H11" />
    </I>
  ),
  redo: () => (
    <I>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 000 11H13" />
    </I>
  ),
  plus: () => (
    <I>
      <path d="M12 5v14M5 12h14" />
    </I>
  ),
  minus: () => (
    <I>
      <path d="M5 12h14" />
    </I>
  ),
  menu: () => (
    <I>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </I>
  ),
  share: () => (
    <I>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.3 13.3l7.4 4.4M15.7 6.3l-7.4 4.4" />
    </I>
  ),
  trash: () => (
    <I>
      <path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 002 2h7a2 2 0 002-2l1-12M9 7V4h6v3" />
    </I>
  ),
  copy: () => (
    <I>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
    </I>
  ),
  download: () => (
    <I>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </I>
  ),
  upload: () => (
    <I>
      <path d="M12 20V9M7 14l5-5 5 5M5 4h14" />
    </I>
  ),
  grid: () => (
    <I>
      <circle cx="6" cy="6" r="1" fill="currentColor" />
      <circle cx="12" cy="6" r="1" fill="currentColor" />
      <circle cx="18" cy="6" r="1" fill="currentColor" />
      <circle cx="6" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="18" cy="12" r="1" fill="currentColor" />
      <circle cx="6" cy="18" r="1" fill="currentColor" />
      <circle cx="12" cy="18" r="1" fill="currentColor" />
      <circle cx="18" cy="18" r="1" fill="currentColor" />
    </I>
  ),
  moon: () => (
    <I>
      <path d="M20 14.5A8 8 0 119.5 4a6.5 6.5 0 0010.5 10.5z" />
    </I>
  ),
  sun: () => (
    <I>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </I>
  ),
  help: () => (
    <I>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .6-1.5 1.2-1.5 2.3M12 17h.01" />
    </I>
  ),
  front: () => (
    <I>
      <rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" fillOpacity={0.25} />
      <path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" />
    </I>
  ),
  back: () => (
    <I>
      <rect x="4" y="4" width="12" height="12" rx="2" fill="currentColor" fillOpacity={0.25} />
      <path d="M16 8h3a1 1 0 011 1v10a1 1 0 01-1 1H9a1 1 0 01-1-1v-3" />
    </I>
  ),
  group: () => (
    <I>
      <path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </I>
  ),
  home: () => (
    <I>
      <path d="M4 11l8-7 8 7M6 9.5V20h12V9.5" />
    </I>
  ),
  fit: () => (
    <I>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </I>
  ),
  alignLeft: () => (
    <I>
      <path d="M4 3v18M8 7h10M8 12h6M8 17h12" />
    </I>
  ),
  alignHCenter: () => (
    <I>
      <path d="M12 3v18M6 7h12M8 12h8M5 17h14" />
    </I>
  ),
  alignRight: () => (
    <I>
      <path d="M20 3v18M6 7h10M10 12h6M4 17h12" />
    </I>
  ),
  alignTop: () => (
    <I>
      <path d="M3 4h18M7 8v10M12 8v6M17 8v12" />
    </I>
  ),
  alignVCenter: () => (
    <I>
      <path d="M3 12h18M7 6v12M12 8v8M17 5v14" />
    </I>
  ),
  alignBottom: () => (
    <I>
      <path d="M3 20h18M7 6v10M12 10v6M17 4v12" />
    </I>
  ),
  distH: () => (
    <I>
      <path d="M4 4v16M20 4v16" />
      <rect x="9" y="8" width="6" height="8" rx="1" />
    </I>
  ),
  distV: () => (
    <I>
      <path d="M4 4h16M4 20h16" />
      <rect x="8" y="9" width="8" height="6" rx="1" />
    </I>
  ),
  logout: () => (
    <I>
      <path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 16l-4-4 4-4M6 12h10" />
    </I>
  ),
  github: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 00-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2a11 11 0 015.8 0c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A11.5 11.5 0 0012 .5z" />
    </svg>
  ),
  google: () => (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  ),
};

export type IconName = keyof typeof Icons;
