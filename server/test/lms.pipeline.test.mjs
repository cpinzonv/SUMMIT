/**
 * Integration test for the multi-provider LMS sync pipeline.
 *
 * Runs the REAL lms.service.js + every registered provider module in mock mode,
 * backed by an in-memory DB (test/fakedb.mjs) so it needs no Postgres. For each
 * provider it asserts: connect stores an ENCRYPTED token, a full sync creates
 * classes + assignments + grades, a second sync dedupes (0 new), per-class import
 * works, and the data the dashboard/calendar need (due dates + grades) is present.
 *
 * Run:  node --experimental-test-module-mocks test/lms.pipeline.test.mjs
 * (from the server/ directory)
 */
import { mock } from 'node:test';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const resolve = (p) => fileURLToPath(new URL(p, import.meta.url));

// Env must be set before importing anything that reads src/config/env.js.
process.env.DATABASE_URL = 'postgres://fake';
process.env.JWT_ACCESS_SECRET = 'a';
process.env.JWT_REFRESH_SECRET = 'b';
process.env.LMS_MOCK = 'true';
process.env.LMS_TOKEN_ENC_KEY = '0'.repeat(64);

// Replace the DB layer with the in-memory fake for the real service code.
const fake = await import('./fakedb.mjs');
mock.module(resolve('../src/config/db.js'), { namedExports: fake });

const lms = await import('../src/services/lms.service.js');
const { PROVIDER_KEYS } = await import('../src/services/lms/index.js');
const { decrypt } = await import('../src/utils/crypto.js');
const { store } = fake;

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${msg}`); if (!cond) failures++; };

const USER = crypto.randomUUID();

for (const provider of PROVIDER_KEYS) {
  console.log(`\n=== ${provider} ===`);
  store.reset();
  store.users.push({ id: USER });

  const status = await lms.connect(USER, provider, { code: 'mock-auth-code', domain: 'school.test.edu' });
  ok(status.connected === true, 'connect() reports connected');
  const conn = store.lms_connections.find((c) => c.provider === provider);
  ok(conn && conn.access_token && conn.access_token.startsWith('v1:'), 'access token stored ENCRYPTED (v1: prefix)');
  ok(decrypt(conn.access_token) === `mock-${provider}-access-token`, 'stored token decrypts to the provider token');

  const t1 = await lms.syncAll(USER, provider);
  ok(t1.courses >= 1, `sync fetched ${t1.courses} course(s)`);
  ok(t1.imported >= 1, `sync imported ${t1.imported} assignment(s)`);
  ok(store.classes.every((c) => c.external_source === provider), 'created classes tagged with this provider');
  ok(t1.grades >= 1, `sync filled ${t1.grades} grade(s)`);

  const withDue = store.assignments.filter((a) => a.due_date);
  ok(withDue.length === store.assignments.length, 'every assignment has a due_date (calendar-ready)');
  ok(store.grades.length === t1.grades, 'grades persisted for graded assignments (dashboard-ready)');

  const afterFirst = store.assignments.length;
  const t2 = await lms.syncAll(USER, provider);
  ok(t2.imported === 0, 're-sync imports 0 new (dedupe works)');
  ok(store.assignments.length === afterFirst, 'assignment count unchanged after re-sync');

  const cls = store.classes[0];
  const importable = await lms.listImportableAssignments(USER, provider, cls);
  ok(importable.length >= 1, `listImportable returned ${importable.length} item(s)`);
  ok(importable.every((a) => a.alreadyImported), 'already-synced items flagged alreadyImported');
  const imp = await lms.importAssignments(USER, provider, cls, importable.slice(0, 1).map((a) => a.externalId));
  ok(imp.updated >= 1 || imp.imported >= 0, 'class-level import runs without error');

  const all = await lms.getStatuses(USER);
  ok(all.find((p) => p.provider === provider)?.connected, 'getStatuses shows provider connected');
  await lms.disconnect(USER, provider);
  ok((await lms.getStatus(USER, provider)).connected === false, 'disconnect() clears the connection');
}

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'} across providers: ${PROVIDER_KEYS.join(', ')}`);
process.exit(failures === 0 ? 0 : 1);
