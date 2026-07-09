import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Minimal block image node for the notes editor — enough to insert a handwritten
 * drawing (a PNG data URL) and have it round-trip through the saved note HTML.
 * No external @tiptap/extension-image dependency.
 */
export const NoteImage = Node.create({
  name: 'image',
  group: 'block',
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: 'Handwritten note' },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { class: 'note-image' })];
  },

  addCommands() {
    return {
      setImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
