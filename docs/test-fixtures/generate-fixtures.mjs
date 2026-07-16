/**
 * ============================================================================
 * Summit — TRIAL upload fixtures generator
 * ----------------------------------------------------------------------------
 * Regenerates the fake upload files Carolina uses to exercise the AI EXTRACTION
 * flows through the UI (these can't be seeded — they go in as real uploads):
 *
 *   syllabus-clean.pdf        clean, well-structured syllabus  → Class syllabus import
 *   syllabus-messy.pdf        messy syllabus (mixed date formats, buried schedule)
 *   sections-listing.txt      registration-portal section dump → Semester Plan Builder (paste)
 *   sections-listing.png      the same dump as an ugly "screenshot" (image upload)
 *   degree-requirements.pdf   degree-audit sheet, prose prereqs → Degree Requirements import
 *
 * Everything is generated with the Node standard library ONLY (no pdfkit / canvas
 * / pngjs): a tiny text-based PDF writer (standard Type-1 fonts, so the text is
 * selectable/extractable) and a self-contained PNG encoder (zlib + a 5x7 bitmap
 * font). Fully portable — runs the same on macOS and Linux.
 *
 *   node docs/test-fixtures/generate-fixtures.mjs
 *
 * All names/courses are obviously fake. Do not treat as real course data.
 * ============================================================================
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import zlib from 'node:zlib';

const OUT_DIR = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Minimal text-based PDF writer (US-Letter, standard fonts, extractable text).
// ============================================================================
const PAGE_W = 612, PAGE_H = 792, ML = 64, MR = 64, MT = 742, MB = 60;
const USABLE_W = PAGE_W - ML - MR;
const pdfEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
// Avg glyph width factor (Helvetica ~0.5, Courier 0.6) for word-wrapping.
const charWidth = (size, mono) => size * (mono ? 0.6 : 0.5);

function wrapText(text, size, mono) {
  const max = Math.max(8, Math.floor(USABLE_W / charWidth(size, mono)));
  const out = [];
  for (const para of String(text).split('\n')) {
    if (para.length <= max) { out.push(para); continue; }
    let line = '';
    for (const word of para.split(' ')) {
      if ((line + (line ? ' ' : '') + word).length > max) {
        if (line) out.push(line);
        line = word;
      } else line += (line ? ' ' : '') + word;
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * Render a block document to a PDF Buffer.
 * blocks: [{ kind, text }] where kind ∈ h1 | h2 | p | bullet | pre | space | rule
 *   pre = preformatted monospaced line (tables); rendered as-is (no wrap).
 */
