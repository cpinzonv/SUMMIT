// design-sync curated entry — re-exports ONLY the reusable Summit design-system
// primitives so the converter bundles exactly this scoped set into
// window.SummitUI, not the whole application. Lives in client/ so the converter
// resolves PKG_DIR to this package (its src/ + committed CSS snapshot). Sync
// input only; never imported by the app. See .design-sync/NOTES.md.
export {
  KebabMenu,
  ConfirmModal,
  Modal,
  Toggle,
  Spinner,
  FullPageSpinner,
  ErrorBanner,
  Toast,
  LmsBadge,
  CanvasBadge,
  PriorityBadge,
  EmptyState,
} from './src/components/ui.jsx';
export { MountainMark } from './src/components/MountainMark.jsx';
