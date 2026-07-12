import { KebabMenu } from '@student-workflow/client';

// KebabMenu is a closed ⋮ trigger until clicked; the open menu is state-driven
// and cannot render statically. Shown here in its real context — a card row —
// so the card reads as an actual usage rather than a lone glyph.
export const InCardRow = () => (
  <div className="glass-panel flex w-56 items-center justify-between gap-3 px-4 py-3">
    <span className="font-semibold text-ink">Essay draft</span>
    <KebabMenu onEdit={() => {}} onDelete={() => {}} />
  </div>
);
