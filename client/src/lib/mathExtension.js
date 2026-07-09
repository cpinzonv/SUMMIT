import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';

/**
 * Inline math node for the notes editor. Stores raw LaTeX in a `data-math`
 * attribute (so it round-trips through the saved HTML) and renders it live with
 * KaTeX. Click a rendered node to edit its LaTeX. Insert via `insertMath()` or
 * the "∑" toolbar button.
 */
export const MathInline = Node.create({
  name: 'mathInline',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-math') || el.textContent || '',
        renderHTML: (attrs) => ({ 'data-math': attrs.latex }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-math]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    // Persisted form: the LaTeX lives in data-math (added by the attribute) and
    // as fallback text content, so old HTML without the extension still shows it.
    return ['span', mergeAttributes(HTMLAttributes, { class: 'math-node' }), node.attrs.latex];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('span');
      dom.className = 'math-node';
      dom.contentEditable = 'false';
      dom.title = 'Click to edit math';

      const render = (latex) => {
        try {
          dom.innerHTML = katex.renderToString(latex || '\\,', { throwOnError: false });
        } catch {
          dom.textContent = latex;
        }
      };
      render(node.attrs.latex);

      dom.addEventListener('click', (e) => {
        e.preventDefault();
        if (!editor.isEditable || typeof getPos !== 'function') return;
        // eslint-disable-next-line no-alert
        const next = window.prompt('Edit LaTeX:', node.attrs.latex);
        if (next == null) return;
        editor
          .chain()
          .focus()
          .command(({ tr }) => {
            tr.setNodeMarkup(getPos(), undefined, { latex: next });
            return true;
          })
          .run();
      });

      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== 'mathInline') return false;
          render(updated.attrs.latex);
          return true;
        },
      };
    };
  },

  addCommands() {
    return {
      insertMath:
        (latex = '') =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { latex } }),
    };
  },
});
