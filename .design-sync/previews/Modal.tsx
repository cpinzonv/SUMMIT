import { Modal } from '@student-workflow/client';

// Modal is a full-screen `fixed inset-0` overlay. On its own the card wrapper
// collapses to zero height (the modal is out of flow), so `items-center`
// centers the dialog on the top edge and clips its title. A sized wrapper with
// a `transform` gives inset-0 a real box to center within. Composition glue
// only — the Modal itself is unchanged.
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ transform: 'translateZ(0)', position: 'relative', width: 460, height: 300 }}>
    {children}
  </div>
);

export const Default = () => (
  <Frame>
    <Modal title="Edit class" onClose={() => {}}>
      <p className="text-sm text-muted">
        Update the name, color, or meeting schedule for this class.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn btn-soft">Cancel</button>
        <button className="btn btn-primary">Save</button>
      </div>
    </Modal>
  </Frame>
);
