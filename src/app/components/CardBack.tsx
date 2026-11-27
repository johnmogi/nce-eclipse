import type { BackGroup } from '../../engine/index.js';

const BACK_META: Readonly<
  Record<
    BackGroup,
    {
      readonly title: string;
      readonly tag: string;
      readonly cssClass: string;
    }
  >
> = {
  minor: {
    title: 'Minor Arcana',
    tag: 'Minor',
    cssClass: 'card-back-minor'
  },
  major: {
    title: 'Major Arcana',
    tag: 'Major',
    cssClass: 'card-back-major'
  },
  'sun-major': {
    title: 'Sun Major Arcana',
    tag: 'Sun Major',
    cssClass: 'card-back-sun'
  },
  'moon-major': {
    title: 'Moon Major Arcana',
    tag: 'Moon Major',
    cssClass: 'card-back-moon'
  }
};

function BackSigil({ backGroup }: { backGroup: BackGroup }) {
  if (backGroup === 'sun-major') {
    return (
      <svg className="card-back-svg" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="7" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M20 5v5M20 30v5M5 20h5M30 20h5M9.4 9.4l3.5 3.5M27.1 27.1l3.5 3.5M30.6 9.4l-3.5 3.5M12.9 27.1l-3.5 3.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (backGroup === 'moon-major') {
    return (
      <svg className="card-back-svg" viewBox="0 0 40 40" aria-hidden="true">
        <path
          d="M24.5 9.5a11 11 0 1 0 6 19.2A9 9 0 0 1 24.5 9.5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <circle cx="27" cy="14" r="1.4" fill="currentColor" />
      </svg>
    );
  }

  if (backGroup === 'major') {
    return (
      <svg className="card-back-svg" viewBox="0 0 40 40" aria-hidden="true">
        <polygon
          points="20,5 34,20 20,35 6,20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <circle cx="20" cy="20" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }

  // Minor Arcana: crescent + star compass sigil
  return (
    <svg className="card-back-svg" viewBox="0 0 40 40" aria-hidden="true">
      <path
        d="M22.5 11a9.5 9.5 0 1 0 6.5 16.4A7.6 7.6 0 0 1 22.5 11Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M27 12v4M25 14h4M30.5 17.5v2.4M29.3 18.7h2.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CardBack({
  backGroup,
  label,
  subtitle,
  stacked,
  size = 'md',
  highlighted,
  selected,
  onClick
}: {
  backGroup: BackGroup;
  label?: string;
  subtitle?: string;
  stacked?: boolean;
  size?: 'sm' | 'md' | 'lg';
  highlighted?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const meta = BACK_META[backGroup];
  return (
    <div
      className={`card-back-frame ${meta.cssClass} card-back-${size} ${
        stacked ? 'card-back-stacked' : ''
      } ${highlighted ? 'target-highlight' : ''} ${selected ? 'target-selected' : ''} ${
        onClick ? 'clickable' : ''
      }`}
      data-back-group={backGroup}
      aria-label={label ?? meta.title}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="card-back-inner">
        <BackSigil backGroup={backGroup} />
        {size !== 'sm' && <div className="card-back-tag">{label ?? meta.tag}</div>}
        {subtitle && <div className="card-back-sub">{subtitle}</div>}
      </div>
    </div>
  );
}
