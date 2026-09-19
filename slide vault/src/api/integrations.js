import { getClient } from './base44Client';

async function core(method, payload) {
  const client = await getClient();
  const impl = client.integrations?.Core?.[method];
  if (typeof impl !== 'function') {
    throw new Error(`Integration Core.${method} is not available on this backend.`);
  }
  return impl(payload);
}

export const InvokeLLM = (payload) => core('InvokeLLM', payload);
export const UploadFile = (payload) => core('UploadFile', payload);

export const Core = { InvokeLLM, UploadFile };
