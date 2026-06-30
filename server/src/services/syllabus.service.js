import Anthropic from '@anthropic-ai/sdk';
import mammoth from 'mammoth';
import { env } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

let client;

function getClient() {
  if (!env.anthropicApiKey) {
    throw new AppError(
      503,
      'Syllabus extraction is not configured. Set ANTHROPIC_API_KEY in the server environment.',
    );
  }
  if (!client) client = new Anthropic({ apiKey: env.anthropicApiKey });
  return client;
}

// JSON Schema for structured outputs. Optional fields use null-unions; every
// property is listed in `required` (structured outputs enforce the schema
// strictly). Note: structured outputs reject open-ended maps, so the grading
// breakdown is extracted as an array of {category, weight} and folded into an
// object before returning.
const syllabusSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    courseName: { type: ['string', 'null'], description: 'Full course title' },
    courseCode: { type: ['string', 'null'], description: 'e.g. "CS 101"' },
    instructor: { type: ['string', 'null'] },
    termStart: { type: ['string', 'null'], description: 'Term start date, YYYY-MM-DD' },
    termEnd: { type: ['string', 'null'], description: 'Term end date, YYYY-MM-DD' },
    attendanceRequired: {
      type: 'boolean',
      description: 'True if attendance is graded or mandatory',
    },
    attendanceGraded: {
      type: 'boolean',
      description: 'True if the syllabus states attendance/participation is worth a percentage of the grade',
    },
    attendanceWeight: {
      type: ['number', 'null'],
      description: 'The percentage of the final grade attendance is worth (0-100), or null if not stated',
    },
    assignmentNames: {
      type: 'array',
      items: { type: 'string' },
      description: 'Names of every assignment, exam, project, or quiz found',
    },
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          dueDate: { type: ['string', 'null'], description: 'YYYY-MM-DD or null if unknown' },
          pointValue: { type: ['number', 'null'], description: 'Points/percent, or null' },
        },
        required: ['name', 'dueDate', 'pointValue'],
      },
    },
    gradingBreakdown: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string', description: 'e.g. "Assignments", "Exams"' },
          weight: { type: 'number', description: 'Percentage 0-100' },
        },
        required: ['category', 'weight'],
      },
    },
  },
  required: [
    'courseName',
    'courseCode',
    'instructor',
    'termStart',
    'termEnd',
    'attendanceRequired',
    'attendanceGraded',
    'attendanceWeight',
    'assignmentNames',
    'assignments',
    'gradingBreakdown',
  ],
};

const PROMPT = `You are extracting structured data from a course syllabus PDF.
Read the document carefully and populate the schema:
- Dates must be ISO format YYYY-MM-DD. If a year is not stated, infer it from the term. Use null if a date is genuinely unknown.
- assignments: every graded item (homework, problem sets, projects, quizzes, exams, the final). Include due dates and point/percentage values when stated, else null.
- assignmentNames: just the names of those items.
- gradingBreakdown: the weighting of each grade category as a percentage (weights should sum to ~100).
- attendanceRequired: true if attendance/participation is graded or mandatory.
- attendanceGraded / attendanceWeight: if the syllabus says attendance or participation is worth
  a percentage of the grade (e.g. "Attendance: 10%"), set attendanceGraded true and attendanceWeight
  to that number (10). Otherwise attendanceGraded false and attendanceWeight null.
Use null for any field the syllabus does not specify. Do not invent data.`;

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Build the user content blocks for a syllabus upload, per file type:
 *   - PDF        → a document block (Claude reads the PDF natively)
 *   - JPG / PNG  → an image block (Claude vision reads the image)
 *   - DOCX       → text is extracted with mammoth and sent as a text block
 * The instruction prompt always comes last.
 */
async function buildContent(file) {
  const { buffer, mimetype } = file;

  if (mimetype === 'application/pdf') {
    return [
      {
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
      },
      { type: 'text', text: PROMPT },
    ];
  }

  if (mimetype === 'image/jpeg' || mimetype === 'image/png') {
    return [
      {
        type: 'image',
        source: { type: 'base64', media_type: mimetype, data: buffer.toString('base64') },
      },
      { type: 'text', text: PROMPT },
    ];
  }

  if (mimetype === DOCX_MIME) {
    let text;
    try {
      ({ value: text } = await mammoth.extractRawText({ buffer }));
    } catch {
      throw AppError.badRequest('Could not read the Word document.');
    }
    if (!text || !text.trim()) {
      throw AppError.badRequest('The Word document appears to be empty.');
    }
    return [{ type: 'text', text: `${PROMPT}\n\nSyllabus text:\n"""\n${text}\n"""` }];
  }

  throw AppError.badRequest('Unsupported file type.');
}

/**
 * Send a syllabus (PDF, DOCX, JPG, or PNG) to Claude and return structured
 * course data. DOCX text is extracted first; images and PDFs are sent directly.
 * @param {{ buffer: Buffer, mimetype: string }} file
 */
export async function extractSyllabus(file) {
  const content = await buildContent(file);

  let message;
  try {
    message = await getClient().messages.create({
      model: env.anthropicModel,
      max_tokens: 4096,
      // Structured outputs: constrain the response to our JSON schema.
      output_config: { format: { type: 'json_schema', schema: syllabusSchema } },
      messages: [{ role: 'user', content }],
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err?.status === 401) {
      throw new AppError(503, 'Claude API key is invalid. Check ANTHROPIC_API_KEY.');
    }
    throw new AppError(502, `Syllabus extraction failed: ${err?.message || 'unknown error'}`);
  }

  if (message.stop_reason === 'refusal') {
    throw AppError.badRequest('The model declined to process this document.');
  }

  const text = message.content.find((b) => b.type === 'text')?.text ?? '';
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AppError(502, 'Could not parse the extraction result as JSON.');
  }

  return normalize(data);
}

/** Shape the model output into the API response (grading breakdown as an object). */
function normalize(data) {
  const assignments = Array.isArray(data.assignments) ? data.assignments : [];
  const breakdown = {};
  for (const row of data.gradingBreakdown || []) {
    if (row && row.category) breakdown[row.category] = row.weight;
  }
  const names =
    Array.isArray(data.assignmentNames) && data.assignmentNames.length
      ? data.assignmentNames
      : assignments.map((a) => a.name);

  return {
    courseName: data.courseName ?? null,
    courseCode: data.courseCode ?? null,
    instructor: data.instructor ?? null,
    termStart: data.termStart ?? null,
    termEnd: data.termEnd ?? null,
    attendanceRequired: Boolean(data.attendanceRequired),
    attendanceGraded: Boolean(data.attendanceGraded),
    attendanceWeight: data.attendanceWeight ?? null,
    assignmentNames: names,
    assignments,
    gradingBreakdown: breakdown,
  };
}
