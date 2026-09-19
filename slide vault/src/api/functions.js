import { getClient } from './base44Client';

/**
 * Calls a backend function by name. On Base44 these are the handlers under
 * base44/functions/<name>/entry.ts; locally they are simulated in localClient.
 * Every call resolves to { data } to match the SDK's response envelope.
 */
function fn(name) {
  return async (payload = {}) => {
    const client = await getClient();
    const handler = client.functions?.[name];
    if (typeof handler !== 'function') {
      throw new Error(`Backend function "${name}" is not deployed.`);
    }
    const result = await handler(payload);
    return result && typeof result === 'object' && 'data' in result ? result : { data: result };
  };
}

export const syncDropbox = fn('syncDropbox');
export const dropboxAuth = fn('dropboxAuth');
export const getPresentationStream = fn('getPresentationStream');
export const trackView = fn('trackView');
export const recordLogin = fn('recordLogin');
export const renameUntitledPresentations = fn('renameUntitledPresentations');
export const getDownloadLinks = fn('getDownloadLinks');
