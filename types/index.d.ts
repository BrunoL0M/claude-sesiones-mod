export type SessionMeta = {
  id: string
  cwd: string
  title: string
  gitBranch?: string
  startedAt: number
  updatedAt: number
  messages: number
}

export type ScanStatus = {
  isScanning: boolean
  scannedAt: number
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    sesiones: {
      sessions: SessionMeta[]
      scan: ScanStatus
      openDirs: string[]
      openOld: string[]
      selected: string
      filter: string
      home: string
      cwd: string
    }
  }
}
