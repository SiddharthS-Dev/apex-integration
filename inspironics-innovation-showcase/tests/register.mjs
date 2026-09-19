/** Installs the JSX loader for `node --test`. See jsxLoader.mjs. */
import { register } from 'node:module'

register('./jsxLoader.mjs', import.meta.url)
