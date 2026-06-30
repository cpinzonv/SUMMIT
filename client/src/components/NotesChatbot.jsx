import { useRef, useState } from 'react';
import { api, errorMessage } from '../api/client';

/**
 * Ask-your-notes chatbot for a class. Sends a question to
 * POST /api/classes/:id/notes-chatbot, which answers grounded only in the
 * class's notes. Keeps the conversation in memory for the session (a simple
 * per-class cache while mounted), shows a thinking state, and surfaces the
 * "upload notes first" case clearly.
 */
export default function NotesChatbot({ classId, className }) {
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', text }
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const scroller = useRef(null);

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
    <div className="glass-card flex h-[28rem] flex-col p-4">
      <p className="mb-3 text-sm text-muted">
        Ask questions about your <span className="font-semibold text-ink">{className}</span> notes.
        Answers come only from what you've written.
      </p>

      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && !error && (
          <div className="rounded-xl border border-white/50 bg-white/40 px-3 py-2.5 text-sm text-muted">
            Try: “Summarize the key points,” or “Explain the part about …”.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                m.role === 'user'
                  ? 'bg-brand-500 text-white'
                  : 'border border-white/50 bg-white/55 text-ink'
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-white/50 bg-white/55 px-3.5 py-2 text-sm text-muted">
              Thinking…
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 rounded-xl border border-amber-300/50 bg-amber-50/70 px-3 py-2 text-sm font-medium text-amber-700">
          {error}
        </div>
      )}

      <form onSubmit={ask} className="mt-3 flex gap-2">
        <input
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
  );
}
