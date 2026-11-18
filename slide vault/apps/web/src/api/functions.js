import { getClient } from './backendClient';

/**
 * Calls a backend function by name: on the SlidesVault API server, or simulated in localClient for
 * the local demo. Every call resolves to { data }.
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
export const askCopilot = fn('askCopilot');
export const setUserPassword = fn('setUserPassword');
