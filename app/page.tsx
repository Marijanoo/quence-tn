'use client'

import { useEffect, useState } from 'react'
import { Minus, Square, X, TerminalSquare } from 'lucide-react'
import { TerminalView } from '@/components/terminal-view'
import { UpdateBar } from '@/components/update-bar'

export default function Home() {
  const [updateProgress, setUpdateProgress] = useState<number | null>(null)
  const [updateDownloaded, setUpdateDownloaded] = useState(false)
  const [termCount, setTermCount] = useState(0)

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onUpdateDownloaded) return
    api.onUpdateAvailable?.(() => setUpdateProgress(0))
    api.onUpdateProgress?.((p) => setUpdateProgress(p))
    api.onUpdateDownloaded(() => { setUpdateProgress(100); setUpdateDownloaded(true) })
  }, [])

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Title bar */}
      <div
        className="flex items-center gap-2 px-3 h-9 bg-card border-b border-border shrink-0 select-none overflow-hidden"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <TerminalSquare className="h-4 w-4 text-green-400 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} />
        <span className="text-sm font-semibold text-foreground truncate flex-1">QuenceTN</span>
        {termCount > 0 && (
          <span className="text-xs text-muted-foreground shrink-0">{termCount} terminal{termCount !== 1 ? 's' : ''}</span>
        )}
        <div className="flex items-center gap-1 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => window.electronAPI?.minimize()}
            className="flex items-center justify-center h-6 w-6 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => window.electronAPI?.maximize()}
            className="flex items-center justify-center h-6 w-6 rounded hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => window.electronAPI?.close()}
            className="flex items-center justify-center h-6 w-6 rounded hover:bg-red-500/80 text-muted-foreground hover:text-white transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Update bar */}
      {updateProgress !== null && (
        <UpdateBar
          progress={updateProgress}
          downloaded={updateDownloaded}
          onInstall={() => window.electronAPI?.installUpdate?.()}
          onDismiss={() => { setUpdateProgress(null); setUpdateDownloaded(false) }}
        />
      )}

      {/* Terminal grid */}
      <div className="flex-1 min-h-0">
        <TerminalView isActive onCountChange={setTermCount} />
      </div>
    </div>
  )
}
