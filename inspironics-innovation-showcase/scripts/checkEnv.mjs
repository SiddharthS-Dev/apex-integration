import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const envPath = path.join(root, '.env.local')

export const parseEnvFile = (content = '') => {
  const vars = {}

  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue

    const [key, ...rest] = line.split('=')
    const name = key.trim()
    const value = rest.join('=').trim()

    if (name) vars[name] = value
  }

  return vars
}

export const getEnvWarnings = (vars = {}) => {
  const warnings = []

  if (!vars.VITE_GOOGLE_CLIENT_ID) {
    warnings.push('VITE_GOOGLE_CLIENT_ID is not set. Google sign-in will remain in demo mode.')
  }

  if (vars.VITE_ERROR_ENDPOINT && !/^https?:\/\//i.test(vars.VITE_ERROR_ENDPOINT)) {
    warnings.push('VITE_ERROR_ENDPOINT should be an absolute http(s) URL when configured.')
  }

  return warnings
}

const messages = fs.existsSync(envPath)
  ? getEnvWarnings(parseEnvFile(fs.readFileSync(envPath, 'utf8')))
  : ['Missing .env.local. Copy .env.example to .env.local before deploying.']

if (messages.length) {
  console.warn('\nDeployment check warnings:')
  for (const message of messages) console.warn(`- ${message}`)
  process.exitCode = 0
} else {
  console.log('Deployment config looks ready.')
}
