import { useRef, useState } from 'react';
import { renderMarkdown } from '../utils/markdown';

const TOOL_BTN =
  'rounded-lg border border-brand-400/30 bg-brand-50/60 px-2.5 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-100';

/** Lightweight Markdown editor: formatting toolbar + write/preview toggle. */
export function MarkdownEditor({ value, onChange, placeholder, rows = 10 }) {
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
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <button type="button" className={TOOL_BTN} onClick={() => surround('**')} title="Bold"><b>B</b></button>
        <button type="button" className={TOOL_BTN} onClick={() => surround('*')} title="Italic"><i>I</i></button>
        <button type="button" className={TOOL_BTN} onClick={() => surround('`')} title="Inline code">{'</>'}</button>
        <button type="button" className={TOOL_BTN} onClick={() => prefixLine('## ')} title="Heading">H</button>
        <button type="button" className={TOOL_BTN} onClick={() => prefixLine('- ')} title="Bulleted list">• List</button>
        <button type="button" className={TOOL_BTN} onClick={() => prefixLine('1. ')} title="Numbered list">1. List</button>
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          className={`ml-auto ${TOOL_BTN}`}
        >
          {preview ? 'Write' : 'Preview'}
        </button>
      </div>
      {preview ? (
        <div
          className="note-prose min-h-[10rem] rounded-xl border border-brand-400/20 bg-white/55 px-4 py-3 text-sm"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value) || '<p class="opacity-50">Nothing to preview</p>' }}
        />
      ) : (
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="field font-mono !text-[13px] leading-relaxed"
        />
      )}
    </div>
  );
}
