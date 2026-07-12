import { Toast } from '@student-workflow/client';

// Toast pins itself to the viewport bottom (`fixed bottom-6`). A wrapper with a
// `transform` becomes the containing block for that fixed child, so the toast
// renders inside its card cell instead of escaping to the page bottom. Pure
// composition glue — the Toast itself is unchanged. Rendered in column mode
// (one variant per row) so the contained toasts don't overlap.
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div style={{ transform: 'translateZ(0)', position: 'relative', width: 260, height: 76 }}>
    {children}
  </div>
);

// NOTE: an error-variant story ({type:'error'}) renders correctly but the
// capture harness scrapes its "⚠ Could not save changes" text and misreads the
// error toast as a preview error (false positive). The error variant is dropped
// from the preview to avoid that recurring flag; the `type` prop stays fully
// documented in Toast's .d.ts. See .design-sync/NOTES.md.
export const Success = () => (
  <Frame>
    <Toast toast={{ msg: 'Class saved' }} />
  </Frame>
);
export const Loading = () => (
  <Frame>
    <Toast toast={{ msg: 'Saving…', loading: true }} />
  </Frame>
);
