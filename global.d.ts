export {}

declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void
      maximize: () => void
      close: () => void
      zoomIn: () => void
      zoomOut: () => void
      onUpdateAvailable?: (cb: () => void) => void
      onUpdateProgress?: (cb: (percent: number) => void) => void
      onUpdateDownloaded: (cb: () => void) => void
      installUpdate?: () => void
      pty: {
        create:  (id: string, cols: number, rows: number, cwd?: string) => Promise<{ ok: boolean }>
        ready:   (id: string) => void
        write:   (id: string, data: string) => void
        line:    (id: string, line: string) => void
        resize:  (id: string, cols: number, rows: number) => void
        kill:    (id: string) => Promise<{ ok: boolean }>
        popout:  (id: string, title: string) => Promise<{ ok: boolean }>
        homedir: () => Promise<string>
        onData:  (id: string, cb: (data: string) => void) => void
        onExit:  (id: string, cb: () => void) => void
        offData: (id: string) => void
        offExit: (id: string) => void
        stats:   (ids: string[]) => Promise<Record<string, { cpu: number; memory: number }>>
        onPopoutClosed: (cb: (id: string) => void) => void
        onPopIn:        (cb: (id: string) => void) => void
        popIn:          (id: string) => void
      }
    }
  }
}
