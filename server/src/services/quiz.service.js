/**
 * Quizzes — Claude-generated multiple-choice quizzes with grading. Questions are
 * stored as JSONB; each has a stable id, 4 options, a correct letter, and an
 * explanation. The correct answer is NEVER sent to the client until submission.
 */
import crypto from 'node:crypto';
import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { getOwnedClass } from './class.service.js';
import { gatherClassContext } from './learnSource.js';
import { runStructured } from './learnAi.js';

const LETTERS = ['A', 'B', 'C', 'D'];

const quizSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, description: 'Exactly 4 options' },
          correctIndex: { type: 'integer', description: '0-based index of the correct option' },
          explanation: { type: 'string', description: 'Why the correct option is right' },
        },
        required: ['question', 'options', 'correctIndex', 'explanation'],
      },
    },
  },
  required: ['difficulty', 'questions'],
};

/** Shuffle an array (Fisher–Yates) — so the correct option isn't always in one slot. */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Normalize a model question into our stored shape with a shuffled correct slot. */
function normalizeQuestion(q) {
  const opts = Array.isArray(q.options) ? q.options.filter((o) => typeof o === 'string') : [];
  if (opts.length < 4) return null;
  const four = opts.slice(0, 4);
  const correctText = four[Math.max(0, Math.min(3, q.correctIndex ?? 0))];
  const shuffled = shuffle(four);
  const correctIdx = shuffled.indexOf(correctText);
  return {
    id: crypto.randomUUID(),
    question: q.question,
    options: shuffled,
    correctAnswer: LETTERS[correctIdx < 0 ? 0 : correctIdx],
    explanation: q.explanation || '',
  };
}

export async function generateQuiz(userId, classId, { questionCount = 10, sourceType = null } = {}) {
  const cls = await getOwnedClass(userId, classId);
  const { text } = await gatherClassContext(classId, sourceType);
  const n = Math.min(Math.max(questionCount, 3), 20);

  const system =
    `You are writing a ${n}-question multiple-choice quiz for a student's "${cls.name}" class, ` +
    `using ONLY the material below. Each question has exactly 4 options, exactly one correct, and ` +
    `a short explanation. Do not invent facts.\n\nMaterial:\n"""\n${text}\n"""`;
  const data = await runStructured({
    feature: 'Quiz generation',
    system,
    user: `Generate ${n} questions now.`,
    schema: quizSchema,
  });

  const questions = (Array.isArray(data.questions) ? data.questions : [])
    .map(normalizeQuestion)
    .filter(Boolean)
    .slice(0, n);
  if (!questions.length) throw new AppError(502, 'No quiz questions were generated. Try again.');

  const title = `${cls.name} quiz · ${questions.length} questions`;
  const { rows } = await query(
    `INSERT INTO quizzes (class_id, user_id, title, question_count, questions)
     VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
    [classId, userId, title, questions.length, JSON.stringify(questions)],
  );
  return { quizId: rows[0].id, title, questionCount: questions.length, difficulty: data.difficulty || 'medium' };
}

async function getOwnedQuiz(userId, quizId) {
  const { rows } = await query('SELECT * FROM quizzes WHERE id = $1 AND user_id = $2', [quizId, userId]);
  if (!rows[0]) throw AppError.notFound('Quiz not found');
  return rows[0];
}

/** Quiz for taking — strips correct answers + explanations. */
export async function getQuizForTaking(userId, quizId) {
  const quiz = await getOwnedQuiz(userId, quizId);
  return {
    id: quiz.id,
    title: quiz.title,
    questionCount: quiz.question_count,
    attemptedAt: quiz.attempted_at,
    score: quiz.score,
    questions: (quiz.questions || []).map((q) => ({ id: q.id, question: q.question, options: q.options })),
  };
}

/** List a class's quizzes (metadata only). */
export async function listClassQuizzes(userId, classId) {
  await getOwnedClass(userId, classId);
  const { rows } = await query(
    `SELECT id, title, question_count, attempted_at, score, generated_at
       FROM quizzes WHERE class_id = $1 AND user_id = $2 ORDER BY generated_at DESC`,
    [classId, userId],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    questionCount: r.question_count,
    attemptedAt: r.attempted_at,
    score: r.score,
    generatedAt: r.generated_at,
  }));
}

/** Delete a quiz the user owns. */
export async function deleteQuiz(userId, quizId) {
  const { rowCount } = await query('DELETE FROM quizzes WHERE id = $1 AND user_id = $2', [quizId, userId]);
  if (!rowCount) throw AppError.notFound('Quiz not found');
}

/** Grade a submission; persist the attempt; return score + per-question feedback. */
export async function submitQuiz(userId, quizId, { answers = {}, timeSpentSeconds }) {
  const quiz = await getOwnedQuiz(userId, quizId);
  const questions = quiz.questions || [];
  let correct = 0;
  const feedback = questions.map((q) => {
    const chosen = answers[q.id] ?? null;
    const isCorrect = chosen === q.correctAnswer;
    if (isCorrect) correct += 1;
    return {
      questionId: q.id,
      correct: isCorrect,
      chosen,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
    };
  });
  const total = questions.length || 1;
  const score = Math.round((correct / total) * 100);
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  await query(
    `UPDATE quizzes SET attempted_at = now(), score = $1, time_spent_seconds = $2 WHERE id = $3`,
    [score, timeSpentSeconds ?? null, quizId],
  );

  return { quizId, score, grade, correctCount: correct, total, timeSpentSeconds: timeSpentSeconds ?? null, feedback };
}