function buildPdf(blocks) {
  const pages = [];
  let ops = [];
  let y = MT;
  const flush = () => { pages.push(ops.join('\n')); ops = []; y = MT; };
  const emitLine = (text, size, font) => {
    if (y < MB) flush();
    ops.push(`BT /${font} ${size} Tf ${ML} ${y.toFixed(1)} Td (${pdfEsc(text)}) Tj ET`);
    y -= size * 1.42;
  };
  for (const b of blocks) {
    if (b.kind === 'space') { y -= 8; continue; }
    if (b.kind === 'rule') {
      if (y < MB) flush();
      ops.push(`${ML} ${(y + 6).toFixed(1)} m ${PAGE_W - MR} ${(y + 6).toFixed(1)} l 0.7 w 0.4 0.4 0.4 RG S`);
      y -= 12; continue;
    }
    const mono = b.kind === 'pre';
    const size = b.kind === 'h1' ? 18 : b.kind === 'h2' ? 13 : b.kind === 'pre' ? 9 : 10.5;
    const font = b.kind === 'h1' || b.kind === 'h2' ? 'F2' : mono ? 'F3' : 'F1';
    const prefix = b.kind === 'bullet' ? '  •  '.replace('•', '-') : '';
    if (mono) {
      for (const ln of String(b.text).split('\n')) emitLine(ln, size, font);
    } else {
      for (const ln of wrapText(prefix + (b.text ?? ''), size, mono)) emitLine(ln, size, font);
    }
    if (b.kind === 'h1') y -= 6;
    if (b.kind === 'h2') y -= 3;
  }
  flush();

  // Assemble objects. 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold,
  // 5 Courier; then page/content object pairs from 6.
  const objs = {};
  objs[1] = '<</Type/Catalog/Pages 2 0 R>>';
  objs[3] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>';
  objs[4] = '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold>>';
  objs[5] = '<</Type/Font/Subtype/Type1/BaseFont/Courier>>';
  const kids = [];
  pages.forEach((content, i) => {
    const pageObj = 6 + i * 2;
    const contentObj = 7 + i * 2;
    kids.push(`${pageObj} 0 R`);
    objs[pageObj] =
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PAGE_W} ${PAGE_H}]` +
      `/Resources<</Font<</F1 3 0 R/F2 4 0 R/F3 5 0 R>>>>/Contents ${contentObj} 0 R>>`;
    objs[contentObj] = `<</Length ${Buffer.byteLength(content)}>>\nstream\n${content}\nendstream`;
  });
  objs[2] = `<</Type/Pages/Kids[${kids.join(' ')}]/Count ${pages.length}>>`;

  const maxObj = 5 + pages.length * 2;
  let pdf = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = [];
  for (let n = 1; n <= maxObj; n++) {
    offsets[n] = Buffer.byteLength(pdf);
    pdf += `${n} 0 obj\n${objs[n]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= maxObj; n++) {
    pdf += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<</Size ${maxObj + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// ============================================================================
// Self-contained PNG encoder (zlib) + 5x7 bitmap font (ASCII, uppercase set).
// ============================================================================
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
/** Encode an RGB pixel buffer (width*height*3) to a PNG Buffer. */
function encodePng(width, height, rgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // color type: truecolor RGB
  // Prepend a 0 filter byte to each scanline.
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let yy = 0; yy < height; yy++) {
    raw[yy * (stride + 1)] = 0;
    rgb.copy(raw, yy * (stride + 1) + 1, yy * stride, yy * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

// 5-wide x 7-tall glyphs. '#' = ink. Only the chars a registration dump needs.
const FONT = {
  'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'B': ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  'C': ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  'D': ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  'G': ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.####'],
  'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  'I': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  'J': ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
  'K': ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  'N': ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  'Q': ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  'S': ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  'T': ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  'U': ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  'W': ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  'X': ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  'Y': ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  'Z': ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  ':': ['.....', '..#..', '..#..', '.....', '..#..', '..#..', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '..#..', '..#..'],
  ',': ['.....', '.....', '.....', '.....', '..#..', '..#..', '.#...'],
  '(': ['..##.', '.#...', '#....', '#....', '#....', '.#...', '..##.'],
  ')': ['.##..', '...#.', '....#', '....#', '....#', '...#.', '.##..'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
};
const glyphFor = (ch) => FONT[ch] || FONT[ch?.toUpperCase?.()] || FONT[' '];

/** Render monospaced uppercase lines to a PNG buffer that reads as a portal screenshot. */
function renderTextPng(lines, { scale = 4, padX = 28, padY = 26, lineGap = 5, header = null } = {}) {
  const CW = 5, CH = 7, GAP = 1;
  const cols = Math.max(...lines.map((l) => l.length), header ? header.length : 0);
  const cellW = (CW + GAP) * scale;
  const lineH = (CH + lineGap) * scale;
  const headerH = header ? lineH + 8 * scale : 0;
  const width = padX * 2 + cols * cellW;
  const height = padY * 2 + headerH + lines.length * lineH;
  const bg = [244, 243, 240], fg = [26, 28, 34], hbar = [47, 159, 168], hfg = [255, 255, 255];
  const rgb = Buffer.alloc(width * height * 3);
  // fill background
  for (let i = 0; i < width * height; i++) { rgb[i * 3] = bg[0]; rgb[i * 3 + 1] = bg[1]; rgb[i * 3 + 2] = bg[2]; }
  const put = (x, y, col) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 3; rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2];
  };
  const drawText = (text, x0, y0, col) => {
    for (let ci = 0; ci < text.length; ci++) {
      const g = glyphFor(text[ci]);
      const gx = x0 + ci * cellW;
      for (let r = 0; r < CH; r++) for (let c = 0; c < CW; c++) {
        if (g[r][c] === '#') for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(gx + c * scale + sx, y0 + r * scale + sy, col);
      }
    }
  };
  let y = padY;
  if (header) {
    for (let yy = 0; yy < lineH + 6 * scale; yy++) for (let xx = 0; xx < width; xx++) put(xx, padY + yy - 4 * scale, hbar);
    drawText(header, padX, y, hfg);
    y += headerH;
  }
  for (const ln of lines) { drawText(ln, padX, y, fg); y += lineH; }
  return encodePng(width, height, rgb);
}

// ============================================================================
// Fixture content
// ============================================================================

// ---- 1) Clean, well-structured syllabus ------------------------------------
const cleanSyllabus = [
  { kind: 'h1', text: 'ASTR 210 - Introduction to Astrophysics' },
  { kind: 'p', text: 'Northgate University - Department of Physics & Astronomy - Fall 2026' },
  { kind: 'rule' },
  { kind: 'h2', text: 'Course Information' },
  { kind: 'p', text: 'Instructor: Dr. Helen Vasquez' },
  { kind: 'p', text: 'Email: hvasquez@northgate.edu' },
  { kind: 'p', text: 'Office: Science Hall 314, Tue/Thu 3:00-4:30 PM' },
  { kind: 'p', text: 'Credits: 4' },
  { kind: 'p', text: 'Term dates: 2026-08-24 to 2026-12-11' },
  { kind: 'space' },
  { kind: 'h2', text: 'Meeting Times' },
  { kind: 'p', text: 'Lecture: Monday, Wednesday, Friday, 10:00-10:50 AM, Science Hall 120' },
  { kind: 'p', text: 'Lab: Thursday, 2:00-4:00 PM, Observatory Annex' },
  { kind: 'space' },
  { kind: 'h2', text: 'Grading' },
  { kind: 'pre', text: 'Component            Weight' },
  { kind: 'pre', text: '-------------------  ------' },
  { kind: 'pre', text: 'Problem Sets          25%' },
  { kind: 'pre', text: 'Labs                  20%' },
  { kind: 'pre', text: 'Midterm Exam          25%' },
  { kind: 'pre', text: 'Final Exam            30%' },
  { kind: 'space' },
  { kind: 'h2', text: 'Assignment Schedule' },
  { kind: 'bullet', text: 'Problem Set 1 - due 2026-09-07 (100 pts)' },
  { kind: 'bullet', text: 'Lab Report 1 - due 2026-09-17 (50 pts)' },
  { kind: 'bullet', text: 'Problem Set 2 - due 2026-09-28 (100 pts)' },
  { kind: 'bullet', text: 'Midterm Exam - due 2026-10-14 (150 pts)' },
  { kind: 'bullet', text: 'Problem Set 3 - due 2026-10-30 (100 pts)' },
  { kind: 'bullet', text: 'Lab Report 2 - due 2026-11-13 (50 pts)' },
  { kind: 'bullet', text: 'Final Project - due 2026-12-05 (200 pts)' },
  { kind: 'bullet', text: 'Final Exam - due 2026-12-11 (200 pts)' },
];

// ---- 2) Messy syllabus (mixed date formats, grading + schedule in prose) ----
const messySyllabus = [
  { kind: 'h1', text: 'The Atlantic World, 1450-1850' },
  { kind: 'p', text: 'HIST 247 (sec 002) // Prof. R. Achebe // achebe@example-college.edu // Fall term' },
  { kind: 'p', text: 'We meet Tuesdays and Thursdays, 1:15 til 2:30ish, in Harmon Hall rm 8. Occasional Friday film screenings (optional) at 4pm.' },
  { kind: 'space' },
  { kind: 'p', text: 'A note on grades: your grade is mostly the two papers (the first one is worth 20 percent, the longer research paper counts for a full third of the grade). Participation is another 15%. There are also weekly reading responses which together make up 15 percent, and a take-home final that covers the rest.' },
  { kind: 'space' },
  { kind: 'p', text: 'Some tables never survive a copy-paste. Here is what I could recover:' },
  { kind: 'pre', text: 'Paper 1 ....... 20' },
  { kind: 'pre', text: 'Research paper . 33' },
  { kind: 'pre', text: 'Participation .. 15' },
  { kind: 'space' },
  { kind: 'p', text: 'Schedule (subject to change, and it will change): The first paper is due Sept 26. We do NOT meet the week of Oct 13 (fall break). The research paper proposal is due the Monday after break, i.e. 10/19, with the final research paper due December 4th. Reading responses are due most Fridays. The take-home final goes out on the last day of class and is due 12/15/2026 by midnight.' },
  { kind: 'space' },
  { kind: 'p', text: 'Readings: see the course reader. Week 1 is the intro; by the third week we are into the sugar economy. Midterm-ish check-in (ungraded) sometime around the second Friday of October.' },
];

// ---- 3) Registration portal section listing (txt + png) --------------------
// Fixed-width columns; deliberately ugly. Uppercase, like a legacy SIS.
const SECTION_ROWS = [
  'CRN    SUBJ CRSE SEC  TITLE                    DAYS  TIME         INSTRUCTOR   ROOM       SEATS',
  '-----  ---- ---- ---  -----------------------  ----  -----------  -----------  ---------  -----',
  '20481  MATH 212  001  LINEAR ALGEBRA           MWF   0900-0950    REYES        CUDAHY118  12/30',
  '20482  MATH 212  002  LINEAR ALGEBRA           TR    1100-1215    IVANOVA      CUDAHY210   3/30',
  '20483  MATH 212  003  LINEAR ALGEBRA           MWF   1300-1350    REYES        CUDAHY118   0/30',
  '21140  DATA 212  001  MACHINE LEARNING         TR    1430-1545    OKAFOR       DOYLE305   18/25',
  '21141  DATA 212  002  MACHINE LEARNING         MW    1500-1615    OKAFOR       DOYLE305    9/25',
  '21142  DATA 212  003  MACHINE LEARNING         F     1000-1245    BHATT        DOYLE120   22/25',
  '21143  DATA 212  004  MACHINE LEARNING (ONL)   TBA   TBA          STAFF        ONLINE      5/40',
  '30655  STAT 308  001  STATISTICAL MODELING     MWF   1100-1150    HOFFMANN     IES104     14/35',
  '30656  STAT 308  002  STATISTICAL MODELING     TR    0930-1045    HOFFMANN     IES104     30/35',
  '30657  STAT 308  003  STATISTICAL MODELING     TR    1600-1715    NWOSU        IES220      1/35',
  '40122  PHIL 201  001  ETHICS                   MWF   1000-1050    FELD         CROWN105   10/40',
  '40123  PHIL 201  002  ETHICS                   MWF   1000-1050    FELD         CROWN107    4/40',
  '41988  HIST 210  001  MODERN EUROPE            MWF   1000-1050    SALIB        CROWN210   25/45',
  '41989  HIST 210  002  MODERN EUROPE            MWF   1000-1050    SALIB        CROWN212   11/45',
  '52310  BIOL 240  001  GENETICS                 TR    1330-1445    ORTEGA       QUINLAN14   7/32',
  '52311  BIOL 240  L01  GENETICS LAB             W     1400-1650    STAFF        QUINLAN12  ARR/16',
];

// ---- 4) Degree requirements sheet (prose prereqs, offered-term notes) -------
const degreeSheet = [
  { kind: 'h1', text: 'B.A. Environmental Studies - Degree Audit Worksheet' },
  { kind: 'p', text: 'Riverside State University - College of Arts & Sciences - Catalog Year 2025-2026' },
  { kind: 'p', text: 'Total credits required: 120. Minimum 40 credits at the 300-level or above.' },
  { kind: 'rule' },
  { kind: 'h2', text: 'I. Environmental Core (28 credits)' },
  { kind: 'bullet', text: 'ENVS 101 - Foundations of Environmental Studies (3)' },
  { kind: 'bullet', text: 'ENVS 210 - Ecology & Society (3). Prerequisite: ENVS 101.' },
  { kind: 'bullet', text: 'ENVS 215 - Environmental Data Methods (4). Prerequisite: ENVS 101 and MATH 118 or placement.' },
  { kind: 'bullet', text: 'ENVS 320 - Field Methods (4). Prerequisite: ENVS 215. Offered fall only.' },
  { kind: 'bullet', text: 'ENVS 340 - Environmental Policy (3). Prerequisite: ENVS 210.' },
  { kind: 'bullet', text: 'ENVS 410 - Capstone Seminar (3). Prerequisite: ENVS 320 and senior standing. Offered spring only.' },
  { kind: 'space' },
  { kind: 'h2', text: 'II. Natural Sciences (16 credits)' },
  { kind: 'bullet', text: 'BIOL 115 - General Biology I (4)' },
  { kind: 'bullet', text: 'CHEM 105 - Chemistry & the Environment (4)' },
  { kind: 'bullet', text: 'GEOL 130 - Earth Systems (4). Offered fall and summer.' },
  { kind: 'bullet', text: 'BIOL 240 - Genetics (4). Prerequisite: BIOL 115.' },
  { kind: 'space' },
  { kind: 'h2', text: 'III. Quantitative Reasoning (9-10 credits)' },
  { kind: 'bullet', text: 'MATH 118 - Precalculus (4) OR placement exam.' },
  { kind: 'bullet', text: 'STAT 203 - Statistics for the Sciences (3). Prerequisite: MATH 118 or placement.' },
  { kind: 'bullet', text: 'One additional GIS or data course - see advisor.' },
  { kind: 'space' },
  { kind: 'h2', text: 'IV. Environmental Electives - choose 4 (12 credits)' },
  { kind: 'p', text: 'Any four of: ENVS 305 Conservation Biology, ENVS 312 Climate Science, ENVS 330 Environmental Justice, ENVS 355 Sustainable Agriculture, ENVS 360 Water Resources, GEOG 240 Cartography, POLS 270 Global Environmental Politics, ECON 245 Environmental Economics.' },
  { kind: 'space' },
  { kind: 'h2', text: 'V. General Education (approx 45 credits)' },
  { kind: 'p', text: 'Fulfills the university core. No specific course list here - 9 credits must be humanities at the 300-level or above. See the university catalog for the full distribution.' },
  { kind: 'space' },
  { kind: 'p', text: 'Transfer/AP note: student has AP credit for ENGL 101 and transfer credit for MATH 118 on file.' },
];

// ============================================================================
// Write everything
// ============================================================================
function main() {
  const write = (name, buf) => { writeFileSync(join(OUT_DIR, name), buf); console.log(`  wrote ${name} (${buf.length} bytes)`); };

  console.log('Generating trial upload fixtures:');
  write('syllabus-clean.pdf', buildPdf(cleanSyllabus));
  write('syllabus-messy.pdf', buildPdf(messySyllabus));
  write('degree-requirements.pdf', buildPdf(degreeSheet));
  write('sections-listing.txt', Buffer.from(SECTION_ROWS.join('\n') + '\n', 'utf8'));
  write('sections-listing.png', renderTextPng(SECTION_ROWS, { header: 'LUCPORTAL - LOOKUP CLASS SECTIONS - FALL 2026' }));
  console.log('Done.');
}

main();
