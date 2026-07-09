/** Assignments API + Kanban stage metadata. See docs/assignments-kanban.md. */
import { api } from '../api/client';

export const assignmentsApi = {
  list: (classId) => api.get(`/api/classes/${classId}/assignments`).then((r) => r.data.assignments),
  update: (id, body) => api.patch(`/api/assignments/${id}`, body).then((r) => r.data.assignment),
  setStage: (id, stage) => api.post(`/api/assignments/${id}/stage`, { stage }).then((r) => r.data.assignment),
  remove: (id) => api.delete(`/api/assignments/${id}`),
  listFiles: (id) => api.get(`/api/assignments/${id}/files`).then((r) => r.data.files),
  // Submission files reuse the class file upload, tagged with the assignment id.
  uploadFile: (classId, assignmentId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('assignmentId', assignmentId);
    fd.append('category', 'submission');
    return api.post(`/api/classes/${classId}/files`, fd).then((r) => r.data);
  },
  removeFile: (fileId) => api.delete(`/api/files/${fileId}`),
};

export const WIP_LIMIT = 3;

/** Kanban columns in board order. Both non-Done columns count toward the WIP limit. */
export const STAGES = [
  { key: 'planning', label: 'Not Started', tint: 'bg-sky-100 text-sky-700', dot: '#0ea5e9', inFlight: true },
  { key: 'in_progress', label: 'In Progress', tint: 'bg-indigo-100 text-indigo-700', dot: '#6366f1', inFlight: true },
  { key: 'done', label: 'Done', tint: 'bg-emerald-100 text-emerald-700', dot: '#10b981' },
];

export const stageMeta = (key) => STAGES.find((s) => s.key === key) || STAGES[0];

/** Count of in-flight (planning + in_progress) assignments. */
export function inFlightCount(assignments) {
  return (assignments || []).filter((a) => a.stage === 'planning' || a.stage === 'in_progress').length;
}
