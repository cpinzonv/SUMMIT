import { Toggle } from '@student-workflow/client';

export const Off = () => <Toggle on={false} onChange={() => {}} />;
export const On = () => <Toggle on={true} onChange={() => {}} />;
