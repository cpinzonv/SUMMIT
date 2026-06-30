/**
 * Mock LMS provider factory — in-memory fixtures used when a provider is in mock
 * mode (global LMS_MOCK=true, or MOCK_<KEY>_MODE=true).
 *
 * mockProvider(key) returns an object implementing the exact same interface as
 * the real provider (see ./index.js), so the whole connect → sync → import
 * pipeline runs end-to-end with no credentials and no network. The returned
 * provider reports `name === key`, so rows it writes (external_source) match what
 * the real provider would write — swapping in real credentials is purely an env
 * change.
 *
 * Each provider gets its own small, recognizable fixture set so connecting (say)
 * Blackboard vs. Moodle shows visibly different data while you test.
 */
import { AppError } from '../../utils/AppError.js';
import { getProviderMeta } from './providers.js';

// Dates relative to now so synced assignments land on the calendar sensibly.
const day = (n) => new Date(Date.now() + n * 86400 * 1000).toISOString();

/**
 * Fixtures per provider key. Shape mirrors what real listCourses/listAssignments
 * return after normalization.
 */
const FIXTURES = {
  canvas: [
    {
      course: { externalId: 'c-101', name: 'Organic Chemistry', code: 'CHEM 210', term: 'Fall 2026' },
      assignments: [
        { externalId: 'a-1', title: 'Lab Report: Distillation', dueDate: day(3), pointValue: 50,
          description: 'Write up the fractional distillation lab. Include your gas chromatography trace.',
          url: 'https://example.instructure.com/courses/101/assignments/1', grade: null },
        { externalId: 'a-2', title: 'Problem Set 4', dueDate: day(7), pointValue: 30,
          description: 'Chapter 8: stereochemistry problems 1–20.',
          url: 'https://example.instructure.com/courses/101/assignments/2', grade: null },
        { externalId: 'a-3', title: 'Midterm 1', dueDate: day(-5), pointValue: 100,
          description: 'Covers chapters 1–7.',
          url: 'https://example.instructure.com/courses/101/assignments/3',
          grade: { pointsEarned: 88, pointsPossible: 100 } },
      ],
    },
    {
      course: { externalId: 'c-202', name: 'Linear Algebra', code: 'MATH 250', term: 'Fall 2026' },
      assignments: [
        { externalId: 'b-1', title: 'Homework 6: Eigenvalues', dueDate: day(2), pointValue: 20,
          description: 'Compute eigenvalues and eigenvectors for the given matrices.',
          url: 'https://example.instructure.com/courses/202/assignments/11', grade: null },
        { externalId: 'b-2', title: 'Quiz 3', dueDate: day(-2), pointValue: 25,
          description: 'Short quiz on vector spaces.',
          url: 'https://example.instructure.com/courses/202/assignments/12',
          grade: { pointsEarned: 23, pointsPossible: 25 } },
      ],
    },
  ],

  blackboard: [
    {
      course: { externalId: 'bb-hist-301', name: 'Modern European History', code: 'HIST 301', term: 'Fall 2026' },
      assignments: [
        { externalId: 'bb-a1', title: 'Essay: Causes of WWI', dueDate: day(5), pointValue: 100,
          description: 'A 1500-word analytical essay on the long- and short-term causes of the First World War.',
          url: 'https://blackboard.example.edu/ultra/courses/_301_1/outline/assignment/_a1', grade: null },
        { externalId: 'bb-a2', title: 'Reading Response 3', dueDate: day(1), pointValue: 20,
          description: 'Respond to the assigned primary sources on the Congress of Vienna.',
          url: 'https://blackboard.example.edu/ultra/courses/_301_1/outline/assignment/_a2', grade: null },
        { externalId: 'bb-a3', title: 'Map Quiz', dueDate: day(-3), pointValue: 30,
          description: 'Identify the borders of Europe in 1914.',
          url: 'https://blackboard.example.edu/ultra/courses/_301_1/outline/assignment/_a3',
          grade: { pointsEarned: 27, pointsPossible: 30 } },
      ],
    },
    {
      course: { externalId: 'bb-bio-150', name: 'Introductory Biology', code: 'BIO 150', term: 'Fall 2026' },
      assignments: [
        { externalId: 'bb-b1', title: 'Cell Structure Worksheet', dueDate: day(4), pointValue: 25,
          description: 'Label the organelles and describe their functions.',
          url: 'https://blackboard.example.edu/ultra/courses/_150_1/outline/assignment/_b1', grade: null },
        { externalId: 'bb-b2', title: 'Lab Practical 1', dueDate: day(9), pointValue: 75,
          description: 'Microscopy and cell identification practical.',
          url: 'https://blackboard.example.edu/ultra/courses/_150_1/outline/assignment/_b2', grade: null },
      ],
    },
  ],

  google_classroom: [
    {
      course: { externalId: 'gc-cs101', name: 'AP Computer Science A', code: 'CS-A', term: '2026' },
      assignments: [
        { externalId: 'gc-1', title: 'Unit 3: Arrays Project', dueDate: day(6), pointValue: 100,
          description: 'Build a gradebook program using 2D arrays. Submit your .java files.',
          url: 'https://classroom.google.com/c/cs101/a/1/details', grade: null },
        { externalId: 'gc-2', title: 'Daily Warmup 14', dueDate: day(1), pointValue: 10,
          description: 'Trace the recursion in the provided method.',
          url: 'https://classroom.google.com/c/cs101/a/2/details', grade: null },
        { externalId: 'gc-3', title: 'Unit 2 Test', dueDate: day(-4), pointValue: 50,
          description: 'Booleans, conditionals, and loops.',
          url: 'https://classroom.google.com/c/cs101/a/3/details',
          grade: { pointsEarned: 46, pointsPossible: 50 } },
      ],
    },
    {
      course: { externalId: 'gc-eng201', name: 'English Literature', code: 'ENG 201', term: '2026' },
      assignments: [
        { externalId: 'gc-e1', title: 'Hamlet Act III Analysis', dueDate: day(3), pointValue: 40,
          description: 'Close-read the "To be or not to be" soliloquy.',
          url: 'https://classroom.google.com/c/eng201/a/1/details', grade: null },
      ],
    },
  ],

  brightspace: [
    {
      course: { externalId: 'd2l-psyc-210', name: 'Cognitive Psychology', code: 'PSYC 210', term: 'Fall 2026' },
      assignments: [
        { externalId: 'd2l-1', title: 'Memory Experiment Write-up', dueDate: day(8), pointValue: 60,
          description: 'Report on the serial-position recall experiment run in lab.',
          url: 'https://example.brightspace.com/d2l/le/dropbox/1001/1', grade: null },
        { externalId: 'd2l-2', title: 'Discussion: Attention Models', dueDate: day(2), pointValue: 15,
          description: 'Post and respond to two peers about early vs. late selection.',
          url: 'https://example.brightspace.com/d2l/le/dropbox/1001/2', grade: null },
        { externalId: 'd2l-3', title: 'Quiz: Sensation & Perception', dueDate: day(-6), pointValue: 40,
          description: 'Online quiz, 20 questions.',
          url: 'https://example.brightspace.com/d2l/le/dropbox/1001/3',
          grade: { pointsEarned: 35, pointsPossible: 40 } },
      ],
    },
    {
      course: { externalId: 'd2l-econ-101', name: 'Principles of Microeconomics', code: 'ECON 101', term: 'Fall 2026' },
      assignments: [
        { externalId: 'd2l-e1', title: 'Problem Set: Supply & Demand', dueDate: day(5), pointValue: 30,
          description: 'Graph the equilibria for the six scenarios.',
          url: 'https://example.brightspace.com/d2l/le/dropbox/1002/1', grade: null },
      ],
    },
  ],

  moodle: [
    {
      course: { externalId: 'mdl-phys-211', name: 'University Physics II', code: 'PHYS 211', term: 'Fall 2026' },
      assignments: [
        { externalId: 'mdl-1', title: 'Homework: Electric Fields', dueDate: day(4), pointValue: 40,
          description: 'Problems 1–12 from chapter 22.',
          url: 'https://moodle.example.edu/mod/assign/view.php?id=2201', grade: null },
        { externalId: 'mdl-2', title: 'Lab 5: Circuits', dueDate: day(10), pointValue: 50,
          description: 'Build and measure RC circuits; submit your data table.',
          url: 'https://moodle.example.edu/mod/assign/view.php?id=2202', grade: null },
        { externalId: 'mdl-3', title: 'Midterm Exam', dueDate: day(-7), pointValue: 100,
          description: 'Electrostatics through DC circuits.',
          url: 'https://moodle.example.edu/mod/assign/view.php?id=2203',
          grade: { pointsEarned: 81, pointsPossible: 100 } },
      ],
    },
    {
      course: { externalId: 'mdl-span-102', name: 'Intermediate Spanish', code: 'SPAN 102', term: 'Fall 2026' },
      assignments: [
        { externalId: 'mdl-s1', title: 'Composición 2', dueDate: day(3), pointValue: 25,
          description: 'Escribe una composición de 300 palabras sobre tus vacaciones.',
          url: 'https://moodle.example.edu/mod/assign/view.php?id=1102', grade: null },
      ],
    },
  ],

  sakai: [
    {
      course: { externalId: 'sk-soc-100', name: 'Introduction to Sociology', code: 'SOC 100', term: 'Fall 2026' },
      assignments: [
        { externalId: 'sk-1', title: 'Fieldwork Observation', dueDate: day(7), pointValue: 50,
          description: 'Observe a public space for one hour and write up your sociological notes.',
          url: 'https://sakai.example.edu/portal/site/SOC100/assignment/1', grade: null },
        { externalId: 'sk-2', title: 'Reading Quiz 4', dueDate: day(1), pointValue: 20,
          description: 'Durkheim on social facts.',
          url: 'https://sakai.example.edu/portal/site/SOC100/assignment/2', grade: null },
        { externalId: 'sk-3', title: 'Group Presentation Outline', dueDate: day(-1), pointValue: 30,
          description: 'Submit your group’s outline before the in-class presentation.',
          url: 'https://sakai.example.edu/portal/site/SOC100/assignment/3',
          grade: { pointsEarned: 28, pointsPossible: 30 } },
      ],
    },
    {
      course: { externalId: 'sk-stat-200', name: 'Statistics for Social Science', code: 'STAT 200', term: 'Fall 2026' },
      assignments: [
        { externalId: 'sk-st1', title: 'Problem Set: Hypothesis Testing', dueDate: day(6), pointValue: 35,
          description: 'Run t-tests on the provided datasets and interpret the results.',
          url: 'https://sakai.example.edu/portal/site/STAT200/assignment/1', grade: null },
      ],
    },
  ],
};

