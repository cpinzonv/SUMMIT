/**
 * In-memory stand-in for src/config/db.js, used by the LMS pipeline test so it
 * can run without a Postgres instance. It recognizes the exact SQL statements
 * lms.service.js issues and operates on JS arrays, enforcing the same uniqueness
 * the real schema does (per-(class, source, external_id) assignment dedupe; one
 * grade per assignment). This validates the service's JS orchestration; the real
 * SQL still runs against Postgres in the app.
 */
import crypto from 'node:crypto';

const uuid = () => crypto.randomUUID();
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

export const store = {
  users: [],
  lms_connections: [],
  classes: [],
  assignments: [],
  grades: [],
  lms_sync_log: [],
  reset() {
    this.users = [];
    this.lms_connections = [];
    this.classes = [];
    this.assignments = [];
    this.grades = [];
    this.lms_sync_log = [];
  },
};

function run(text, params) {
  const q = norm(text);

  if (q.startsWith('SELECT provider, domain, connected, synced_at, auth_method FROM lms_connections WHERE user_id = $1 AND provider = $2')) {
    return rows(store.lms_connections.filter((c) => c.user_id === params[0] && c.provider === params[1]));
  }
  if (q.startsWith('SELECT provider, domain, connected, synced_at, auth_method FROM lms_connections WHERE user_id = $1')) {
    return rows(store.lms_connections.filter((c) => c.user_id === params[0]));
  }
  if (q.startsWith('SELECT user_id, provider FROM lms_connections WHERE connected = true')) {
    return rows(store.lms_connections.filter((c) => c.connected && c.access_token != null).map((c) => ({ user_id: c.user_id, provider: c.provider })));
  }
  if (q.startsWith('SELECT provider, domain, access_token, refresh_token, token_expires_at FROM lms_connections')) {
    return rows(store.lms_connections.filter((c) => c.user_id === params[0] && c.provider === params[1]));
  }
  if (q.startsWith('INSERT INTO lms_connections')) {
    const [user_id, provider, domain, access_token, refresh_token = null, token_expires_at = null] = params;
    const auth_method = /'token'/.test(q) ? 'token' : 'oauth';
    let row = store.lms_connections.find((c) => c.user_id === user_id && c.provider === provider);
    if (row) Object.assign(row, { domain, access_token, refresh_token, token_expires_at, connected: true, auth_method });
    else store.lms_connections.push({ id: uuid(), user_id, provider, domain, access_token, refresh_token, token_expires_at, connected: true, synced_at: null, auth_method });
    return rows([]);
  }
  if (q.startsWith('UPDATE lms_connections SET connected = false')) {
    const row = store.lms_connections.find((c) => c.user_id === params[0] && c.provider === params[1]);
    if (row) Object.assign(row, { connected: false, access_token: null, refresh_token: null, token_expires_at: null });
    return rows([]);
  }
  if (q.startsWith('UPDATE lms_connections SET access_token = $3')) {
    const row = store.lms_connections.find((c) => c.user_id === params[0] && c.provider === params[1]);
    if (row) Object.assign(row, { access_token: params[2], token_expires_at: params[3] });
    return rows([]);
  }
  if (q.startsWith('UPDATE lms_connections SET synced_at = now()')) {
    const row = store.lms_connections.find((c) => c.user_id === params[0] && c.provider === params[1]);
    if (row) row.synced_at = new Date().toISOString();
    return rows([]);
  }

  if (q.startsWith('SELECT * FROM classes WHERE user_id = $1 AND external_source = $2 AND external_course_id = $3')) {
    return rows(store.classes.filter((c) => c.user_id === params[0] && c.external_source === params[1] && c.external_course_id === params[2]));
  }
  if (q.startsWith('SELECT * FROM classes WHERE user_id = $1 AND external_course_id IS NULL AND archived_at IS NULL')) {
    const [user_id, nm, code] = params;
    const match = store.classes.filter((c) => c.user_id === user_id && c.external_course_id == null && c.archived_at == null &&
      (String(c.name).toLowerCase() === String(nm).toLowerCase() || (code !== '' && String(c.code || '').toLowerCase() === String(code).toLowerCase())));
    return rows(match.slice(0, 1));
  }
  if (q.startsWith('UPDATE classes SET external_source = $2, external_course_id = $3 WHERE id = $1 RETURNING *')) {
    const c = store.classes.find((x) => x.id === params[0]);
    if (c) { c.external_source = params[1]; c.external_course_id = params[2]; }
    return rows(c ? [c] : []);
  }
  if (q.startsWith('UPDATE classes SET external_source = $2, external_course_id = $3 WHERE id = $1')) {
    const c = store.classes.find((x) => x.id === params[0]);
    if (c) { c.external_source = params[1]; c.external_course_id = params[2]; }
    return rows([]);
  }
  if (q.startsWith('INSERT INTO classes')) {
    const [user_id, name, code, external_source, external_course_id] = params;
    const c = { id: uuid(), user_id, name, code, external_source, external_course_id, archived_at: null, created_at: new Date().toISOString() };
    store.classes.push(c);
    return rows([c]);
  }

  if (q.startsWith('SELECT id FROM assignments WHERE class_id = $1 AND external_source = $2 AND external_id = $3')) {
    return rows(store.assignments.filter((a) => a.class_id === params[0] && a.external_source === params[1] && a.external_id === params[2]).map((a) => ({ id: a.id })));
  }
  if (q.startsWith('SELECT external_id FROM assignments WHERE class_id = $1 AND external_source = $2 AND external_id IS NOT NULL')) {
    return rows(store.assignments.filter((a) => a.class_id === params[0] && a.external_source === params[1] && a.external_id != null).map((a) => ({ external_id: a.external_id })));
  }
  if (q.startsWith('UPDATE assignments SET title = $2, due_date = $3, point_value = $4')) {
    const a = store.assignments.find((x) => x.id === params[0]);
    if (a) { a.title = params[1]; a.due_date = params[2]; a.point_value = params[3]; if (params[4] != null) a.description = params[4]; }
    return rows([]);
  }
  if (q.startsWith('INSERT INTO assignments')) {
    const [class_id, title, due_date, point_value, description, external_source, external_id] = params;
    const a = { id: uuid(), class_id, title, due_date, point_value, description, external_source, external_id, status: 'not_started' };
    store.assignments.push(a);
    return rows([{ id: a.id }]);
  }
  if (q.startsWith("UPDATE assignments SET status = 'graded' WHERE id = $1")) {
    const a = store.assignments.find((x) => x.id === params[0]);
    if (a) a.status = 'graded';
    return rows([]);
  }

  if (q.startsWith('INSERT INTO grades')) {
    const [assignment_id, earned, possible] = params;
    let g = store.grades.find((x) => x.assignment_id === assignment_id);
    if (g) Object.assign(g, { points_earned: earned, points_possible: possible });
    else store.grades.push({ id: uuid(), assignment_id, points_earned: earned, points_possible: possible });
    return rows([]);
  }

  // Synced-data counts per external_source (status enrichment).
  if (q.startsWith('SELECT a.external_source AS provider')) {
    const userClassIds = new Set(store.classes.filter((c) => c.user_id === params[0]).map((c) => c.id));
    const gradedIds = new Set(store.grades.map((g) => g.assignment_id));
    const by = {};
    for (const a of store.assignments) {
      if (!userClassIds.has(a.class_id) || a.external_source == null) continue;
      const r = (by[a.external_source] ??= { provider: a.external_source, assignments: 0, grades: 0 });
      r.assignments++;
      if (gradedIds.has(a.id)) r.grades++;
    }
    return rows(Object.values(by));
  }

  // Most-recent sync-log row per provider.
  if (q.startsWith('SELECT DISTINCT ON (provider) provider, trigger, status')) {
    const mine = store.lms_sync_log.filter((l) => l.user_id === params[0]);
    const latest = {};
    for (const l of mine) {
      if (!latest[l.provider] || l.started_at > latest[l.provider].started_at) latest[l.provider] = l;
    }
    return rows(Object.values(latest));
  }

  // Recent sync-log rows for one provider (getSyncLog).
  if (q.startsWith('SELECT id, trigger, status, courses, imported, updated, grades')) {
    const mine = store.lms_sync_log
      .filter((l) => l.user_id === params[0] && l.provider === params[1])
      .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
      .slice(0, params[2] ?? 20);
    return rows(mine);
  }

  if (q.startsWith('INSERT INTO lms_sync_log')) {
    const [user_id, provider, trigger, status, courses, imported, updated, grades, error_message, started_at] = params;
    store.lms_sync_log.push({
      id: uuid(), user_id, provider, trigger, status,
      courses, imported, updated, grades, error_message,
      started_at, completed_at: new Date().toISOString(),
    });
    return rows([]);
  }

  throw new Error('FakeDB: unhandled SQL: ' + q.slice(0, 90));
}

function rows(r) { return { rows: r, rowCount: r.length }; }

export function query(text, params) { return Promise.resolve(run(text, params)); }

export async function withTransaction(fn) {
  const client = { query: (t, p) => Promise.resolve(run(t, p)) };
  return fn(client);
}

export const pool = { query, end: async () => {} };
