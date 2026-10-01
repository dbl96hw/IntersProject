import './Logo.css';

const SEED_OUTLINE = 'M24 16C32 24 37 32 35 39C33.5 44 29 46 24 46C19 46 14.5 44 13 39C11 32 16 24 24 16Z';

// A pointed seed with a sprout growing from its tip, so it reads as a seed rather than a round fruit.
function Logo({ size = 40, className = '' }) {
  return (
    <svg
      className={`logo ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
    >
      <path className="logo__stem" d="M24 17V9" />
      <path className="logo__leaf logo__leaf--right" d="M24 11C25 6 30 4 38 5C37 11 31 14 24 11Z" />
      <path className="logo__leaf logo__leaf--left" d="M24 11C23 7 19 5 12 6C13 11 18 13 24 11Z" />
      <path className="logo__seed" d={SEED_OUTLINE} />
      <path
        className="logo__seed-shade"
        d="M24 16C32 24 37 32 35 39C33.5 44 29 46 24 46C21 38 21 26 24 16Z"
      />
      <path className="logo__seam" d="M24 18C21 27 21 37 24 45" />
      <path className="logo__highlight" d="M17 37C15.5 32 17 27 20 23" />
    </svg>
  );
}

export default Logo;
