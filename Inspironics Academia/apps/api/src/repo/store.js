import { entities } from './entities.js';
import { listUsers } from './users.js';

// The service-role `store` the shared review and recertification logic runs against (no RLS — the
// function handlers decide who may call them).
export const store = {
  filter: (name, query, sort, limit) => entities[name].filter(query, sort || undefined, limit),
  get: (name, id) => entities[name].get(id),
  create: (name, data, userId) => entities[name].create(data, { userId }),
  update: (name, id, patch) => entities[name].update(id, patch),
  users: () => listUsers(),
};
