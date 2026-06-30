import { useRef, useState } from 'react';
import { renderMarkdown } from '../utils/markdown';

/**
 * Lightweight Markdown editor: a formatting toolbar + write/preview toggle.
 * Styled with the warm note theme (see index.css). `fullHeight` makes the
 * editor grow to fill its container (used in the full-screen notes view).
 */
export function MarkdownEditor({ value, onChange, placeholder, rows = 12, fullHeight = false }) {
  const ref = useRef(null);
  const [preview, setPreview] = useState(false);

  // Wrap the current selection with markers (e.g. ** for bold).
  const surround = (before, after = before) => {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const sel = value.slice(s, e) || 'text';
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = s + before.length;
      ta.selectionEnd = s + before.length + sel.length;
    });
  };

  // Prepend a marker to the start of the current line (e.g. "- " for a list).
  const prefixLine = (prefix) => {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: s } = ta;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const next = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    onChange(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = s + prefix.length;
    });
  };

  return (
    <div className={fullHeight ? 'flex h-full flex-col' : ''}>
      <div
        className="mb-2 flex flex-wrap items-center gap-1 rounded-[10px] p-1"
        style={{ background: 'var(--note-toolbar-bg)' }}
      >
        <button type="button" className="note-tool" onClick={() => surround('**')} title="Bold"><b>B</b></button>
        <button type="button" className="note-tool" onClick={() => surround('*')} title="Italic"><i>I</i></button>
        <button type="button" className="note-tool font-mono" onClick={() => surround('`')} title="Inline code">&lt;/&gt;</button>
        <span className="mx-1 h-4 w-px" style={{ background: 'var(--note-border)' }} />
        <button type="button" className="note-tool" onClick={() => prefixLine('## ')} title="Heading">H</button>
        <button type="button" className="note-tool" onClick={() => prefixLine('- ')} title="Bulleted list">☰ List</button>
        <button type="button" className="note-tool" onClick={() => prefixLine('1. ')} title="Numbered list">1. List</button>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className={`ml-auto note-tool ${preview ? 'note-tool-active' : ''}`}
          title={preview ? 'Back to editing' : 'Preview formatted note'}
        >
          {preview ? '✎ Write' : '👁 Preview'}
        </button>
      </div>
      {preview ? (
        <div
          className={`note-prose overflow-y-auto rounded-[10px] px-4 py-3 text-sm ${fullHeight ? 'flex-1' : 'min-h-[12rem]'}`}
          style={{ background: '#fff', border: '1px solid var(--note-border)', color: 'var(--note-text)' }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value) || '<p class="opacity-50">Nothing to preview</p>' }}
        />
      ) : (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={fullHeight ? undefined : rows}
          className={`note-input resize-none text-[15px] leading-relaxed ${fullHeight ? 'flex-1' : ''}`}
          style={{ fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' }}
        />
      )}
    </div>
  );
}
