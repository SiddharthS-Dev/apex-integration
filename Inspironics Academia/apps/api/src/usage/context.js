import { AsyncLocalStorage } from 'node:async_hooks';

// What a generation is for: the operation (backend function or studio action), who asked, the
// record it belongs to and whether cached answers may be used. Set once at the entry point (an HTTP
// function call, a job) and read by the AI and voice routers when they log usage.
const store = new AsyncLocalStorage();

export function runWithGeneration(ctx, fn) {
  return store.run({ ...(store.getStore() || {}), ...ctx }, fn);
}

export function currentGeneration() {
  return store.getStore() || {};
}
