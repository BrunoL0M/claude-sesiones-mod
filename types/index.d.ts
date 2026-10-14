export type SessionMeta = {
  id: string
  cwd: string
  title: string
  gitBranch?: string
  startedAt: number
  updatedAt: number
  messages: number
  /** Ruta del .jsonl; la pone el escaneo, no se guarda en la caché. */
  file?: string
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
      openMore: string[]
      selected: string
      renaming: string
      filter: string
      home: string
      cwd: string
    }
  }
}
