import { useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { renderMarkdown } from '../utils/markdown';
import { MathInline } from '../lib/mathExtension';
import { NoteImage } from '../lib/imageExtension';
import { HandwritingCanvas } from './HandwritingCanvas';

// Legacy notes were stored as Markdown; new ones are HTML. If the content has
// no HTML tags, treat it as Markdown and convert so it loads formatted.
function toHtml(content) {
  const c = content || '';
  if (!c.trim()) return '';
  return /<[a-z][\s\S]*>/i.test(c) ? c : renderMarkdown(c);
}

/**
 * WYSIWYG rich-text editor (TipTap). Formatting is applied and shown live — no
 * Markdown syntax, no preview toggle. Emits HTML via onChange. The editor owns
 * its content after mount; parents switch notes by remounting (key=note id).
 */
export function RichTextEditor({ value, onChange, fullHeight = false }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      MathInline,
      NoteImage,
    ],
    content: toHtml(value),
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: { attributes: { class: 'note-prose focus:outline-none' } },
  });

  const [drawing, setDrawing] = useState(false);

  if (!editor) return null;

  const cmd = (fn) => () => fn(editor.chain().focus()).run();

  return (
    <div className={`flex flex-col ${fullHeight ? 'h-full' : ''}`}>
      <div
        className="mb-2 flex flex-wrap items-center gap-1 rounded-[10px] p-1"
        style={{ background: 'var(--note-toolbar-bg)' }}
      >
        <ToolBtn active={editor.isActive('bold')} onClick={cmd((c) => c.toggleBold())} title="Bold"><b>B</b></ToolBtn>
        <ToolBtn active={editor.isActive('italic')} onClick={cmd((c) => c.toggleItalic())} title="Italic"><i>I</i></ToolBtn>
        <ToolBtn active={editor.isActive('code')} onClick={cmd((c) => c.toggleCode())} title="Inline code"><span className="font-mono">&lt;/&gt;</span></ToolBtn>
        <span className="mx-1 h-4 w-px" style={{ background: 'var(--note-border)' }} />
        <ToolBtn active={editor.isActive('heading', { level: 2 })} onClick={cmd((c) => c.toggleHeading({ level: 2 }))} title="Heading">H</ToolBtn>
        <ToolBtn active={editor.isActive('bulletList')} onClick={cmd((c) => c.toggleBulletList())} title="Bulleted list">☰ List</ToolBtn>
        <ToolBtn active={editor.isActive('orderedList')} onClick={cmd((c) => c.toggleOrderedList())} title="Numbered list">1. List</ToolBtn>
        <span className="mx-1 h-4 w-px" style={{ background: 'var(--note-border)' }} />
        <ToolBtn
          onClick={() => {
            // eslint-disable-next-line no-alert
            const latex = window.prompt('Enter LaTeX (e.g. \\frac{a}{b}, x^2 + 1):', '');
            if (latex && latex.trim()) editor.chain().focus().insertMath(latex.trim()).run();
          }}
          title="Insert math (LaTeX)"
        >
          ∑ Math
        </ToolBtn>
        <ToolBtn onClick={() => setDrawing(true)} title="Handwrite / draw">✍️ Draw</ToolBtn>
      </div>
      <div className={`note-editor ${fullHeight ? 'note-editor--full min-h-0 flex-1' : ''}`}>
        <EditorContent editor={editor} className={fullHeight ? 'h-full' : ''} />
      </div>

      {drawing && (
        <HandwritingCanvas
          onClose={() => setDrawing(false)}
          onSave={(dataUrl) => {
            editor.chain().focus().setImage({ src: dataUrl }).run();
            setDrawing(false);
          }}
        />
      )}
    </div>
  );
}

function ToolBtn({ active, onClick, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
      title={title}
      className={`note-tool ${active ? 'note-tool-active' : ''}`}
    >
      {children}
    </button>
  );
}
