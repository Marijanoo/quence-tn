'use client'

import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { X, Plus, TerminalSquare, Copy, Check, ExternalLink } from 'lucide-react'
import { generateId } from '@/lib/utils'
import { cn } from '@/lib/utils'
import '@xterm/xterm/css/xterm.css'

function getCssVar(name: string, fallback: string) {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function getTermTheme() {
  return {
    background:          getCssVar('--term-bg',      '#0f0f0f'),
    foreground:          getCssVar('--term-fg',      '#e4e4e7'),
    cursor:              getCssVar('--term-cursor',  '#a1a1aa'),
    selectionBackground: '#3f3f46',
    black: '#18181b',
    red:     getCssVar('--term-red',     '#f87171'),
    green:   getCssVar('--term-green',   '#4ade80'),
    yellow:  getCssVar('--term-yellow',  '#facc15'),
    blue:    getCssVar('--term-blue',    '#60a5fa'),
    magenta: getCssVar('--term-magenta', '#c084fc'),
    cyan:    getCssVar('--term-cyan',    '#22d3ee'),
    white:   '#e4e4e7',
    brightBlack: '#52525b', brightRed: '#fca5a5', brightGreen: '#86efac',
    brightYellow: '#fde047', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9', brightWhite: '#f4f4f5',
  }
}

interface TermTab {
  id: string
  title: string
  cwd: string
}

interface TerminalPaneHandle {
  copyOutput: () => void
  getSnapshot: () => string
}

const TerminalPane = forwardRef<TerminalPaneHandle, { id: string; isVisible: boolean; cwd: string; onKill: () => void; onCwdChange: (cwd: string) => void }>(
function TerminalPane({ id, isVisible, cwd, onKill, onCwdChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const mountedRef = useRef(false)
  // Exposed so the parent can trigger intentional PTY kill (tab close)
  const killRef = useRef(onKill)
  killRef.current = onKill

  useImperativeHandle(ref, () => ({
    copyOutput: () => {
      const term = termRef.current
      if (!term) return
      const buf = term.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buf.length; i++) {
        lines.push(buf.getLine(i)?.translateToString(true) ?? '')
      }
      navigator.clipboard.writeText(lines.join('\n').trimEnd())
    },
    getSnapshot: () => {
      const term = termRef.current
      if (!term) return ''
      const buf = term.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buf.length; i++) {
        lines.push(buf.getLine(i)?.translateToString(true) ?? '')
      }
      // Trim trailing blank lines
      let end = lines.length - 1
      while (end > 0 && lines[end] === '') end--
      const trimmed = lines.slice(0, end + 1)
      // Collapse runs of blank lines to a single blank line
      const collapsed: string[] = []
      let prevBlank = false
      for (const line of trimmed) {
        const blank = line === ''
        if (blank && prevBlank) continue
        collapsed.push(line)
        prevBlank = blank
      }
      return collapsed.join('\r\n')
    },
  }))

  useEffect(() => {
    if (!containerRef.current || mountedRef.current) return
    if (!window.electronAPI?.pty) return
    mountedRef.current = true

    const term = new Terminal({
      fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      cursorBlink: true,
      cursorStyle: 'bar',
      theme: getTermTheme(),
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    fitAddon.fit()
    fitAddonRef.current = fitAddon
    termRef.current = term

    // Start PTY at saved cwd
    window.electronAPI.pty.create(id, term.cols, term.rows, cwd)

    // PTY → xterm, parse prompt to track cwd
    const onData = (data: string) => {
      term.write(data)
      // Strip ANSI codes then look for a cmd prompt to extract cwd
      const plain = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      const match = plain.match(PROMPT_RE)
      if (match) onCwdChange(match[1])
    }
    const onExit = () => term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n')
    window.electronAPI.pty.onData(id, onData)
    window.electronAPI.pty.onExit(id, onExit)
    window.electronAPI.pty.ready(id)

    // Intercept clipboard and select-all shortcuts
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey

      // Ctrl/Cmd+V or Ctrl+Shift+V — paste
      if ((mod && e.key === 'v') || (e.ctrlKey && e.shiftKey && e.key === 'V')) {
        navigator.clipboard.readText().then(text => {
          if (text) try { window.electronAPI!.pty.write(id, text) } catch {}
        }).catch(() => {})
        return false
      }
      // Ctrl/Cmd+C or Ctrl+Shift+C — copy selection (if any), else pass through as interrupt
      if ((mod && e.key === 'c') || (e.ctrlKey && e.shiftKey && e.key === 'C')) {
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection()).catch(() => {})
          return false
        }
        // No selection: let Ctrl+C pass through as PTY interrupt
        if (e.shiftKey) return false // Ctrl+Shift+C with no selection — just swallow
        return true
      }
      return true
    })

    // Block xterm's built-in paste so our handler is the only one writing to the PTY
    const onPaste = (e: Event) => e.preventDefault()
    containerRef.current?.addEventListener('paste', onPaste, true)

    // Right-click to paste
    const onContextMenu = (e: Event) => {
      e.preventDefault()
      navigator.clipboard.readText().then(text => {
        if (text) try { window.electronAPI!.pty.write(id, text) } catch {}
      }).catch(() => {})
    }
    containerRef.current?.addEventListener('contextmenu', onContextMenu, true)

    // xterm → PTY (node-pty handles echo natively)
    const dataDisposable = term.onData(data => {
      try { window.electronAPI!.pty.write(id, data) } catch {}
    })

    // Resize observer — debounced via rAF, skip when container has no dimensions (hidden)
    let rafId = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        try {
          const el = containerRef.current
          if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return
          fitAddon.fit()
          window.electronAPI!.pty.resize(id, term.cols, term.rows)
        } catch {}
      })
    })
    ro.observe(containerRef.current)

    return () => {
      cancelAnimationFrame(rafId)
      ro.disconnect()
      dataDisposable.dispose()
      containerRef.current?.removeEventListener('paste', onPaste, true)
      containerRef.current?.removeEventListener('contextmenu', onContextMenu, true)
      window.electronAPI!.pty.offData(id)
      window.electronAPI!.pty.offExit(id)
      // Do NOT kill the PTY here — this cleanup runs on every re-render/hot-reload.
      // PTY is killed only when the tab is explicitly closed (via onKill).
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      mountedRef.current = false
    }
  }, [id])

  // Re-fit and restore viewport when becoming visible after being hidden
  useEffect(() => {
    if (!isVisible) return
    const t1 = setTimeout(() => {
      try {
        fitAddonRef.current?.fit()
        termRef.current?.refresh(0, (termRef.current?.rows ?? 1) - 1)
        termRef.current?.scrollToBottom()
      } catch {}
    }, 50)
    // Second pass — canvas renderer may need an extra tick after layout settles
    const t2 = setTimeout(() => {
      try {
        fitAddonRef.current?.fit()
        termRef.current?.refresh(0, (termRef.current?.rows ?? 1) - 1)
        termRef.current?.scrollToBottom()
      } catch {}
    }, 150)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [isVisible])

  return <div ref={containerRef} className="w-full h-full" style={{ padding: '4px 6px' }} />
})

