import { ELEMENT_META, type Card } from '../../engine/index.js';

export function CardTile({
  card,
  subtitle,
  selected,
  selectionOrder,
  disabled,
  compact,
  large,
  onClick
}: {
  card: Card;
  subtitle?: string;
  selected?: boolean;
  selectionOrder?: number;
  disabled?: boolean;
  compact?: boolean;
  large?: boolean;
  onClick?: () => void;
}) {
  const colorClass = card.color === 'red' ? 'color-red' : 'color-black';
  const isClickable = Boolean(onClick) && !disabled;
  return (
    <div
      className={`card-chip ${colorClass} ${compact ? 'card-compact' : ''} ${
        large ? 'card-hand-tile' : ''
      } ${isClickable ? 'clickable' : ''} ${selected ? 'selected-sacrifice' : ''} ${
        disabled ? 'card-disabled' : ''
      }`}
      onClick={isClickable ? onClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable && onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="card-top">
        <span className={large ? 'card-hand-glyph' : ''}>{card.shortLabel}</span>
        {selectionOrder !== undefined ? (
          <span className="badge badge-warn">#{selectionOrder}</span>
        ) : (
          <span className="badge">{card.vp} VP</span>
        )}
      </div>
      <div className="card-meta">{card.label}</div>
      {!compact && (
        <div className="card-meta">
          {card.element ? `${ELEMENT_META[card.element].label} · ${card.color}` : card.family}
        </div>
      )}
      {subtitle && <div className="card-meta">{subtitle}</div>}
    </div>
  );
}