/** Build a mock provider object that masquerades as the given provider key. */
export function mockProvider(key) {
  const meta = getProviderMeta(key);
  const label = meta?.label || key;
  const courses = FIXTURES[key] || FIXTURES.canvas;

  return {
    name: key,

    isConfigured() {
      return true;
    },

    /** Skip the real consent screen: bounce straight back with a fake code. */
    buildAuthUrl({ redirectUri, state }) {
      const sep = redirectUri.includes('?') ? '&' : '?';
      return `${redirectUri}${sep}code=mock-auth-code&state=${encodeURIComponent(state)}`;
    },

    exchangeCode({ code }) {
      if (code !== 'mock-auth-code') {
        // Mirror a real provider's failure shape (→ AppError 400).
        throw AppError.badRequest(`${label} authorization failed: invalid authorization code`);
      }
      return Promise.resolve({
        accessToken: `mock-${key}-access-token`,
        refreshToken: `mock-${key}-refresh-token`,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      });
    },

    refresh() {
      return Promise.resolve({
        accessToken: `mock-${key}-access-token-refreshed`,
        refreshToken: null,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      });
    },

    listCourses() {
      return Promise.resolve(courses.map((c) => ({ ...c.course })));
    },

    listAssignments({ externalCourseId }) {
      const entry = courses.find((c) => c.course.externalId === externalCourseId);
      return Promise.resolve(entry ? entry.assignments.map((a) => ({ ...a })) : []);
    },
  };
}
