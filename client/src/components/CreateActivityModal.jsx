import { useState } from 'react';
import { errorMessage } from '../api/client';
import { Modal } from './ui';
import { activitiesApi, ACTIVITY_KINDS } from '../lib/activities';

/**
 * Create an Activity (name + type). In the 3-level model, the actual breakdown
 * lives one level down — you add Projects on the detail page, and each project
 * gets the 3-task soft nudge. So creation stays fast; you go straight to planning.
 */
export function CreateActivityModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('club');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Give the activity a name.');
    setSaving(true);
    try {
      const activity = await activitiesApi.create({ name: name.trim(), kind });
      onCreated(activity);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the activity.'));
      setSaving(false);
    }
  };

  return (
    <Modal title="New activity" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Activity name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Robotics Club" className="field" autoFocus />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="field">
            {ACTIVITY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <p className="text-xs text-muted">Next you’ll add projects (sub-goals) and break each into a few dated steps — that’s the anti-procrastination magic.</p>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-soft">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary">{saving ? 'Creating…' : 'Create activity'}</button>
        </div>
      </form>
    </Modal>
  );
}
