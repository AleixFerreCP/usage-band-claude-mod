export type Usage = {
  contextPercent: number | null
  limits: { kind: string; percentUsed: number; resetsAt?: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': { usage: Usage | null; baseline: Usage | null }
  }
}
