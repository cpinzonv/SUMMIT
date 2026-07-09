import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import {
  Spinner,
  ErrorBanner,
  EmptyState,
  Modal,
  Toast,
  LmsBadge,
  PriorityBadge,
  gradeColor,
  classGradient,
  classAccent,
  isGlassColor,
  CLASS_COLOR_PRESETS,
} from '../components/ui';
import { EmptyHero, AssignmentsIllustration } from '../components/EmptyHero';
import AssignmentsBoard from '../components/AssignmentsBoard';
import { lmsApi, lmsStatusAll, lmsLabel, summarizeSync } from '../lib/lms';
import { dueStatus, isDone, countdownTone } from '../lib/dueDate';
import { suggestHours } from '../lib/workload';
import { ClassNotes } from '../components/ClassNotes';
import { ClassAttendance } from '../components/ClassAttendance';
import { ClassFiles } from '../components/ClassFiles';
import NotesChatbot from '../components/NotesChatbot';

const TABS = [
  { key: 'assignments', label: 'Assignments' },
  { key: 'notes', label: 'Notes' },
  { key: 'files', label: 'Files' },
  { key: 'attendance', label: 'Attendance' },
];

export default function ClassDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [cls, setCls] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Active modal: { type: 'assignment', assignment? } or { type: 'grade', assignment }
  const [modal, setModal] = useState(null);
  const [tab, setTab] = useState('assignments');
  const [asgView, setAsgView] = useState('table'); // 'table' | 'board'
  const [toast, setToast] = useState(null);
  // Plays the archive exit animation on the header before navigating away.
  const [archiving, setArchiving] = useState(false);
  // All registered LMS providers + their connection state (drives the ⋮ menu).
  const [lmsProviders, setLmsProviders] = useState([]);

  useEffect(() => {
    let active = true;
    lmsStatusAll()
      .then((providers) => active && setLmsProviders(providers))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!toast || toast.loading) return undefined;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const load = useCallback(async () => {
    setError('');
    try {
      const [classesRes, assignmentsRes] = await Promise.all([
        api.get('/api/classes'),
        api.get(`/api/classes/${id}/assignments`),
      ]);
      setCls(classesRes.data.classes.find((c) => c.id === id) || null);
      setAssignments(assignmentsRes.data.assignments);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Light refresh of just the assignments (used by the Kanban board after a move).
  const reloadAssignments = useCallback(() => {
    api.get(`/api/classes/${id}/assignments`).then((r) => setAssignments(r.data.assignments)).catch(() => {});
  }, [id]);

  const doArchive = async () => {
    // Play the exit animation on the header, then archive + leave.
    setModal(null);
    setArchiving(true);
    await new Promise((r) => setTimeout(r, 500));
    try {
      await api.put(`/api/classes/${id}/archive`);
      navigate('/');
    } catch (err) {
      setArchiving(false);
      setToast({ type: 'error', msg: errorMessage(err, 'Could not archive class') });
    }
  };

  const doDelete = async () => {
    await api.delete(`/api/classes/${id}`);
    navigate('/');
  };

  const handleDelete = async (assignment) => {
    if (!confirm(`Delete "${assignment.title}"? This can't be undone.`)) return;
    try {
      await api.delete(`/api/assignments/${assignment.id}`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  // "Sync <LMS> assignments" for this class = import every assignment of its
  // matched course on that provider (upserts, so it also picks up due-date/point
  // changes).
  const syncClassProvider = async (provider) => {
    const label = lmsLabel(provider);
    setToast({ loading: true, msg: `Syncing from ${label}…` });
    try {
      const { assignments: list } = await lmsApi(provider).listCourseAssignments(id);
      if (list.length === 0) {
        setToast({ type: 'success', msg: `No ${label} assignments for this course` });
        return;
      }
      const result = await lmsApi(provider).import(id, list.map((a) => a.externalId));
      await load();
      setToast({ type: 'success', msg: summarizeSync(result, provider) });
    } catch (err) {
      setToast({ type: 'error', msg: errorMessage(err, `${label} sync failed`) });
    }
  };

  if (loading) return <Spinner label="Loading class…" />;

  const grade = cls?.currentGrade;
  const gradient = classGradient(cls, 0);

  return (
    <div>
      <Link to="/" className="text-sm font-semibold text-brand-600 hover:underline">
        ← Back to dashboard
      </Link>

      {/* Outer wrapper is the positioning context for the ⋮ menu, which lives
          OUTSIDE the overflow-hidden card so its dropdown isn't clipped. */}
      <div className={`relative mt-3 archive-exit ${archiving ? 'archive-animating' : ''}`}>
        <div className="glass-card relative overflow-hidden p-6">
          <span
            className="pointer-events-none absolute inset-0 opacity-[0.12]"
            style={{ backgroundImage: gradient }}
          />
          <span
            className="pointer-events-none absolute -right-12 -top-14 h-44 w-44 rounded-full opacity-60 blur-2xl"
            style={{ backgroundImage: gradient }}
          />
          <div className="relative flex items-start justify-between gap-4 pr-10">
            <div className="flex items-start gap-3">
              <span
                className="mt-1 h-14 w-1.5 rounded-full"
                style={{ backgroundImage: classAccent(cls, 0) }}
              />
              <div>
                <h1 className="text-2xl font-extrabold">{cls?.name || 'Class'}</h1>
                <p className="text-sm text-muted">
                  {[cls?.code, cls?.term].filter(Boolean).join(' · ')}
                </p>
                {cls?.description && (
                  <p className="mt-2 max-w-prose whitespace-pre-line text-sm text-slate-600">
                    {cls.description}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-5">
              <div className="text-right">
                <div className={`text-3xl font-extrabold ${gradeColor(grade?.percentage)}`}>
                  {grade?.percentage != null ? `${grade.percentage}%` : '—'}
                </div>
                <div className="text-xs font-medium text-muted">
                  Grade {grade?.letter ? `(${grade.letter})` : ''}
                </div>
              </div>
              {cls?.attendanceRate != null && (
                <div className="text-right">
                  <div className={`text-3xl font-extrabold ${gradeColor(cls.attendanceRate)}`}>
                    {cls.attendanceRate}%
                  </div>
                  <div className="text-xs font-medium text-muted">Attendance</div>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="absolute right-3 top-3 z-30">
          <ClassMenu
            providers={lmsProviders}
            onEdit={() => setModal({ type: 'editClass' })}
            onArchive={() => setModal({ type: 'confirmArchive' })}
            onDelete={() => setModal({ type: 'confirmDelete' })}
            onImport={(provider) => setModal({ type: 'lmsImport', provider })}
            onSync={syncClassProvider}
            onConnect={(provider) => navigate(`/settings?lms=${provider}`)}
          />
        </div>
      </div>

      <ErrorBanner message={error} />

      {/* Tabs */}
      <div className="mt-6 flex gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              tab === t.key
                ? 'bg-white/75 text-brand-700 shadow-sm'
                : 'text-muted hover:bg-white/50 hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'notes' && (
        <div className="mt-5">
          <ClassNotes classId={id} onGoToFiles={() => setTab('files')} />
          {/* Floating "ask your notes" chat bubble (bottom-right). */}
          <NotesChatbot classId={id} className={cls?.name} />
        </div>
      )}
      {tab === 'files' && (
        <div className="mt-5">
          <ClassFiles classId={id} onGoToNotes={() => setTab('notes')} />
        </div>
      )}
      {tab === 'attendance' && (
        <div className="mt-5">
          <ClassAttendance classId={id} />
        </div>
      )}

      {tab === 'assignments' && (
      <section className="mt-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">Assignments</h2>
          <div className="flex items-center gap-2">
            {assignments.length > 0 && (
              <div className="flex rounded-xl bg-white/50 p-0.5 text-xs font-semibold">
                {['table', 'board'].map((v) => (
                  <button
                    key={v}
                    onClick={() => setAsgView(v)}
                    className={`rounded-lg px-3 py-1 capitalize transition ${asgView === v ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setModal({ type: 'assignment' })} className="btn btn-primary">
              + Add assignment
            </button>
          </div>
        </div>

        {assignments.length === 0 ? (
          <EmptyHero
            illustration={<AssignmentsIllustration />}
            headline="No assignments yet"
            subheading="Assignments will appear here as they're added. Stay on top of your deadlines."
            ctaLabel="Add your first assignment"
            onCta={() => setModal({ type: 'assignment' })}
          />
        ) : asgView === 'board' ? (
          <AssignmentsBoard classId={id} assignments={assignments} onChanged={reloadAssignments} />
        ) : (
          <>
          <div className="glass-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-white/50">
                  <th className="px-5 py-3">Title</th>
                  <th className="px-5 py-3">Due</th>
                  <th className="px-5 py-3">Planned</th>
                  <th className="px-5 py-3">Points</th>
                  <th className="px-5 py-3">Grade</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/40">
                {assignments.map((a) => {
                  const st = dueStatus(a.dueDate);
                  const overdue = st.isPastDue && !isDone(a);
                  return (
                  <tr key={a.id} className={`transition hover:bg-white/40 ${overdue ? 'bg-rose-50/70' : ''}`}>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">{a.title}</span>
                        <PriorityBadge priority={a.priority} />
                        {a.externalSource && <LmsBadge source={a.externalSource} />}
                        {overdue && (
                          <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-rose-600">
                            {st.lateLabel}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted">
                        {a.category || a.status?.replace('_', ' ')}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-600">
                      {fmtDate(a.dueDate)}
                      {st.hasDue && !isDone(a) && !overdue && (
                        <div className={`text-[11px] font-semibold ${countdownTone(st)}`}>{st.countdownLabel}</div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted">{fmtDate(a.plannedDate)}</td>
                    <td className="px-5 py-3 text-muted">{a.pointValue ?? '—'}</td>
                    <td className="px-5 py-3">
                      {a.grade ? (
                        <button
                          onClick={() => setModal({ type: 'grade', assignment: a })}
                          className="font-semibold text-ink transition hover:text-brand-600"
                          title="Edit grade"
                        >
                          {a.grade.pointsEarned}/{a.grade.pointsPossible}
                        </button>
                      ) : (
                        <button
                          onClick={() => setModal({ type: 'grade', assignment: a })}
                          className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-100"
                        >
                          Grade
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-3 text-xs font-semibold">
                        <button
                          onClick={() => setModal({ type: 'assignment', assignment: a })}
                          className="text-muted transition hover:text-brand-600"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(a)}
                          className="text-muted transition hover:text-rose-500"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setModal({ type: 'gradeSim' })}
              title="What if?"
              aria-label="What if? — grade simulator"
              className="grid h-10 w-10 place-items-center rounded-full border border-white/60 bg-white/55 shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-white/85 hover:shadow-md"
            >
              <WhatIfIcon className="h-6 w-6" />
            </button>
          </div>
          </>
        )}
      </section>
      )}

      {modal?.type === 'assignment' && (
        <AssignmentModal
          classId={id}
          assignment={modal.assignment}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await load();
          }}
        />
      )}
      {modal?.type === 'grade' && (
        <GradeModal
          assignment={modal.assignment}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await load();
          }}
        />
      )}
      {modal?.type === 'editClass' && (
        <ClassEditModal
          cls={cls}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await load();
          }}
        />
      )}
      {modal?.type === 'confirmArchive' && (
        <ConfirmDialog
          title="Archive this class?"
          body={`“${cls?.name}” will move to your Archives. You can still view it there, but it leaves your active dashboard.`}
          confirmLabel="Archive"
          onConfirm={doArchive}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'confirmDelete' && (
        <ConfirmDialog
          danger
          title="Delete this class?"
          body={`This permanently deletes “${cls?.name}” and all of its assignments, grades, notes, and attendance. This can't be undone.`}
          confirmLabel="Delete forever"
          onConfirm={doDelete}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'gradeSim' && (
        <GradeSimModal classId={id} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'lmsImport' && (
        <LmsImportModal
          provider={modal.provider}
          classId={id}
          className={cls?.name}
          onClose={() => setModal(null)}
          onImported={async (result) => {
            setModal(null);
            await load();
            setToast({ type: 'success', msg: summarizeSync(result, modal.provider) });
          }}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}

/**
 * Top-right ⋮ menu on the class header. Class actions (Edit / Archive / Delete)
 * plus, below a divider, per-LMS import/sync actions. Each connected provider
 * gets an "Import" and "Sync" entry; providers that aren't connected are shown
 * disabled with a "Connect … in Settings first" tooltip.
 */
function ClassMenu({ providers, onEdit, onArchive, onDelete, onImport, onSync, onConnect }) {
  const [open, setOpen] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const ref = useRef(null);
  // Pending "close the flyout" timer. The flyout sits a small gap to the left of
  // its trigger, so we don't close the instant the cursor leaves the trigger —
  // we wait ~180ms so the cursor can cross the gap to the submenu (hover-trap
  // fix). Any re-entry cancels the pending close.
  const subTimer = useRef(null);

  const openSub = () => {
    clearTimeout(subTimer.current);
    setSubOpen(true);
  };
  const closeSubSoon = () => {
    clearTimeout(subTimer.current);
    subTimer.current = setTimeout(() => setSubOpen(false), 180);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && (subOpen ? setSubOpen(false) : setOpen(false));
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, subOpen]);

  // Never leave a close timer running after the menu unmounts.
  useEffect(() => () => clearTimeout(subTimer.current), []);

  // Close everything after picking an action.
  const pick = (fn) => () => {
    clearTimeout(subTimer.current);
    setOpen(false);
    setSubOpen(false);
    fn();
  };

  const lmsProviders = providers || [];

  return (
    <div ref={ref} className="relative self-start">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Class options"
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid h-9 w-9 place-items-center rounded-full text-xl leading-none text-muted transition hover:bg-white/60 hover:text-ink"
      >
        ⋮
      </button>
      {open && (
        <div role="menu" className="glass-panel absolute right-0 z-20 mt-1 w-60 p-1.5 text-sm shadow-xl">
          <button type="button" role="menuitem" onClick={pick(onEdit)} className="menu-item">
            <span>✎</span> Edit class
          </button>

          {/* Add Integration → flyout submenu of LMS providers. Open on hover,
              close on a short delay so the cursor can cross the gap to the
              flyout without it vanishing. */}
          <div
            className="relative"
            onMouseEnter={openSub}
            onMouseLeave={closeSubSoon}
          >
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={subOpen}
              onClick={() => { clearTimeout(subTimer.current); setSubOpen((s) => !s); }}
              className="menu-item w-full justify-between"
            >
              <span className="flex items-center gap-2">
                <span className="text-brand-600">⊕</span> Add Integration
              </span>
              <span className="text-muted">›</span>
            </button>

            {subOpen && (
              <div
                role="menu"
                onMouseEnter={openSub}
                onMouseLeave={closeSubSoon}
                className="glass-panel absolute right-full top-0 z-30 mr-1 max-h-[22rem] w-64 overflow-y-auto p-1.5 text-sm shadow-xl"
              >
                {lmsProviders.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted">No integrations available.</div>
                ) : (
                  lmsProviders.map((p, i) => (
                    <div key={p.provider}>
                      {i > 0 && <div className="my-1 border-t border-white/50" />}
                      <div className="flex items-center justify-between px-3 pb-0.5 pt-1 text-[10px] font-bold uppercase tracking-wide text-muted">
                        <span>{p.label}</span>
                        {!p.connected && (
                          <span className="inline-flex items-center gap-1 normal-case text-muted/70">
                            🔒 Not connected
                          </span>
                        )}
                      </div>
                      {p.connected ? (
                        <>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={pick(() => onImport(p.provider))}
                            className="menu-item text-[#c8401a]"
                          >
                            <span>⬇</span> Import assignments
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={pick(() => onSync(p.provider))}
                            className="menu-item text-[#3fa1a6]"
                          >
                            <span>↻</span> Sync assignments
                          </button>
                        </>
                      ) : (
                        // Not connected → give a real call-to-action instead of a
                        // dead, disabled Import/Sync. Takes the user to Settings
                        // where the OAuth / access-token connect form lives.
                        <button
                          type="button"
                          role="menuitem"
                          onClick={pick(() => onConnect?.(p.provider))}
                          className="menu-item text-brand-600"
                        >
                          <span>🔗</span> Connect {p.label} in Settings →
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="my-1 border-t border-white/50" />
          <button type="button" role="menuitem" onClick={pick(onArchive)} className="menu-item">
            <span>🗄</span> Archive class
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={pick(onDelete)}
            className="menu-item text-rose-600 hover:bg-rose-50/70"
          >
            <span>🗑</span> Delete class
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Custom "What if?" grade-simulator icon: a minimal line-art calculator — a
 * coral body with an orange display and a teal keypad — in Summit's warm→cool
 * palette and clean 2px linework.
 */
function WhatIfIcon({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* calculator body */}
      <rect x="5" y="2.5" width="14" height="19" rx="2.5" stroke="#FF6B6B" />
      {/* display */}
      <rect x="8" y="5.5" width="8" height="3.2" rx="1" stroke="#FFA500" />
      {/* keypad — 3×3, with a coral "equals" key at the corner */}
      {[13, 16.5].map((cy) =>
        [9, 12, 15].map((cx) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.9" fill="#20B2AA" stroke="none" />
        )),
      )}
      <circle cx="9" cy="20" r="0.9" fill="#20B2AA" stroke="none" />
      <circle cx="12" cy="20" r="0.9" fill="#20B2AA" stroke="none" />
      <circle cx="15" cy="20" r="0.9" fill="#FF6B6B" stroke="none" />
    </svg>
  );
}

/** Lightweight confirmation dialog matching the Summit glass aesthetic. */
function ConfirmDialog({ title, body, confirmLabel, onConfirm, onClose, danger = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-slate-600">{body}</p>
      {error && <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn btn-soft">
          Cancel
        </button>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** Edit a class's basic fields (name, code, term, description, color, dates). */
function ClassEditModal({ cls, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: cls?.name ?? '',
    code: cls?.code ?? '',
    term: cls?.term ?? '',
    description: cls?.description ?? '',
    color: cls?.color ?? '',
    startDate: toDateInput(cls?.startDate),
    endDate: toDateInput(cls?.endDate),
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.patch(`/api/classes/${cls.id}`, {
        name: form.name.trim(),
        code: form.code.trim() || null,
        term: form.term.trim() || null,
        description: form.description.trim() || null,
        color: form.color.trim() || null,
        startDate: form.startDate ? dateInputToISO(form.startDate) : null,
        endDate: form.endDate ? dateInputToISO(form.endDate) : null,
      });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit class" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Input label="Name" value={form.name} onChange={update('name')} required />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Code" value={form.code} onChange={update('code')} placeholder="CS 250" />
          <Input label="Term" value={form.term} onChange={update('term')} placeholder="Fall 2026" />
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink">Description</span>
          <textarea
            value={form.description}
            onChange={update('description')}
            rows={3}
            className="field"
          />
        </label>
        <ColorPicker value={form.color} onChange={(c) => setForm((f) => ({ ...f, color: c }))} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Start date" type="date" value={form.startDate} onChange={update('startDate')} />
          <Input label="End date" type="date" value={form.endDate} onChange={update('endDate')} />
        </div>
        {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
        <ModalActions saving={saving} onClose={onClose} label="Save changes" />
      </form>
    </Modal>
  );
}

/** "What if?" grade simulator: pick a target, see what's needed on remaining work. */
function GradeSimModal({ classId, onClose }) {
  const [target, setTarget] = useState('A');
  const [forId, setForId] = useState(''); // '' = all remaining work; else an assignment id
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = async (t, fid) => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.post(`/api/classes/${classId}/grade-simulation`, {
        targetGrade: t,
        ...(fid ? { assignmentId: fid } : {}),
      });
      setResult(data);
    } catch (err) {
      setError(errorMessage(err, 'Could not run the simulation.'));
    } finally {
      setLoading(false);
    }
  };

  // Run on open and whenever the target or the selected assignment changes.
  useEffect(() => {
    run(target, forId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, forId]);

  // Options for the "Calculate for" dropdown — only ungraded assignments.
  const remaining = result?.remainingAssignments ?? [];

  const message = (() => {
    if (!result) return null;
    const cur = result.currentPercent == null ? 'no grades yet' : `${result.currentPercent}%`;
    const tgt = `${typeof result.targetGrade === 'string' ? result.targetGrade : ''} (${result.targetPercent}%)`.trim();

    // Single-assignment mode.
    if (result.forAssignment) {
      const { title, pointValue } = result.forAssignment;
      const caveat = result.remainingAssignments.length > 1
        ? ' (assuming full marks on your other remaining work)'
        : '';
      switch (result.status) {
        case 'already_achieved':
          return `You've already secured ${tgt} — you don't need any points on ${title}. You currently have ${cur}.`;
        case 'impossible':
          return `Even a perfect score on ${title} (${pointValue} pts) won't reach ${tgt}. You currently have ${cur}.`;
        case 'reachable':
          return `On ${title} (${pointValue} pts), you need ${result.requiredPointsOnAssignment} points (${result.requiredPercentOnAssignment}%) to get ${tgt}${caveat}.`;
        default:
          return null;
      }
    }

    // All-remaining-work mode.
    switch (result.status) {
      case 'all_done':
        return `All work is graded — your grade is locked at ${cur}. There's no remaining work to change it.`;
      case 'already_achieved':
        return `You've already secured ${tgt}. You currently have ${cur}; even low scores on the remaining ${result.remainingPoints} pts keep you at or above target.`;
      case 'impossible':
        return `Reaching ${tgt} isn't possible with the remaining ${result.remainingPoints} pts — you'd need to average ${result.requiredGradeOnRemaining}% (over 100%). You currently have ${cur}.`;
      case 'reachable':
        return `You currently have ${cur}. To get ${tgt}, you need to average ${result.requiredGradeOnRemaining}% on the remaining ${result.remainingPoints} pts of work.`;
      default:
        return null;
    }
  })();

  const tone =
    result?.status === 'impossible'
      ? 'text-rose-600'
      : result?.status === 'already_achieved'
        ? 'text-emerald-600'
        : 'text-ink';

  return (
    <Modal title="What if? — grade simulator" onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink">Calculate for</span>
          <select value={forId} onChange={(e) => setForId(e.target.value)} className="field">
            <option value="">All remaining work</option>
            {remaining.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} ({a.pointValue} pts)
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink">Target final grade</span>
          <div className="flex flex-wrap gap-1.5">
            {['A', 'B', 'C', 'D'].map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setTarget(g)}
                className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition ${
                  target === g ? 'bg-brand-500 text-white' : 'bg-white/60 text-muted hover:bg-white/90'
                }`}
              >
                {g}
              </button>
            ))}
            <input
              type="number"
              min="0"
              max="100"
              placeholder="%"
              onChange={(e) => e.target.value && setTarget(Number(e.target.value))}
              className="field !w-20"
              title="Or enter a target percentage"
            />
          </div>
        </label>

        {error && <ErrorBanner message={error} />}

        {loading ? (
          <Spinner label="Calculating…" />
        ) : result ? (
          <>
            <div className="rounded-2xl border border-white/50 bg-white/45 p-4">
              <p className={`text-sm font-semibold ${tone}`}>{message}</p>
            </div>

            {result.remainingAssignments.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">
                  Remaining work ({result.remainingPoints} pts)
                </h3>
                <div className="max-h-44 space-y-1 overflow-y-auto">
                  {result.remainingAssignments.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setForId(a.id)}
                      className={`flex w-full justify-between rounded-lg border px-3 py-1.5 text-left text-sm transition ${
                        forId === a.id
                          ? 'border-brand-400 bg-brand-50/70 ring-1 ring-brand-400'
                          : 'border-white/50 bg-white/45 hover:bg-white/70'
                      }`}
                    >
                      <span className="truncate text-ink">{a.title}</span>
                      <span className="shrink-0 text-muted">{a.pointValue} pts</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : null}

        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn btn-soft">Close</button>
        </div>
      </div>
    </Modal>
  );
}

/** Pick a subset of a class's assignments from one provider and import them. */
function LmsImportModal({ provider, classId, className, onClose, onImported }) {
  const label = lmsLabel(provider);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState({}); // externalId -> bool
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let active = true;
    lmsApi(provider)
      .listCourseAssignments(classId)
      .then(({ assignments }) => {
        if (!active) return;
        setItems(assignments);
        // Pre-select assignments that haven't been imported yet.
        const sel = {};
        assignments.forEach((a) => {
          if (!a.alreadyImported) sel[a.externalId] = true;
        });
        setSelected(sel);
      })
      .catch((err) => active && setError(errorMessage(err, `Could not load ${label} assignments.`)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [classId, provider, label]);

  const toggle = (id) => setSelected((s) => ({ ...s, [id]: !s[id] }));
  const chosenIds = items.filter((a) => selected[a.externalId]).map((a) => a.externalId);

  const submit = async () => {
    if (chosenIds.length === 0) return;
    setImporting(true);
    setError('');
    try {
      const result = await lmsApi(provider).import(classId, chosenIds);
      onImported(result);
    } catch (err) {
      setError(errorMessage(err, 'Import failed'));
      setImporting(false);
    }
  };

  return (
    <Modal title={`Import from ${label}`} onClose={onClose} wide>
      <p className="mb-3 text-sm text-muted">
        Assignments from {label} for <span className="font-semibold text-ink">{className}</span>.
        Already-imported ones are checked; uncheck anything you don’t want.
      </p>

      {loading ? (
        <Spinner label={`Loading ${label} assignments…`} />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : items.length === 0 ? (
        <EmptyState title={`No ${label} assignments`}>
          This {label} course has no assignments to import.
        </EmptyState>
      ) : (
        <>
          <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
            {items.map((a) => (
              <label
                key={a.externalId}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/50 bg-white/45 px-3 py-2.5 transition hover:bg-white/70"
              >
                <input
                  type="checkbox"
                  checked={!!selected[a.externalId]}
                  onChange={() => toggle(a.externalId)}
                  className="h-4 w-4 shrink-0 accent-brand-500"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{a.title}</span>
                    {a.alreadyImported && (
                      <span className="shrink-0 rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                        Imported
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    {a.dueDate ? `Due ${fmtDate(a.dueDate)}` : 'No due date'}
                    {a.pointValue != null ? ` · ${a.pointValue} pts` : ''}
                    {a.hasGrade ? ' · grade available' : ''}
                  </div>
                </div>
              </label>
            ))}
          </div>

          {error && <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}
          <div className="mt-4 flex items-center justify-between">
            <span className="text-xs text-muted">{chosenIds.length} selected</span>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="btn btn-soft">
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={importing || chosenIds.length === 0}
                className="btn btn-primary"
              >
                {importing ? 'Importing…' : `Import selected`}
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

function fmtDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

// ISO timestamp → 'YYYY-MM-DD' in local time, for date inputs.
function toDateInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

// A 'YYYY-MM-DD' from a date input represents a local calendar day. Appending a
// time keeps it at local midnight so it doesn't shift across the UTC boundary.
function dateInputToISO(value) {
  return new Date(`${value}T00:00:00`).toISOString();
}

function AssignmentModal({ classId, assignment, onClose, onSaved }) {
  const isEdit = Boolean(assignment);
  const [form, setForm] = useState({
    title: assignment?.title ?? '',
    category: assignment?.category ?? '',
    dueDate: toDateInput(assignment?.dueDate),
    plannedDate: toDateInput(assignment?.plannedDate),
    pointValue: assignment?.pointValue ?? '',
    priority: assignment?.priority ?? 'none',
    estimatedHours: assignment?.estimatedHours ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const suggested = suggestHours({ category: form.category, title: form.title, pointValue: form.pointValue });

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    // On edit, send explicit nulls to clear fields; on create, omit empties.
    const blank = isEdit ? null : undefined;
    const payload = {
      title: form.title,
      category: form.category || blank,
      dueDate: form.dueDate ? dateInputToISO(form.dueDate) : blank,
      plannedDate: form.plannedDate ? dateInputToISO(form.plannedDate) : blank,
      pointValue: form.pointValue === '' ? blank : Number(form.pointValue),
      priority: form.priority,
      estimatedHours: form.estimatedHours === '' ? blank : Number(form.estimatedHours),
    };
    try {
      if (isEdit) {
        await api.patch(`/api/assignments/${assignment.id}`, payload);
      } else {
        await api.post(`/api/classes/${classId}/assignments`, payload);
      }
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit assignment' : 'Add assignment'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <Input label="Title" value={form.title} onChange={update('title')} required />
        <Input label="Category" value={form.category} onChange={update('category')} placeholder="Homework, Exam…" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Due date" type="date" value={form.dueDate} onChange={update('dueDate')} />
          <Input label="Planned date" type="date" value={form.plannedDate} onChange={update('plannedDate')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Point value" type="number" value={form.pointValue} onChange={update('pointValue')} />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink">Priority</span>
            <select value={form.priority} onChange={update('priority')} className="field">
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink">Estimated hours</span>
          <input
            type="number"
            step="0.5"
            min="0"
            value={form.estimatedHours}
            onChange={update('estimatedHours')}
            placeholder={`e.g. ${suggested}`}
            className="field"
          />
          <span className="mt-1 block text-xs text-muted">
            Suggested ~{suggested}h based on type/points.{' '}
            {form.estimatedHours === '' && (
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, estimatedHours: suggested }))}
                className="font-semibold text-brand-600 hover:underline"
              >
                Use {suggested}h
              </button>
            )}
          </span>
        </label>
        <ModalActions saving={saving} disabled={!form.title} onClose={onClose} label={isEdit ? 'Save changes' : 'Add assignment'} />
      </form>
    </Modal>
  );
}

function GradeModal({ assignment, onClose, onSaved }) {
  const existing = assignment.grade;
  const [form, setForm] = useState({
    pointsEarned: existing?.pointsEarned ?? '',
    pointsPossible: existing?.pointsPossible ?? assignment.pointValue ?? '',
    feedback: existing?.feedback ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const update = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  // Clear an existing grade (delete the record) so the assignment is ungraded.
  const clearGrade = async () => {
    if (!existing) {
      onClose();
      return;
    }
    if (!confirm('Clear this grade? The class grade will recalculate without it.')) return;
    setSaving(true);
    setError('');
    try {
      await api.delete(`/api/grades/${assignment.id}`);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    // Empty "points earned" means "no grade" → clear it (or no-op if never set).
    if (String(form.pointsEarned).trim() === '') {
      await clearGrade();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post('/api/grades', {
        assignmentId: assignment.id,
        pointsEarned: Number(form.pointsEarned),
        ...(form.pointsPossible === ''
          ? {}
          : { pointsPossible: Number(form.pointsPossible) }),
        ...(form.feedback ? { feedback: form.feedback } : {}),
      });
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      title={`${existing ? 'Edit' : 'Submit'} grade — ${assignment.title}`}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-3">
        <ErrorBanner message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Points earned" type="number" value={form.pointsEarned} onChange={update('pointsEarned')} placeholder="—" />
          <Input label="Points possible" type="number" value={form.pointsPossible} onChange={update('pointsPossible')} placeholder={assignment.pointValue ?? '?'} />
        </div>
        <p className="text-[11px] text-muted">Leave “Points earned” empty to clear the grade.</p>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink">Feedback (optional)</span>
          <textarea value={form.feedback} onChange={update('feedback')} rows={2} className="field" />
        </label>
        <div className="flex items-center justify-between pt-1">
          <div>
            {existing && (
              <button
                type="button"
                onClick={clearGrade}
                disabled={saving}
                className="text-xs font-semibold text-rose-600 transition hover:underline disabled:opacity-50"
              >
                Clear grade
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn btn-soft">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? 'Saving…' : existing ? 'Update grade' : 'Submit grade'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function ModalActions({ saving, disabled, onClose, label }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" onClick={onClose} className="btn btn-soft">
        Cancel
      </button>
      <button type="submit" disabled={saving || disabled} className="btn btn-primary">
        {saving ? 'Saving…' : label}
      </button>
    </div>
  );
}

function Input({ label, ...props }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-ink">{label}</span>
      <input {...props} className="field" />
    </label>
  );
}

/** Class color picker: preset swatches + a custom color well, with a clear option. */
function ColorPicker({ value, onChange }) {
  const current = value || '';
  const glassSelected = isGlassColor(current);
  return (
    <div className="block">
      <span className="mb-1 block text-xs font-semibold text-ink">Color</span>
      <div className="flex flex-wrap items-center gap-2">
        {/* Glass / Clear — the default. The swatch shows the Summit brand
            gradient (warm→cool) so it reads as "the signature Summit look",
            not an empty/gray state. */}
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Glass (clear, Summit default)"
          title="Glass — the signature Summit look"
          className={`h-7 w-7 rounded-full shadow-[0_2px_10px_-2px_rgba(255,120,80,0.6)] ring-offset-1 transition ${
            glassSelected ? 'ring-2 ring-ink' : 'ring-1 ring-white/70 hover:ring-ink/40'
          }`}
          style={{
            backgroundImage:
              'linear-gradient(135deg, #FF6B6B 0%, #FFA500 25%, #20B2AA 75%, #6B7FBD 100%)',
          }}
        />
        {CLASS_COLOR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={`Use ${c}`}
            className={`h-7 w-7 rounded-full ring-offset-1 transition ${
              current.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-ink' : 'ring-1 ring-white/60 hover:ring-ink/40'
            }`}
            style={{ backgroundColor: c }}
          />
        ))}
        {/* Custom color well */}
        <label
          className="grid h-7 w-7 cursor-pointer place-items-center rounded-full border border-dashed border-muted/50 text-xs text-muted"
          title="Custom color"
        >
          🎨
          <input
            type="color"
            value={current || '#5aa9d6'}
            onChange={(e) => onChange(e.target.value)}
            className="sr-only"
          />
        </label>
      </div>
      <span className="mt-1 block text-[11px] text-muted">
        {glassSelected ? 'Glass — frosted, no solid color (default).' : 'Solid color accent.'}
      </span>
    </div>
  );
}
