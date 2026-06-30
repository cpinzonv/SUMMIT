import { useMemo, useState } from 'react';
import { InlineMath, BlockMath } from 'react-katex';
import { API_URL } from '../../api/client';

/**
 * Renderers for the 4 flashcard types. Each takes { card, revealed } and shows
 * the front always; the answer/back only when `revealed`. CardFace routes by
 * card.cardType.
 */

const stripDelims = (s) => String(s || '').replace(/\$\$/g, '').replace(/\\\(|\\\)|\\\[|\\\]/g, '').trim();

/** Render text that may contain inline $...$ or $$...$$ math, mixed with prose. */
function RichText({ text }) {
  const parts = useMemo(() => splitMath(String(text || '')), [text]);
  return (
    <span>
      {parts.map((p, i) =>
        p.math ? <InlineMath key={i} math={p.value} /> : <span key={i}>{p.value}</span>,
      )}
    </span>
  );
}

function splitMath(text) {
  const out = [];
  const re = /\$\$([^$]+)\$\$|\$([^$]+)\$/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ math: false, value: text.slice(last, m.index) });
    out.push({ math: true, value: (m[1] || m[2]).trim() });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ math: false, value: text.slice(last) });
  return out.length ? out : [{ math: false, value: text }];
}

/** Parse "text {{c1::hidden}} more" into ordered parts. */
export function parseCloze(text) {
  const re = /\{\{c\d+::(.+?)\}\}/g;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ isCloze: false, text: text.slice(last, m.index) });
    parts.push({ isCloze: true, text: m[1] });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ isCloze: false, text: text.slice(last) });
  return parts;
}

function BasicCard({ card, revealed }) {
  return (
    <div>
      <p className="text-xl font-semibold text-ink sm:text-lg">{card.question}</p>
      {revealed && (
        <div className="mt-3 border-t border-white/50 pt-3">
          <p className="text-lg text-ink sm:text-base">{card.answer}</p>
          {card.explanation && <p className="mt-2 text-sm text-muted">{card.explanation}</p>}
        </div>
      )}
    </div>
  );
}

function ClozeCard({ card, revealed }) {
  const parts = useMemo(() => parseCloze(card.question), [card.question]);
  return (
    <div>
      <p className="text-xl font-semibold leading-relaxed text-ink sm:text-lg">
        {parts.map((p, i) =>
          p.isCloze ? (
            <span key={i} className={revealed ? 'rounded bg-teal-400/20 px-1 font-bold text-teal-700' : 'font-bold text-brand-600'}>
              {revealed ? p.text : '[    ]'}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </p>
      {revealed && card.explanation && <p className="mt-3 border-t border-white/50 pt-3 text-sm text-muted">{card.explanation}</p>}
    </div>
  );
}

function MathCard({ card, revealed }) {
  return (
    <div>
      <div className="text-lg text-ink">
        <BlockMath math={stripDelims(card.question)} />
      </div>
      {revealed && (
        <div className="mt-3 border-t border-white/50 pt-3">
          <div className="text-ink"><BlockMath math={stripDelims(card.latexContent || card.answer)} /></div>
          {card.explanation && <p className="mt-2 text-sm text-muted"><RichText text={card.explanation} /></p>}
        </div>
      )}
    </div>
  );
}

function ImageOcclusionCard({ card, revealed }) {
  const [shown, setShown] = useState({});
  const shapes = Array.isArray(card.occlusionShapes) ? card.occlusionShapes : [];
  if (!card.imageUrl) {
    // No image uploaded yet — show the generation prompt as guidance.
    return (
      <div className="text-center">
        <p className="text-lg font-semibold text-ink">{card.question}</p>
        <p className="mt-2 text-sm text-muted">Image occlusion card — upload an image to study this one.</p>
      </div>
    );
  }
  const src = card.imageUrl.startsWith('http') ? card.imageUrl : `${API_URL}${card.imageUrl}`;
  return (
    <div className="relative inline-block">
      <img src={src} alt="Study" className="max-h-80 rounded-lg" />
      <svg className="absolute inset-0 h-full w-full">
        {shapes.map((s) => (
          <g key={s.id} onClick={() => setShown((v) => ({ ...v, [s.id]: true }))} style={{ cursor: 'pointer' }}>
            {(!shown[s.id] && !revealed) ? (
              <rect x={s.x} y={s.y} width={s.width} height={s.height} fill="rgba(27,76,92,0.85)" rx="3" />
            ) : (
              <text x={s.x + s.width / 2} y={s.y + s.height / 2} textAnchor="middle" dominantBaseline="central" fill="#1B4C5C" fontSize="13" fontWeight="600">{s.label}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

export function CardFace({ card, revealed }) {
  switch (card.cardType) {
    case 'cloze': return <ClozeCard card={card} revealed={revealed} />;
    case 'math': return <MathCard card={card} revealed={revealed} />;
    case 'image': return <ImageOcclusionCard card={card} revealed={revealed} />;
    default: return <BasicCard card={card} revealed={revealed} />;
  }
}

/** Small label chip for a card's type (used in the management grid). */
export function CardTypeBadge({ type }) {
  const meta = {
    basic: { label: 'Basic', cls: 'bg-slate-400/15 text-slate-500' },
    cloze: { label: 'Cloze', cls: 'bg-teal-400/15 text-teal-600' },
    math: { label: 'Math', cls: 'bg-violet-400/15 text-violet-600' },
    image: { label: 'Image', cls: 'bg-amber-400/15 text-amber-600' },
  }[type] || { label: type, cls: 'bg-slate-400/15 text-slate-500' };
  if (type === 'basic') return null;
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.cls}`}>{meta.label}</span>;
}
