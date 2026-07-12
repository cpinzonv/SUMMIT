import { EmptyState } from '@student-workflow/client';

export const Default = () => (
  <EmptyState title="No assignments yet">
    Add your first assignment and it&rsquo;ll show up here, sorted by due date.
  </EmptyState>
);
export const TitleOnly = () => <EmptyState title="You&rsquo;re all caught up" />;
