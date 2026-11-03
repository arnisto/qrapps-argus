/** Read an env var or throw with its name. Server only. */
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env var ${name}`)
  return value
}

export function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback
}
