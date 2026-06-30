/**
 * Client-side exports for the Learn tab — no server round-trip or storage.
 *   - Flashcard decks → CSV or TSV (TSV imports straight into Anki)
 *   - Mind maps → PNG or SVG (rendered from the on-screen <svg>)
 *   - Study guides / quiz results → the browser print dialog (Save as PDF)
 */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s) => (s || 'summit').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase();

/** Quote a CSV field if it contains a comma, quote, or newline. */
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Download a flashcard deck.
 * @param {'csv'|'tsv'} format  tsv is Anki-importable (Front, Back, Tags).
 */
export function exportDeck(cards, className, format = 'tsv') {
  if (!cards?.length) return;
  if (format === 'csv') {
    const header = ['question', 'answer', 'tags', 'difficulty'].join(',');
    const rows = cards.map((c) =>
      [c.question, c.answer, (c.tags || []).join(' '), c.difficulty].map(csvCell).join(','),
    );
    downloadBlob(new Blob([[header, ...rows].join('\n')], { type: 'text/csv' }), `${slug(className)}_deck.csv`);
  } else {
    // TSV: tabs/newlines stripped from fields so each card stays on one line (Anki rule).
    const clean = (s) => String(s ?? '').replace(/[\t\n\r]+/g, ' ').trim();
    const rows = cards.map((c) => [clean(c.question), clean(c.answer), (c.tags || []).join(' ')].join('\t'));
    downloadBlob(new Blob([rows.join('\n')], { type: 'text/tab-separated-values' }), `${slug(className)}_anki.txt`);
  }
}

/** Render an on-screen <svg> element to a PNG (or SVG) file download. */
export function exportSvg(svgEl, filename, format = 'png') {
  if (!svgEl) return;
  const clone = svgEl.cloneNode(true);
  const vb = (svgEl.getAttribute('viewBox') || '0 0 900 640').split(/\s+/).map(Number);
  const w = vb[2] || svgEl.clientWidth || 900;
  const h = vb[3] || svgEl.clientHeight || 640;
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  const svgText = new XMLSerializer().serializeToString(clone);

  if (format === 'svg') {
    downloadBlob(new Blob([svgText], { type: 'image/svg+xml' }), `${filename}.svg`);
    return;
  }

  const img = new Image();
  const svgUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  img.onload = () => {
    const scale = 2; // crisp on retina
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#fbf7f2'; // warm background to match the app
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(svgUrl);
    canvas.toBlob((blob) => blob && downloadBlob(blob, `${filename}.png`), 'image/png');
  };
  img.onerror = () => URL.revokeObjectURL(svgUrl);
  img.src = svgUrl;
}

/** Open a print window with simple HTML (user picks "Save as PDF"). */
export function printHtml(title, bodyHtml) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>${title}</title>
    <style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#1f2733;line-height:1.6}
    h1{font-size:1.6rem} h2{margin-top:1.4rem} .q{font-weight:600;margin-top:1rem}
    .correct{color:#15803d} .wrong{color:#b91c1c} hr{border:none;border-top:1px solid #e5e7eb;margin:1rem 0}</style>
    </head><body>${bodyHtml}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
}
