import { buildNotification } from '@academy/shared';
import { db } from '@/api/drivers/demo/store';
import { findAll, findOne, insert, patch, persist } from '@/api/drivers/demo/service';
import { clone } from '@/api/drivers/demo/records';

// Service-role `store` and `notify` for the shared review / recertification logic — the demo's
// counterpart of the API's adapters. Rows are handed out as copies, like the API's repository.

export const store = {
  filter: (name, q = {}, sort, limit) => findAll(name, q || {}, sort || undefined).slice(0, limit || 10000).map(clone),
  get: (name, id) => clone(findOne(name, { id })),
  create: (name, data, userId) => clone(insert(name, data, userId)),
  update: (name, id, data) => clone(patch(name, id, data)),
  users: () => db().users.map(({ id, role, disabled, full_name, email }) => ({ id, role, disabled, full_name, email })),
};

// No email in the demo: a notification is its in-app row, created once per dedupe key.
export function notify(userId, kind, data, dedupeKey) {
  if (dedupeKey && findOne('Notification', { dedupe_key: dedupeKey })) return;
  insert('Notification', { user_id: userId, ...buildNotification(kind, data), read: false, dedupe_key: dedupeKey || '' });
  persist();
}
