import { ApiError } from '@/api/drivers/http';
import { table } from '@/api/drivers/demo/store';
import { newId } from '@/api/drivers/demo/records';

// Uploaded files live in memory for this tab only (object URLs); the uri stored on records is demo:<id>.
// After a reload the bytes are gone, so downloads fall back to a small placeholder document.

const MAX_MB = 50;
const blobs = new Map();

function placeholderUrl(playbook) {
  const text = `${playbook?.title || 'Playbook'}\n\nDemo mode: the original file is not stored in this browser session.\n`;
  return URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
}

export function createFiles() {
  return {
    async upload(file) {
      if (!file) throw new ApiError(400, 'No file provided');
      if (file.size > MAX_MB * 1024 * 1024) throw new ApiError(413, `File exceeds the ${MAX_MB} MB limit`);
      const id = newId();
      blobs.set(id, URL.createObjectURL(file));
      return { file_uri: `demo:${id}`, size: file.size, file_name: file.name, file_type: file.type || 'application/octet-stream' };
    },
    playbookContentUrl(playbookId) {
      const playbook = table('Playbook').find((p) => p.id === playbookId);
      const id = String(playbook?.file_url || '').replace(/^demo:/, '');
      return blobs.get(id) || placeholderUrl(playbook);
    },
  };
}

export function clearFiles() {
  for (const url of blobs.values()) {
    try { URL.revokeObjectURL(url); } catch { /* ignore */ }
  }
  blobs.clear();
}