interface SavedState { terms: { id: string; title: string; cwd: string }[]; counter: number }

// Match a Windows cmd prompt like "C:\Users\Foo>" — strip ANSI escape codes first
const PROMPT_RE = /([A-Za-z]:[^\r\n>]*?)>/

export function TerminalView({ isActive, onCountChange }: { isActive: boolean; onCountChange?: (count: number) => void }) {
  const [terms, setTerms] = useState<TermTab[]>([])
  const [homedir, setHomedir] = useState('~')
  const [activeTermId, setActiveTermId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [stats, setStats] = useState<Record<string, { cpu: number; memory: number }>>({})
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [poppedOutIds, setPoppedOutIds] = useState<Set<string>>(new Set())
  const counterRef = useRef(1)
  const paneRefs = useRef<Map<string, TerminalPaneHandle>>(new Map())
  const dragIdRef = useRef<string | null>(null)
  const initializedRef = useRef(false)
  const termsRef = useRef<TermTab[]>([])

  // Report count to parent
  useEffect(() => { onCountChange?.(terms.length) }, [terms.length, onCountChange])

  // Clear popped-out state when the popout window is closed or popped back in
  useEffect(() => {
    const clear = (id: string) => setPoppedOutIds(prev => { const next = new Set(prev); next.delete(id); return next })
    window.electronAPI?.pty.onPopoutClosed?.(clear)
    window.electronAPI?.pty.onPopIn?.(clear)
  }, [])

  // Keep termsRef in sync so save helper always has fresh state
  useEffect(() => { termsRef.current = terms }, [terms])

  // Save to main-process file whenever terms change (survives renderer reloads)
  useEffect(() => {
    if (!initializedRef.current) return
    const state: SavedState | null = terms.length > 0
      ? { terms: terms.map(t => ({ id: t.id, title: t.title, cwd: t.cwd })), counter: counterRef.current }
      : null
    window.electronAPI?.pty.saveState?.(state)
  }, [terms])

  // Init: load state from main process, claim live PTY IDs, kill orphans
  useEffect(() => {
    if (!window.electronAPI?.pty) return
    Promise.all([
      window.electronAPI.pty.homedir(),
      window.electronAPI.pty.loadState?.() as Promise<unknown>,
    ]).then(([h, raw]) => {
      setHomedir(h as string)
      const saved = (() => {
        try {
          if (!raw || typeof raw !== 'object') return null
          const s = raw as SavedState
          if (!Array.isArray(s.terms)) return null
          return s
        } catch { return null }
      })()
      initializedRef.current = true
      if (saved && saved.terms.length > 0) {
        const restored = saved.terms.map(s => ({
          id: s.id || generateId(),
          title: s.title,
          cwd: s.cwd || (h as string),
        }))
        counterRef.current = saved.counter
        termsRef.current = restored
        setTerms(restored)
        setActiveTermId(restored[0].id)
        // Kill any PTYs from a previous session that we're not restoring
        window.electronAPI!.pty.claim?.(restored.map(t => t.id))
      } else {
        const initial = [{ id: generateId(), title: `Terminal ${counterRef.current++}`, cwd: h as string }]
        termsRef.current = initial
        setTerms(initial)
        setActiveTermId(initial[0].id)
        window.electronAPI!.pty.claim?.(initial.map(t => t.id))
      }
    })
  }, [])

  const addTerm = useCallback(() => {
    const id = generateId()
    setTerms(prev => {
      const next = [...prev, { id, title: `Terminal ${counterRef.current++}`, cwd: homedir }]
      termsRef.current = next
      return next
    })
    setActiveTermId(id)
  }, [homedir])

  const closeTerm = useCallback((id: string) => {
    window.electronAPI?.pty.kill(id)
    paneRefs.current.delete(id)
    setPoppedOutIds(prev => { const next = new Set(prev); next.delete(id); return next })
    setTerms(prev => {
      const next = prev.filter(t => t.id !== id)
      termsRef.current = next
      return next
    })
    setActiveTermId(prev => prev === id ? null : prev)
  }, [])

  const updateTermCwd = useCallback((id: string, newCwd: string) => {
    setTerms(prev => {
      const next = prev.map(t => t.id === id ? { ...t, cwd: newCwd } : t)
      termsRef.current = next
      return next
    })
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.pty?.stats || terms.length === 0) return
    const poll = async () => {
      const ids = terms.map(t => t.id)
      const result = await window.electronAPI!.pty.stats(ids)
      setStats(result)
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [terms])

  const copyOutput = useCallback((id: string) => {
    paneRefs.current.get(id)?.copyOutput()
    setCopiedId(id)
    setTimeout(() => setCopiedId(prev => prev === id ? null : prev), 2000)
  }, [])

  const swapTerms = useCallback((aId: string, bId: string) => {
    setTerms(prev => {
      const next = [...prev]
      const ai = next.findIndex(t => t.id === aId)
      const bi = next.findIndex(t => t.id === bId)
      if (ai === -1 || bi === -1 || ai === bi) return prev
      ;[next[ai], next[bi]] = [next[bi], next[ai]]
      return next
    })
  }, [])

  return (
    <div className="flex flex-col w-full h-full bg-background overflow-hidden">
      <div
        className="grid grid-cols-2 gap-3 p-3 flex-1 min-h-0"
        style={{ gridTemplateRows: 'repeat(2, minmax(0, 1fr))' }}
      >
        {terms.map(term => (
          <div
            key={term.id}
            onDragOver={e => { e.preventDefault(); setDragOverId(term.id) }}
            onDragLeave={() => setDragOverId(prev => prev === term.id ? null : prev)}
            onDrop={e => {
              e.preventDefault()
              if (dragIdRef.current && dragIdRef.current !== term.id) swapTerms(dragIdRef.current, term.id)
              dragIdRef.current = null
              setDragOverId(null)
            }}
            className={cn(
              "flex flex-col rounded-lg border overflow-hidden transition-colors",
              dragOverId === term.id && dragIdRef.current !== term.id
                ? "border-primary/60 bg-primary/5"
                : "border-border"
            )}
            onClick={() => setActiveTermId(term.id)}
          >
            {/* Drag handle is only the header — avoids Blink crashing when dragging a div containing xterm canvas */}
            <div
              draggable
              onDragStart={e => { e.stopPropagation(); dragIdRef.current = term.id }}
              onDragEnd={() => { dragIdRef.current = null; setDragOverId(null) }}
              className={cn(
              "flex items-center gap-2 px-3 py-1.5 border-b shrink-0 cursor-grab active:cursor-grabbing",
              activeTermId === term.id ? "bg-primary/15 border-primary/40" : "bg-card border-border"
            )}>
              <TerminalSquare className="h-3.5 w-3.5 text-green-400 shrink-0" />
              <span className="text-xs font-medium text-foreground truncate">{term.title}</span>
              <span className="text-xs text-muted-foreground truncate flex-1">{term.cwd}</span>
              {stats[term.id] && (
                <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                  {stats[term.id].cpu.toFixed(1)}% · {(stats[term.id].memory / 1024 / 1024).toFixed(1)}MB
                </span>
              )}
              <button
                onClick={() => copyOutput(term.id)}
                className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="Copy output"
              >
                {copiedId === term.id
                  ? <Check className="h-3.5 w-3.5 text-green-400" />
                  : <Copy className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={async () => {
                  const snapshot = paneRefs.current.get(term.id)?.getSnapshot() ?? ''
                  if (snapshot) await window.electronAPI?.pty.setSnapshot?.(term.id, snapshot)
                  window.electronAPI?.pty.popout?.(term.id, term.title)
                  setPoppedOutIds(prev => new Set(prev).add(term.id))
                }}
                className={cn(
                  "transition-colors shrink-0",
                  poppedOutIds.has(term.id)
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title={poppedOutIds.has(term.id) ? "Already popped out" : "Pop out"}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => closeTerm(term.id)}
                className="text-muted-foreground hover:text-red-400 transition-colors shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 relative" style={{ background: 'var(--term-bg, #0f0f0f)' }}>
              {/* Always keep TerminalPane mounted so xterm buffer is never lost on pop-in */}
              <div className={poppedOutIds.has(term.id) ? 'invisible absolute inset-0' : 'w-full h-full'}>
                <TerminalPane
                  ref={el => { if (el) paneRefs.current.set(term.id, el) }}
                  id={term.id}
                  isVisible={isActive && !poppedOutIds.has(term.id)}
                  cwd={term.cwd}
                  onKill={() => window.electronAPI?.pty.kill(term.id)}
                  onCwdChange={(newCwd) => updateTermCwd(term.id, newCwd)}
                />
              </div>
              {poppedOutIds.has(term.id) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground select-none">
                  <ExternalLink className="h-5 w-5 opacity-40" />
                  <span className="text-xs opacity-40">Terminal is popped out</span>
                  <button
                    onClick={() => window.electronAPI?.pty.popout?.(term.id, term.title)}
                    className="text-xs text-primary/60 hover:text-primary transition-colors mt-1"
                  >
                    Focus window
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {terms.length < 4 && (
          <button
            onClick={addTerm}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border hover:border-primary/50 hover:bg-accent/10 transition-colors text-muted-foreground hover:text-foreground group"
          >
            <div className="flex items-center justify-center h-12 w-12 rounded-full border-2 border-dashed border-current group-hover:border-primary/50 transition-colors">
              <Plus className="h-6 w-6" />
            </div>
            <span className="text-xs">New Terminal</span>
          </button>
        )}
        {Array.from({ length: Math.max(0, 3 - terms.length) }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
      </div>
    </div>
  )
}
