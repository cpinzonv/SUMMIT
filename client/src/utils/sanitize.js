import DOMPurify from 'dompurify';

/**
 * Sanitize an HTML string before it goes anywhere near dangerouslySetInnerHTML.
 * A defense-in-depth layer for every raw-HTML render: the Markdown renderer
 * already escapes input, and TipTap re-parses stored HTML through its schema —
 * this guarantees no active content (scripts, event handlers, javascript: URLs)
 * survives even if an upstream source is ever less strict (e.g. converted DOCX).
 *
 * Links are allowed but forced to open safely; target/rel are constrained.
 */
export function sanitizeHtml(html) {
  if (!html) return '';
  return DOMPurify.sanitize(String(html), {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'style'],
  });
}
