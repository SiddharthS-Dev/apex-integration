import crypto from 'node:crypto';
import express from 'express';
import { MEETING_EXTENSIONS, isMeetingFile, meetingFromFileName } from '@academy/shared';
import { config } from '../config.js';
import { requireAdmin } from '../auth/sessions.js';
import { objectKey, putObject } from '../files/objectStore.js';
import { streamPlaybookSource } from '../files/playbookSource.js';
import { meetingsAccount, withDropboxAccount } from '../dropbox/connection.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { entities } from '../repo/entities.js';

// Meeting transcripts uploaded by hand (Dropbox ones arrive through the sync) and the original
// file, for admins. Mounted before the JSON body parser: uploads are raw bytes.
const router = express.Router();

const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  vtt: 'text/vtt; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};
const extOf = (name) => String(name).toLowerCase().split('.').pop();

// Body = raw bytes; file name in X-File-Name (URI-encoded). Creates the Meeting (status 'uploaded');
// the client then runs processMeeting.
router.post(
  '/meetings/upload',
  requireAdmin,
  express.raw({ type: () => true, limit: `${config.maxUploadMb}mb` }),
  asyncHandler(async (req, res) => {
    const fileName = decodeURIComponent(req.get('x-file-name') || '');
    if (!fileName || !isMeetingFile(fileName)) throw badRequest(`Upload a Teams transcript: ${MEETING_EXTENSIONS.map((e) => `.${e}`).join(', ')}`);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('Empty file');
    const hash = crypto.createHash('sha256').update(req.body).digest('hex');
    const key = objectKey('upload', hash);
    await putObject(key, req.body, { source: 'upload', name: fileName, uploaded_by: req.user.id });
    const { title, date } = meetingFromFileName(fileName);
    const meeting = await entities.Meeting.create({
      title,
      meeting_date: date || undefined,
      file_url: `upload:${key}`,
      file_name: fileName,
      file_type: extOf(fileName),
      file_size: req.body.length,
      source: 'upload',
      status: 'uploaded',
    }, { userId: req.user.id });
    res.status(201).json(meeting);
  }),
);

router.get('/meetings/:id/content', requireAdmin, asyncHandler(async (req, res) => {
  const meeting = await entities.Meeting.get(req.params.id);
  if (!meeting) throw notFound('Meeting not found');
  // Streamed from Dropbox (or the object store for uploads): no copy is written to disk.
  await withDropboxAccount(meetingsAccount(), () => streamPlaybookSource(meeting, req, res, {
    contentType: MIME[meeting.file_type] || 'application/octet-stream',
    fileName: meeting.file_name || `${meeting.title}.${meeting.file_type || 'docx'}`,
    attachment: true,
  }));
}));

export default router;
