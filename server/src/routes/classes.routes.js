import { Router } from 'express';
import multer from 'multer';
import { AppError } from '../utils/AppError.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as classes from '../controllers/classes.controller.js';
import * as assignments from '../controllers/assignments.controller.js';
import * as syllabus from '../controllers/syllabus.controller.js';
import * as notes from '../controllers/notes.controller.js';
import * as attendance from '../controllers/attendance.controller.js';
import * as files from '../controllers/files.controller.js';
import * as grades from '../controllers/grades.controller.js';
import * as transcripts from '../controllers/transcripts.controller.js';

// Syllabus uploads: PDF, DOCX (Word), JPG, PNG. Kept in memory; 32MB cap
// (the Claude API request limit).
const SYLLABUS_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 32 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (SYLLABUS_MIME.has(file.mimetype)) cb(null, true);
    else cb(AppError.badRequest('Unsupported file type. Upload a PDF, DOCX, JPG, or PNG.'));
  },
});

// Class file attachments: a broader set than syllabus uploads (PDF, Office docs,
// images, plain text). Stored inline as base64, so cap a little smaller (16MB).
const FILE_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'text/plain',
  'text/csv',
]);
const fileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (FILE_MIME.has(file.mimetype)) cb(null, true);
    else cb(AppError.badRequest('Unsupported file type. Upload a PDF, Office doc, image, or text file.'));
  },
});

// Lecture-recording audio uploads (WebM/WAV/MP4/OGG), kept in memory; 40MB cap.
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^audio\//.test(file.mimetype) || file.mimetype === 'video/webm') cb(null, true);
    else cb(AppError.badRequest('Unsupported audio type.'));
  },
});

const router = Router();

// Every class route requires authentication; handlers scope to req.user.id.
router.use(requireAuth);

// Extract structured data from a syllabus PDF (Claude). Defined before the
// "/:id" routes so the literal path matches first.
router.post(
  '/extract-syllabus',
  upload.single('file'),
  asyncHandler(syllabus.extractSyllabus),
);

// Archive all classes whose end_date has passed (called on dashboard load).
router.post('/auto-archive', asyncHandler(classes.autoArchive));

router.post('/', validate(classes.createClassSchema), asyncHandler(classes.create));
router.get('/', asyncHandler(classes.list));

router.patch(
  '/:id',
  validate(classes.classIdParam, 'params'),
  validate(classes.updateClassSchema),
  asyncHandler(classes.update),
);

router.delete(
  '/:id',
  validate(classes.classIdParam, 'params'),
  asyncHandler(classes.remove),
);

router.put(
  '/:id/archive',
  validate(classes.classIdParam, 'params'),
  asyncHandler(classes.archive),
);

// Manually link a class to one LMS platform + that platform's course id/URL.
router.post(
  '/:id/link-lms',
  validate(classes.classIdParam, 'params'),
  validate(classes.linkLmsSchema),
  asyncHandler(classes.linkLms),
);

// Assignments nested under a class.
router.post(
  '/:id/assignments',
  validate(classes.classIdParam, 'params'),
  validate(assignments.createAssignmentSchema),
  asyncHandler(assignments.create),
);
router.get(
  '/:id/assignments',
  validate(classes.classIdParam, 'params'),
  asyncHandler(assignments.list),
);

// Notes nested under a class (update/delete by note id live in notes.routes).
router.get(
  '/:id/notes',
  validate(classes.classIdParam, 'params'),
  validate(notes.listQuery, 'query'),
  asyncHandler(notes.list),
);
router.post(
  '/:id/notes',
  validate(classes.classIdParam, 'params'),
  validate(notes.createNoteSchema),
  asyncHandler(notes.create),
);

// Ask Claude a question grounded in this class's notes.
router.post(
  '/:id/notes-chatbot',
  validate(classes.classIdParam, 'params'),
  validate(notes.chatbotSchema),
  asyncHandler(notes.chatbot),
);

// "What if?" grade simulation for a class.
router.post(
  '/:id/grade-simulation',
  validate(classes.classIdParam, 'params'),
  validate(grades.gradeSimSchema),
  asyncHandler(grades.simulate),
);

// Files nested under a class (download/delete by file id live in files.routes).
router.get(
  '/:id/files',
  validate(classes.classIdParam, 'params'),
  asyncHandler(files.list),
);
router.post(
  '/:id/files',
  validate(classes.classIdParam, 'params'),
  fileUpload.single('file'),
  asyncHandler(files.upload),
);

// Transcripts nested under a class (update/delete by id live in transcripts.routes).
router.get(
  '/:id/transcripts',
  validate(classes.classIdParam, 'params'),
  validate(transcripts.listQuery, 'query'),
  asyncHandler(transcripts.list),
);
router.post(
  '/:id/transcripts',
  validate(classes.classIdParam, 'params'),
  validate(transcripts.createSchema),
  asyncHandler(transcripts.create),
);
router.post(
  '/:id/transcripts/record',
  validate(classes.classIdParam, 'params'),
  audioUpload.single('audio'),
  asyncHandler(transcripts.record),
);

// Attendance nested under a class (delete by id lives in attendance.routes).
router.get(
  '/:id/attendance',
  validate(classes.classIdParam, 'params'),
  asyncHandler(attendance.list),
);
router.post(
  '/:id/attendance',
  validate(classes.classIdParam, 'params'),
  validate(attendance.markSchema),
  asyncHandler(attendance.mark),
);

export default router;
