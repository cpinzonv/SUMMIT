/** Activities (anti-procrastination projects) API + metadata. See docs/activities.md. */
import { api } from '../api/client';

export const activitiesApi = {
  list: () => api.get('/api/activities').then((r) => r.data), // { activities, wip }
  create: (body) => api.post('/api/activities', body).then((r) => r.data.activity),
  update: (id, body) => api.patch(`/api/activities/${id}`, body).then((r) => r.data.activity),
  setStage: (id, stage) => api.post(`/api/activities/${id}/stage`, { stage }).then((r) => r.data.activity),
  remove: (id) => api.delete(`/api/activities/${id}`),
  addTask: (id, body) => api.post(`/api/activities/${id}/tasks`, body).then((r) => r.data.activity),
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

export const STAGE_LABELS = { backlog: 'Backlog', active: 'Active', in_progress: 'In Progress', done: 'Done' };
