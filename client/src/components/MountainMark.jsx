/**
 * Summit logomark — a minimal mountain-range peak.
 *
 * One smooth, continuous gradient stroke (coral → teal) with softly rounded
 * corners at every peak and valley. Geometry is the brand source of truth —
 * see docs/brand/summit-brand-kit.html. To switch styles, change `variant`:
 *   - "stroke" (default)  thin gradient outline
 *   - "coral"             thin coral line
 *   - "filled"            solid coral→teal gradient fill
 */
export function MountainMark({ size = 64, variant = 'stroke', className = '' }) {
  const gid = 'summit-mark-grad';
  // Two-peak ridge drawn as a single continuous line, corners rounded with
  // quadratic curves so the stroke flows instead of snapping at each vertex.
  const ridge =
    'M6 51 L23.54 25.15 Q25 23 26.65 25.01 L32.35 31.99 Q34 34 35.3 31.75 L43.7 17.25 Q45 15 45.88 17.45 L58 51';

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
        <path
          d={ridge}
          stroke={stroke}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
