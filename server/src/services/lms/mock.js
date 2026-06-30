/**
 * Mock LMS provider — an in-memory fixture "Canvas" used when LMS_MOCK=true.
 *
 * It implements the exact same interface as the real Canvas provider so the
 * whole connect → sync → import pipeline runs end-to-end with no credentials
 * and no network. Swapping in real Canvas later is purely an env change.
 */
import { name as canvasName } from './canvas.js';
import { AppError } from '../../utils/AppError.js';

export const name = canvasName; // masquerades as 'canvas' so stored rows are consistent

export function isConfigured() {
  return true;
}

/** Skip the real consent screen: bounce straight back with a fake code. */
export function buildAuthUrl({ redirectUri, state }) {
  const sep = redirectUri.includes('?') ? '&' : '?';
  return `${redirectUri}${sep}code=mock-auth-code&state=${encodeURIComponent(state)}`;
}

export function exchangeCode({ code }) {
  if (code !== 'mock-auth-code') {
    // Mirror the real provider's failure shape (Canvas → AppError 400).
    throw AppError.badRequest('Canvas authorization failed: invalid authorization code');
  }
  return Promise.resolve({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  });
}

export function refresh() {
  return Promise.resolve({
    accessToken: 'mock-access-token-refreshed',
    refreshToken: null,
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  });
}

// Dates relative to now so synced assignments land on the calendar sensibly.
const day = (n) => new Date(Date.now() + n * 86400 * 1000).toISOString();

const COURSES = [
  {
    course: { externalId: 'c-101', name: 'Organic Chemistry', code: 'CHEM 210', term: 'Fall 2026' },
    assignments: [
      {
        externalId: 'a-1',
        title: 'Lab Report: Distillation',
        dueDate: day(3),
        pointValue: 50,
        description: 'Write up the fractional distillation lab. Include your gas chromatography trace.',
        url: 'https://example.instructure.com/courses/101/assignments/1',
        grade: null,
      },
      {
        externalId: 'a-2',
        title: 'Problem Set 4',
        dueDate: day(7),
        pointValue: 30,
        description: 'Chapter 8: stereochemistry problems 1–20.',
        url: 'https://example.instructure.com/courses/101/assignments/2',
        grade: null,
      },
      {
        externalId: 'a-3',
        title: 'Midterm 1',
        dueDate: day(-5),
        pointValue: 100,
        description: 'Covers chapters 1–7.',
        url: 'https://example.instructure.com/courses/101/assignments/3',
        grade: { pointsEarned: 88, pointsPossible: 100 },
      },
    ],
  },
  {
    course: { externalId: 'c-202', name: 'Linear Algebra', code: 'MATH 250', term: 'Fall 2026' },
    assignments: [
      {
        externalId: 'b-1',
        title: 'Homework 6: Eigenvalues',
        dueDate: day(2),
        pointValue: 20,
        description: 'Compute eigenvalues and eigenvectors for the given matrices.',
        url: 'https://example.instructure.com/courses/202/assignments/11',
        grade: null,
      },
      {
        externalId: 'b-2',
        title: 'Quiz 3',
        dueDate: day(-2),
        pointValue: 25,
        description: 'Short quiz on vector spaces.',
        url: 'https://example.instructure.com/courses/202/assignments/12',
        grade: { pointsEarned: 23, pointsPossible: 25 },
      },
    ],
  },
];

export function listCourses() {
  return Promise.resolve(COURSES.map((c) => ({ ...c.course })));
}

export function listAssignments({ externalCourseId }) {
  const entry = COURSES.find((c) => c.course.externalId === externalCourseId);
  return Promise.resolve(entry ? entry.assignments.map((a) => ({ ...a })) : []);
}
