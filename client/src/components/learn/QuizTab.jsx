import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '../../api/client';
import { Modal, Spinner, ErrorBanner } from '../ui';
import { EmptyHero, AssignmentsIllustration } from '../EmptyHero';
import { Labeled } from './common';
import { printHtml } from '../../lib/learnExport';

/** Quizzes: list, generate (premium), take, and review results. */
export function QuizTab({ classId, flash }) {
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generating, setGenerating] = useState(false);
  const [activeQuizId, setActiveQuizId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/api/learn/classes/${classId}/quizzes`);
      setQuizzes(data.quizzes);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [classId]);

  useEffect(() => { load(); }, [load]);

  if (activeQuizId) {
    return <QuizRunner quizId={activeQuizId} onExit={() => { setActiveQuizId(null); load(); }} />;
  }
  if (loading) return <Spinner label="Loading quizzes…" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn btn-soft" onClick={() => setGenerating(true)}>✦ Generate quiz</button>
      </div>
      {error && <ErrorBanner message={error} />}
      {quizzes.length === 0 ? (
        <EmptyHero
          illustration={<AssignmentsIllustration />}
          headline="No quizzes yet"
          subheading="Generate a multiple-choice quiz from this class's material."
          ctaLabel="✦ Generate a quiz"
          onCta={() => setGenerating(true)}
        />
      ) : (
        <div className="space-y-2">
          {quizzes.map((q) => (
            <button key={q.id} onClick={() => setActiveQuizId(q.id)} className="glass-panel flex w-full items-center justify-between p-4 text-left transition hover:shadow-md">
              <div>
                <p className="font-semibold text-ink">{q.title}</p>
                <p className="text-xs text-muted">{q.questionCount} questions{q.attemptedAt ? ` · last score ${q.score}%` : ' · not attempted'}</p>
              </div>
              <span className="text-sm font-semibold text-brand-600">{q.attemptedAt ? 'Retake →' : 'Start →'}</span>
            </button>
          ))}
        </div>
      )}
      {generating && (
        <GenerateQuizModal classId={classId} onClose={() => setGenerating(false)}
          onGenerated={(id) => { setGenerating(false); flash('Quiz generated'); setActiveQuizId(id); }} />
      )}
    </div>
  );
}

function GenerateQuizModal({ classId, onClose, onGenerated }) {
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const { data } = await api.post(`/api/learn/classes/${classId}/quizzes/generate`, { questionCount: Number(count) });
      onGenerated(data.quizId);
    } catch (e) { setErr(errorMessage(e)); setBusy(false); }
  };
  return (
    <Modal title="Generate a quiz" onClose={onClose}>
      <div className="space-y-3">
        {err && <ErrorBanner message={err} />}
        <p className="text-sm text-muted">Claude writes multiple-choice questions from this class's notes & transcripts.</p>
        <Labeled label="Number of questions"><input type="number" min={3} max={20} className="field" value={count} onChange={(e) => setCount(e.target.value)} /></Labeled>
        <div className="flex justify-end gap-2 pt-1">
          <button className="btn btn-soft" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={go}>{busy ? 'Generating…' : 'Generate'}</button>
        </div>
      </div>
    </Modal>
  );
}

const LETTERS = ['A', 'B', 'C', 'D'];

function QuizRunner({ quizId, onExit }) {
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [startedAt] = useState(Date.now());

  useEffect(() => {
    (async () => {
      try { const { data } = await api.get(`/api/learn/quizzes/${quizId}`); setQuiz(data); }
      catch (e) { setError(errorMessage(e)); }
    })();
  }, [quizId]);

  const submit = async () => {
    setSubmitting(true); setError('');
    try {
      const { data } = await api.post(`/api/learn/quizzes/${quizId}/submit`, {
        answers, timeSpentSeconds: Math.round((Date.now() - startedAt) / 1000),
      });
      setResults(data);
    } catch (e) { setError(errorMessage(e)); setSubmitting(false); }
  };

  if (error) return <div className="space-y-3"><ErrorBanner message={error} /><button className="btn btn-soft" onClick={onExit}>← Back</button></div>;
  if (!quiz) return <Spinner label="Loading quiz…" />;

  if (results) {
    const gradeColor = results.score >= 80 ? 'text-emerald-500' : results.score >= 60 ? 'text-amber-500' : 'text-rose-500';
    const byId = Object.fromEntries(results.feedback.map((f) => [f.questionId, f]));
    const exportResults = () => {
      const rows = quiz.questions.map((q, i) => {
        const f = byId[q.id];
        return `<div class="q">${i + 1}. ${q.question}</div>
          <div class="${f.correct ? 'correct' : 'wrong'}">Your answer: ${f.chosen ?? '—'} ${f.correct ? '✓' : `✗ (correct: ${f.correctAnswer})`}</div>
          ${f.explanation ? `<div>${f.explanation}</div>` : ''}`;
      }).join('<hr>');
      printHtml(quiz.title, `<h1>${quiz.title}</h1><h2>Score: ${results.score}% · Grade ${results.grade} (${results.correctCount}/${results.total})</h2>${rows}`);
    };
    return (
      <div className="space-y-4">
        <div className="glass-panel p-6 text-center">
          <p className={`font-display text-4xl font-bold ${gradeColor}`}>{results.score}%</p>
          <p className="text-sm text-muted">Grade {results.grade} · {results.correctCount}/{results.total} correct</p>
        </div>
        <div className="space-y-3">
          {quiz.questions.map((q, i) => {
            const f = byId[q.id];
            return (
              <div key={q.id} className="glass-panel p-4">
                <p className="font-semibold text-ink">{i + 1}. {q.question}</p>
                <div className="mt-2 space-y-1">
                  {q.options.map((opt, oi) => {
                    const letter = LETTERS[oi];
                    const isCorrect = letter === f.correctAnswer;
                    const isChosen = letter === f.chosen;
                    return (
                      <div key={oi} className={`rounded-lg px-3 py-1.5 text-sm ${isCorrect ? 'bg-emerald-400/15 text-emerald-700' : isChosen ? 'bg-rose-400/15 text-rose-700' : 'text-muted'}`}>
                        {letter}. {opt} {isCorrect ? '✓' : isChosen ? '✗' : ''}
                      </div>
                    );
                  })}
                </div>
                {!f.correct && f.explanation && <p className="mt-2 text-xs text-muted">💡 {f.explanation}</p>}
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-soft" onClick={onExit}>← Back to quizzes</button>
          <button className="btn btn-soft" onClick={exportResults}>⬇ Export results</button>
        </div>
      </div>
    );
  }

  const allAnswered = quiz.questions.every((q) => answers[q.id]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-ink">{quiz.title}</h3>
        <button className="text-sm text-muted hover:text-ink" onClick={onExit}>Cancel</button>
      </div>
      {quiz.questions.map((q, i) => (
        <div key={q.id} className="glass-panel p-4">
          <p className="font-semibold text-ink">{i + 1}. {q.question}</p>
          <div className="mt-2 space-y-1">
            {q.options.map((opt, oi) => {
              const letter = LETTERS[oi];
              const selected = answers[q.id] === letter;
              return (
                <label key={oi} className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${selected ? 'bg-brand-500/15 text-ink' : 'text-muted hover:bg-white/50'}`}>
                  <input type="radio" name={q.id} checked={selected} onChange={() => setAnswers((a) => ({ ...a, [q.id]: letter }))} />
                  {letter}. {opt}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <button className="btn btn-primary w-full" disabled={!allAnswered || submitting} onClick={submit}>
        {submitting ? 'Grading…' : allAnswered ? 'Submit quiz' : `Answer all ${quiz.questions.length} questions`}
      </button>
    </div>
  );
}
