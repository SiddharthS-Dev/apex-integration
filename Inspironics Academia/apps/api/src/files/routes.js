import crypto from 'node:crypto';
import express from 'express';
import { fileExtension, isPlaybookFile } from '@academy/shared';
import { config } from '../config.js';
import { requireAdmin, requireUser } from '../auth/sessions.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { entities } from '../repo/entities.js';
import { objectKey, objectMeta, objectStream, putObject } from './objectStore.js';
import { contentTypeFor, loadPlaybookBytes } from './playbookSource.js';

const router = express.Router();

// Upload a playbook file. Body = raw bytes; filename in X-File-Name (URI-encoded).
// Returns { file_uri: 'upload:<key>', size, file_name, file_type } for Playbook.file_url.
router.post(
  '/files',
  requireAdmin,
  express.raw({ type: () => true, limit: `${config.maxUploadMb}mb` }),
  asyncHandler(async (req, res) => {
    const fileName = decodeURIComponent(req.get('x-file-name') || '');
    if (!fileName || !isPlaybookFile(fileName)) throw badRequest('Only .pdf and .docx playbooks are supported');
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('Empty file');
    const hash = crypto.createHash('sha256').update(req.body).digest('hex');
    const key = objectKey('upload', hash);
    await putObject(key, req.body, { source: 'upload', name: fileName, uploaded_by: req.user.id });
    res.status(201).json({ file_uri: `upload:${key}`, size: req.body.length, file_name: fileName, file_type: fileExtension(fileName) });
  }),
);

// Content proxy: streams a playbook's source file (upload or Dropbox) under the API's authorization.
router.get('/playbooks/:id/content', requireAdmin, asyncHandler(async (req, res) => {
  const playbook = await entities.Playbook.get(req.params.id);
  if (!playbook) throw notFound('Playbook not found');
  const bytes = await loadPlaybookBytes(playbook);
  const name = playbook.file_name || `${playbook.title}.${playbook.file_type || 'pdf'}`;
  res.setHeader('Content-Type', contentTypeFor(playbook.file_type));
  res.setHeader('Content-Length', bytes.length);
  res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.end(bytes);
}));

// Generated lesson media (video / narration) stored by generateLessonMedia; lesson.video_url and
// lesson.audio_url hold these /api/media/<key> paths. Supports Range requests for <video> seeking.
router.get('/media/:key', requireUser, asyncHandler(async (req, res) => {
  const { key } = req.params;
  if (!/^[a-f0-9]{64}$/.test(key)) throw notFound('Media not found');
  const meta = await objectMeta(key);
  if (!meta || meta.source !== 'media') throw notFound('Media not found');
  const size = Number(meta.size) || 0;
  res.setHeader('Content-Type', meta.content_type || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  let range;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') || '');
  if (m && size && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(size - Number(m[2]), 0);
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }
    range = { start, end };
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
  } else {
    res.setHeader('Content-Length', size);
  }

  const stream = objectStream(key, range);
  stream.on('error', (err) => {
    if (!res.headersSent) res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: 'Media unavailable' });
    else res.destroy(err);
  });
  stream.pipe(res);
}));

export default router;
