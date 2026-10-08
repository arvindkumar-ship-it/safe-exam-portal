// Single icon set: 24px grid, 1.75 stroke, inherits currentColor. Decorative by default.
const PATHS = {
  shield: <><path d="M12 3 5 6v5c0 4.5 2.9 8.2 7 10 4.1-1.8 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  bell: <><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M19 12H5m6-6-6 6 6 6" />,
  check: <path d="m5 12 5 5 9-10" />,
  download: <path d="M12 4v11m-4-4 4 4 4-4M5 20h14" />,
  logout: <><path d="M10 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h4" /><path d="M15 8l4 4-4 4M19 12H9" /></>,
  inbox: <><path d="M4 13h4l1 3h6l1-3h4" /><path d="M5.5 5h13L21 13v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5l2.5-8Z" /></>,
  exam: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
};

export default function Icon({ name, size = 16, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {PATHS[name]}
    </svg>
  );
}
