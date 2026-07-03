/** Super-admin institutions API + helpers (Phase 1). */
import { api } from '../api/client';

export const institutionsApi = {
  list: () => api.get('/api/admin/institutions').then((r) => r.data.institutions),
  // create → { institution, inviteToken }
  create: (body) => api.post('/api/admin/institutions', body).then((r) => r.data),
  update: (id, body) => api.patch(`/api/admin/institutions/${id}`, body).then((r) => r.data.institution),
  revoke: (id, revoked = true) =>
    api.post(`/api/admin/institutions/${id}/revoke`, { revoked }).then((r) => r.data.institution),
};

/** Build the one-time set-password link the super-admin sends to the school. */
export const inviteLink = (token) => `${window.location.origin}/set-password?token=${token}`;

export const FEATURES = [
  { key: 'transcription', label: 'Transcription' },
  { key: 'summaries', label: 'Summaries' },
  { key: 'quizzes', label: 'Quizzes' },
  { key: 'studyGuides', label: 'Study Guides' },
  { key: 'mindMaps', label: 'Mind Maps' },
  { key: 'podcasts', label: 'Podcasts' },
];

export const TIER_DEFAULTS = {
  basic: { transcription: true, summaries: true, quizzes: false, studyGuides: false, mindMaps: false, podcasts: false },
  pro: { transcription: true, summaries: true, quizzes: true, studyGuides: true, mindMaps: true, podcasts: true },
};

export const LMS_TYPES = [
  { value: 'canvas', label: 'Canvas' },
  { value: 'blackboard', label: 'Blackboard' },
  { value: 'google_classroom', label: 'Google Classroom' },
  { value: 'brightspace', label: 'Brightspace' },
  { value: 'moodle', label: 'Moodle' },
  { value: 'sakai', label: 'Sakai' },
];

export const STATUS_STYLES = {
  active: 'bg-emerald-50 text-emerald-600',
  pending: 'bg-amber-100 text-amber-700',
  scheduled: 'bg-sky-50 text-sky-600',
  expired: 'bg-slate-200 text-slate-600',
  revoked: 'bg-rose-100 text-rose-700',
};
