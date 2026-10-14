// File storage. Public media (avatars, post/product images, videos) is served from /uploads/media;
// private documents (CVs, certificates, IDs, business papers) live outside the public path and are only
// streamed through an access-checked endpoint. Replace the disk backend with S3/R2/GCS + CDN in production.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { config } from '../config.ts';
import { badRequest } from './http.ts';

export const MEDIA_DIR = path.join(config.uploadDir, 'media');
export const DOCS_DIR = path.join(config.uploadDir, 'documents');
fs.mkdirSync(MEDIA_DIR, { recursive: true });
fs.mkdirSync(DOCS_DIR, { recursive: true });

const MEDIA_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
  'video/mp4': '.mp4', 'video/webm': '.webm',
  // a post's own soundtrack
  'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
};
const DOC_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
};

function makeUploader(dir: string, types: Record<string, string>) {
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + types[file.mimetype]),
    }),
    limits: { fileSize: config.maxUploadBytes, files: 10 },
    fileFilter: (_req, file, cb) => {
      if (types[file.mimetype]) cb(null, true);
      else cb(badRequest(`Unsupported file type: ${file.mimetype}`));
    },
  });
}

export const mediaUpload = makeUploader(MEDIA_DIR, MEDIA_TYPES);
export const docUpload = makeUploader(DOCS_DIR, DOC_TYPES);

export const mediaUrl = (filename: string) => `/uploads/media/${filename}`;
export const docPath = (storageKey: string) => path.join(DOCS_DIR, path.basename(storageKey));
