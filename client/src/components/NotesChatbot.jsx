import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';

/**
 * Ask-your-notes chatbot for a class, presented as a floating chat bubble in the
 * bottom-right corner. Clicking the bubble opens a popover with the conversation.
 * Answers come from POST /api/classes/:id/notes-chatbot, grounded only in the
 * class's notes. The thread is kept in memory while mounted; it shows a thinking
 * state and surfaces the "upload notes first" case clearly.
 */
export default function NotesChatbot({ classId, className }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', text }
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scroller = useRef(null);
  const inputRef = useRef(null);

  // Close on Escape; focus the input when the popover opens.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const ask = async (e) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    setError('');
    setInput('');
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setLoading(true);
    try {
      const { data } = await api.post(`/api/classes/${classId}/notes-chatbot`, { question: q });
      setMessages((m) => [...m, { role: 'assistant', text: data.answer || '(no answer)' }]);
    } catch (err) {
      const code = err?.response?.data?.error?.details?.code;
      if (code === 'no_notes') {
        setError('Upload notes first to use the chatbot.');
      } else {
        setError(errorMessage(err, 'The chatbot could not answer right now.'));
      }
      // Roll the unanswered question back out of the thread.
      setMessages((m) => m.slice(0, -1));
    } finally {
      setLoading(false);
      requestAnimationFrame(() => {
        if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
      });
    }
  };

  return (
    <>
      {/* Popover */}
      {open && (
        <div
          role="dialog"
          aria-label="Ask your notes"
          className="fixed bottom-24 right-6 z-50 flex h-[32rem] max-h-[calc(100vh-8rem)] w-[23rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/70 shadow-2xl backdrop-blur-xl"
        >
          <header
            className="flex items-center justify-between px-4 py-3 text-white"
            style={{ backgroundImage: 'var(--grad-teal-purple)' }}
          >
            <div className="flex items-center gap-2">
              <ChatGlyph className="h-4 w-4" />
              <span className="text-sm font-bold">Ask your notes</span>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chatbot"
              className="text-xl leading-none text-white/90 transition hover:text-white"
            >
              ×
            </button>
          </header>

          <div className="border-b border-white/50 px-4 py-2.5 text-xs text-muted">
            Answers about your <span className="font-semibold text-ink">{className}</span> notes —
            grounded only in what you’ve written.
          </div>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && !error && (
              <div className="rounded-xl border border-white/50 bg-white/50 px-3 py-2.5 text-sm text-muted">
                Try: “Summarize the key points,” or “Explain the part about …”.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-brand-500 text-white'
                      : 'border border-white/50 bg-white/65 text-ink'
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-white/50 bg-white/65 px-3.5 py-2 text-sm text-muted">
                  Thinking…
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="mx-4 mb-2 rounded-xl border border-amber-300/50 bg-amber-50/80 px-3 py-2 text-sm font-medium text-amber-700">
              {error}
            </div>
          )}

          <form onSubmit={ask} className="flex gap-2 border-t border-white/50 p-3">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your notes…"
              className="field flex-1"
              disabled={loading}
            />
            <button type="submit" disabled={loading || !input.trim()} className="btn btn-primary">
              Ask
            </button>
          </form>
        </div>
      )}

      {/* Floating launcher */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close notes chatbot' : 'Ask your notes'}
        aria-expanded={open}
        title="Ask your notes"
        className="fixed bottom-6 right-6 z-50 grid h-14 w-14 place-items-center rounded-full text-white shadow-xl transition hover:scale-105 active:scale-95"
        style={{ backgroundImage: 'var(--grad-teal-purple)' }}
      >
        {open ? (
          <span className="text-2xl leading-none">×</span>
        ) : (
          <ChatGlyph className="h-6 w-6" />
        )}
      </button>
    </>
  );
}

/** Speech-bubble-with-sparkle glyph for the launcher + header. */
function ChatGlyph({ className = '' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H9l-4 4v-4H6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 6.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"
        fill="currentColor"
      />
    </svg>
  );
}
