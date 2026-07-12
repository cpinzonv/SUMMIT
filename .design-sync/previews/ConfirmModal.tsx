import { ConfirmModal } from '@student-workflow/client';

// ConfirmModal wraps Modal (full-screen `fixed inset-0`). A sized wrapper with
// a `transform` gives inset-0 a real box so the dialog centers fully instead of
// clipping its title on the collapsed card. Composition glue only.
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ transform: 'translateZ(0)', position: 'relative', width: 460, height: 320 }}>
    {children}
  </div>
);

export const Default = () => (
  <Frame>
    <ConfirmModal
      title="Delete assignment?"
      message="This will permanently remove it and any submissions."
      detail="Problem Set 4 — Linear Algebra"
      confirmLabel="Delete"
      onConfirm={() => {}}
      onClose={() => {}}
    />
  </Frame>
);
