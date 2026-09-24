/**
 * @inspironics/shared — contracts both the web client and the API import.
 *
 * Deliberately imports nothing, not even `node:` builtins, so bare Node and
 * Vite can both consume it without a build step.
 */
export * from './taxonomy.js'
export * from './roles.js'
export * from './fileTypes.js'
export * from './plate.js'
