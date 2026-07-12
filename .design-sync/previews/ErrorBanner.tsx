import { ErrorBanner } from '@student-workflow/client';

export const Default = () => (
  <ErrorBanner message="Couldn't save your changes. Check your connection and try again." />
);
export const Short = () => <ErrorBanner message="That email is already in use." />;
