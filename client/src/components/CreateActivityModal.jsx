import { useState } from 'react';
import { errorMessage } from '../api/client';
import { Modal } from './ui';
import { activitiesApi, ACTIVITY_KINDS } from '../lib/activities';

/**
 * Create an Activity with the Option-C breakdown flow: the form opens with THREE
 * empty sub-task rows (the default nudge toward breakdown) + a soft encouragement
 * line — but you can delete rows down to one, or none, and still create. Never a wall.
 */
const emptyRow = () => ({ title: '', dueDate: '' });

export function CreateActivityModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('club');
  const [rows, setRows] = useState([emptyRow(), emptyRow(), emptyRow()]); // default 3
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i));

  const filled = rows.filter((r) => r.title.trim());

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Give the activity a name.');
    setSaving(true);
    try {
      const activity = await activitiesApi.create({
        name: name.trim(),
        kind,
        tasks: filled.map((r) => ({ title: r.title.trim(), dueDate: r.dueDate || null })),
      });
      onCreated(activity);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the activity.'));
      setSaving(false);
    }
  };

  return (
    <Modal title="New activity" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-semibold text-ink">Activity name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Robotics Club — spring showcase" className="field" autoFocus />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink">Type</span>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="field">
              {ACTIVITY_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
        </div>

        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-ink">Break it into steps</span>
            <span className="text-xs text-muted">{filled.length} step{filled.length === 1 ? '' : 's'}</span>
          </div>
          <p className="mb-2 text-xs text-brand-600">
            Breaking work into 3+ dated steps is the #1 way to beat procrastination — optional, but it really helps.
          </p>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={r.title}
                  onChange={(e) => setRow(i, { title: e.target.value })}
                  placeholder={`Step ${i + 1}`}
                  className="field flex-1"
                />
                <input
                  type="date"
                  value={r.dueDate}
                  onChange={(e) => setRow(i, { dueDate: e.target.value })}
                  className="field !w-40"
                  title="Due date (optional)"
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  aria-label="Remove step"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition hover:bg-black/5 hover:text-rose-500"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addRow} className="mt-2 text-sm font-semibold text-brand-600 hover:underline">
            + Add a step
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn btn-soft">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? 'Creating…' : 'Create activity'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
