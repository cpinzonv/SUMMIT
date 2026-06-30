// A tiny, XSS-safe Markdown → HTML renderer for the notes editor.
// HTML is escaped FIRST, then a small set of formatting transforms is applied,
// so no user-supplied markup can reach the DOM. Supports headings, bold,
// italic, inline code, bulleted/numbered lists, and safe links.

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => {
      const safe = /^(https?:\/\/|\/)/i.test(url.trim()) ? url.trim() : '#';
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });
}

export function renderMarkdown(md) {
  if (!md) return '';
  const lines = escapeHtml(md).split(/\r?\n/);
  const out = [];
  let list = null; // 'ul' | 'ol' | null
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };

  for (const line of lines) {
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length, 6);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (list !== 'ul') {
        closeList();
        out.push('<ul>');
        list = 'ul';
      }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
    } else if (/^\s*\d+\.\s+/.test(line)) {
      if (list !== 'ol') {
        closeList();
        out.push('<ol>');
        list = 'ol';
      }
      out.push(`<li>${inline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`);
    } else if (/^\s*$/.test(line)) {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}
