import { getClient } from './base44Client';

/** Wraps one entity so every method resolves the backend client lazily. */
function entityProxy(name) {
  const call = (method) => async (...args) => {
    const client = await getClient();
    const entity = client.entities?.[name];
    if (!entity || typeof entity[method] !== 'function') {
      throw new Error(`Entity ${name}.${method} is not available on this backend.`);
    }
    return entity[method](...args);
  };

  return {
    name,
    list: call('list'),
    filter: call('filter'),
    get: call('get'),
    create: call('create'),
    bulkCreate: call('bulkCreate'),
    update: call('update'),
    delete: call('delete'),
  };
}

export const Presentation = entityProxy('Presentation');
export const DropboxConfig = entityProxy('DropboxConfig');
export const SyncLog = entityProxy('SyncLog');
export const PresentationAnalytics = entityProxy('PresentationAnalytics');
export const LoginHistory = entityProxy('LoginHistory');

export const User = {
  ...entityProxy('User'),
  async me() {
    const client = await getClient();
    return client.auth.me();
  },
  async updateMyUserData(data) {
    const client = await getClient();
    return client.auth.updateMyUserData(data);
  },
  async logout() {
    const client = await getClient();
    return client.auth.logout();
  },
};

export async function auth() {
  const client = await getClient();
  return client.auth;
}
