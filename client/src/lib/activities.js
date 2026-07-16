/** Activities (3-level: Activity → Project → Task) API + metadata. See docs/activities.md. */
import { api } from '../api/client';

export const activitiesApi = {
  list: () => api.get('/api/activities').then((r) => r.data), // { activities }
  create: (body) => api.post('/api/activities', body).then((r) => r.data.activity), // { name, kind }
  update: (id, body) => api.patch(`/api/activities/${id}`, body).then((r) => r.data.activity),
  remove: (id) => api.delete(`/api/activities/${id}`),

  addProject: (id, body) => api.post(`/api/activities/${id}/projects`, body).then((r) => r.data.activity), // { name, tasks:[{title,dueDate}] }
  updateProject: (projectId, body) => api.patch(`/api/activities/projects/${projectId}`, body).then((r) => r.data.activity),
  setProjectStage: (projectId, stage) => api.post(`/api/activities/projects/${projectId}/stage`, { stage }).then((r) => r.data.activity),
  removeProject: (projectId) => api.delete(`/api/activities/projects/${projectId}`).then((r) => r.data.activity),

  addTask: (projectId, body) => api.post(`/api/activities/projects/${projectId}/tasks`, body).then((r) => r.data.activity),
  updateTask: (taskId, body) => api.patch(`/api/activities/tasks/${taskId}`, body).then((r) => r.data.activity),
  removeTask: (taskId) => api.delete(`/api/activities/tasks/${taskId}`).then((r) => r.data.activity),
};

export const ACTIVITY_KINDS = [
  { value: 'club', label: 'Club' },
  { value: 'extracurricular', label: 'Extracurricular' },
  { value: 'freelance', label: 'Freelance' },
  { value: 'volunteer', label: 'Volunteer' },
  { value: 'other', label: 'Other' },
];

/** Display label for an activity's type — the custom free text for 'other', else the preset. */
export function activityKindLabel(activity) {
  if (activity?.kind === 'other' && activity?.kindLabel?.trim()) return activity.kindLabel.trim();
  return ACTIVITY_KINDS.find((x) => x.value === activity?.kind)?.label || 'Activity';
}

export const STAGE_LABELS = { backlog: 'Backlog', active: 'Active', in_progress: 'In Progress', done: 'Done' };
export const STAGES = ['backlog', 'active', 'in_progress', 'done'];

/** Activity-level progress measured in PROJECTS (projects done / total). */
export function activityProjectProgress(a) {
  const total = (a.projects || []).length;
  const done = (a.projects || []).filter((p) => p.stage === 'done').length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** Count incomplete, past-due tasks across all of an activity's projects. */
export function activityOverdue(a) {
  const now = Date.now();
  return (a.projects || []).reduce(
    (n, p) => n + p.tasks.filter((t) => !t.done && t.dueDate && new Date(t.dueDate).getTime() < now).length,
    0,
  );
}
