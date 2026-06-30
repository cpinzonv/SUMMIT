/**
 * Summit logomark — a minimal mountain-range peak.
 *
 * Default style is a gradient stroke (coral → teal), the most premium / on-brand
 * option. To switch styles, change `variant`:
 *   - "stroke"   (default) thin gradient outline
 *   - "coral"    thin coral line
 *   - "filled"   solid coral→teal gradient fill
 */
export function MountainMark({ size = 64, variant = 'stroke', className = '' }) {
  const gid = 'summit-mark-grad';
  // Two-peak range silhouette: a taller summit (right) and a shoulder (left).
  const ridge = 'M6 51 L25 23 L34 34 L45 15 L58 51';

  const stroke =
    variant === 'coral' ? '#ff7a52' : variant === 'stroke' ? `url(#${gid})` : 'none';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gid} x1="6" y1="51" x2="58" y2="15" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ff7a52" />
          <stop offset="0.5" stopColor="#ff6f73" />
          <stop offset="1" stopColor="#3fb8c0" />
        </linearGradient>
      </defs>

      {variant === 'filled' ? (
        // Solid filled range, closed along an implied horizon.
        <path d={`${ridge} Z`} fill={`url(#${gid})`} />
      ) : (
        <>
          <path
            d={ridge}
            stroke={stroke}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* A faint snow-line on the main summit for a touch of depth. */}
          <path
            d="M40 22 L45 15 L50 22"
            stroke={stroke}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.5"
          />
        </>
      )}
    </svg>
  );
}
