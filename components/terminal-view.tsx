'use client'

import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { X, Plus, TerminalSquare, Copy, Check, ExternalLink, Folder, FolderOpen, ChevronRight } from 'lucide-react'
import { generateId } from '@/lib/utils'
import { cn } from '@/lib/utils'
import '@xterm/xterm/css/xterm.css'

// ── theme ─────────────────────────────────────────────────────────────────────

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

// ── types ─────────────────────────────────────────────────────────────────────

interface TermTab {
  id: string
  title: string
  cwd: string
  folderId: string | null  // null = root
}

interface TermFolder {
  id: string
  name: string
  parentId: string | null
}

interface SavedState {
  terms: { id: string; title: string; cwd: string; folderId: string | null }[]
  folders: { id: string; name: string; parentId: string | null }[]
  counter: number
  folderCounter: number
}

interface TerminalPaneHandle {
  copyOutput: () => void
  getSnapshot: () => string
}

// Match a Windows cmd prompt like "C:\Users\Foo>"
const PROMPT_RE = /([A-Za-z]:[^\r\n>]*?)>/

// ── TerminalPane ──────────────────────────────────────────────────────────────

const TerminalPane = forwardRef<TerminalPaneHandle, {
  id: string
  isVisible: boolean
  cwd: string
  onKill: () => void
  onCwdChange: (cwd: string) => void
}>(function TerminalPane({ id, isVisible, cwd, onKill, onCwdChange }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const mountedRef = useRef(false)
  const killRef = useRef(onKill)
  const isVisibleRef = useRef(isVisible)
  const lastDimsRef = useRef<{ cols: number; rows: number } | null>(null)
  const suppressResizeRef = useRef(false)
  killRef.current = onKill

  useImperativeHandle(ref, () => ({
    copyOutput: () => {
      const term = termRef.current
      if (!term) return
      const buf = term.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '')
      navigator.clipboard.writeText(lines.join('\n').trimEnd())
    },
    getSnapshot: () => {
      const term = termRef.current
      if (!term) return ''
      const buf = term.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '')
      let end = lines.length - 1
      while (end > 0 && lines[end] === '') end--
      const trimmed = lines.slice(0, end + 1)
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
    lastDimsRef.current = { cols: term.cols, rows: term.rows }

    window.electronAPI.pty.create(id, term.cols, term.rows, cwd)

    const onData = (data: string) => {
      term.write(data)
      const plain = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      const match = plain.match(PROMPT_RE)
      if (match) onCwdChange(match[1])
    }
    const onExit = () => term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n')
    window.electronAPI.pty.onData(id, onData)
    window.electronAPI.pty.onExit(id, onExit)
    window.electronAPI.pty.ready(id)

    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true
      const mod = e.ctrlKey || e.metaKey
      if ((mod && e.key === 'v') || (e.ctrlKey && e.shiftKey && e.key === 'V')) {
        navigator.clipboard.readText().then(text => {
          if (text) try { window.electronAPI!.pty.write(id, text) } catch {}
        }).catch(() => {})
        return false
      }
      if ((mod && e.key === 'c') || (e.ctrlKey && e.shiftKey && e.key === 'C')) {
        if (term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection()).catch(() => {})
          return false
        }
        if (e.shiftKey) return false
        return true
      }
      return true
    })

    const onPaste = (e: Event) => e.preventDefault()
    containerRef.current?.addEventListener('paste', onPaste, true)

    const onContextMenu = (e: Event) => {
      e.preventDefault()
      navigator.clipboard.readText().then(text => {
        if (text) try { window.electronAPI!.pty.write(id, text) } catch {}
      }).catch(() => {})
    }
    containerRef.current?.addEventListener('contextmenu', onContextMenu, true)

    const dataDisposable = term.onData(data => {
      try { window.electronAPI!.pty.write(id, data) } catch {}
    })

    let rafId = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        try {
          const el = containerRef.current
          if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return
          if (!isVisibleRef.current) return
          fitAddon.fit()
          if (suppressResizeRef.current) { lastDimsRef.current = { cols: term.cols, rows: term.rows }; return }
          const { cols, rows } = term
          if (!lastDimsRef.current || lastDimsRef.current.cols !== cols || lastDimsRef.current.rows !== rows) {
            lastDimsRef.current = { cols, rows }
            window.electronAPI!.pty.resize(id, cols, rows)
          }
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
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      mountedRef.current = false
    }
  }, [id])

  useEffect(() => {
    const wasVisible = isVisibleRef.current
    isVisibleRef.current = isVisible
    if (!isVisible) return
    // Suppress PTY resize during the pop-in layout transition to avoid SIGWINCH blank lines.
    if (!wasVisible) {
      suppressResizeRef.current = true
      setTimeout(() => { suppressResizeRef.current = false }, 300)
    }
    const t1 = setTimeout(() => {
      try {
        fitAddonRef.current?.fit()
        termRef.current?.refresh(0, (termRef.current?.rows ?? 1) - 1)
        termRef.current?.scrollToBottom()
      } catch {}
    }, 50)
    const t2 = setTimeout(() => {
      try {
        fitAddonRef.current?.fit()
        termRef.current?.refresh(0, (termRef.current?.rows ?? 1) - 1)
        termRef.current?.scrollToBottom()
      } catch {}
    }, 150)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [isVisible, id])

  return <div ref={containerRef} className="w-full h-full" style={{ padding: '4px 6px' }} />
})

// ── TerminalView ──────────────────────────────────────────────────────────────

export function TerminalView({ isActive, onCountChange }: { isActive: boolean; onCountChange?: (count: number) => void }) {
  const [terms, setTerms] = useState<TermTab[]>([])
  const [folders, setFolders] = useState<TermFolder[]>([])
  const [homedir, setHomedir] = useState('~')
  const [activeTermId, setActiveTermId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [stats, setStats] = useState<Record<string, { cpu: number; memory: number }>>({})
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [poppedOutIds, setPoppedOutIds] = useState<Set<string>>(new Set())
  const [folderStack, setFolderStack] = useState<string[]>([]) // stack of folder IDs, [] = root
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const counterRef = useRef(1)
  const folderCounterRef = useRef(1)
  const paneRefs = useRef<Map<string, TerminalPaneHandle>>(new Map())
  const dragIdRef = useRef<string | null>(null)
  const initializedRef = useRef(false)
  const termsRef = useRef<TermTab[]>([])
  const foldersRef = useRef<TermFolder[]>([])

  // Current folder ID is the top of the stack (null = root)
  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1] : null

  const visibleTerms = terms.filter(t => t.folderId === currentFolderId)
  const visibleFolders = folders.filter(f => f.parentId === currentFolderId)

  const totalItems = visibleTerms.length + visibleFolders.length

  useEffect(() => { onCountChange?.(terms.length) }, [terms.length, onCountChange])

  useEffect(() => {
    const clear = (id: string) => setPoppedOutIds(prev => { const next = new Set(prev); next.delete(id); return next })
    window.electronAPI?.pty.onPopoutClosed?.(clear)
    window.electronAPI?.pty.onPopIn?.(clear)
  }, [])

  useEffect(() => { termsRef.current = terms }, [terms])
  useEffect(() => { foldersRef.current = folders }, [folders])

  // Save state whenever terms or folders change
  useEffect(() => {
    if (!initializedRef.current) return
    const state: SavedState | null = (terms.length > 0 || folders.length > 0)
      ? {
          terms: terms.map(t => ({ id: t.id, title: t.title, cwd: t.cwd, folderId: t.folderId })),
          folders: folders.map(f => ({ id: f.id, name: f.name, parentId: f.parentId })),
          counter: counterRef.current,
          folderCounter: folderCounterRef.current,
        }
      : null
    window.electronAPI?.pty.saveState?.(state)
  }, [terms, folders])

  // Init: load state
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
        const restoredTerms = saved.terms.map(s => ({
          id: s.id || generateId(),
          title: s.title,
          cwd: s.cwd || (h as string),
          folderId: s.folderId ?? null,
        }))
        const restoredFolders = (saved.folders ?? []).map(f => ({ id: f.id, name: f.name, parentId: f.parentId ?? null }))
        counterRef.current = saved.counter
        folderCounterRef.current = saved.folderCounter ?? 1
        termsRef.current = restoredTerms
        foldersRef.current = restoredFolders
        setTerms(restoredTerms)
        setFolders(restoredFolders)
        setActiveTermId(restoredTerms[0].id)
        window.electronAPI!.pty.claim?.(restoredTerms.map(t => t.id))
      } else {
        const initial = [{ id: generateId(), title: `Terminal ${counterRef.current++}`, cwd: h as string, folderId: null }]
        termsRef.current = initial
        setTerms(initial)
        setActiveTermId(initial[0].id)
        window.electronAPI!.pty.claim?.(initial.map(t => t.id))
      }
    })
  }, [])

  const addTerm = useCallback(() => {
    const id = generateId()
    const newTerm = { id, title: `Terminal ${counterRef.current++}`, cwd: homedir, folderId: currentFolderId }
    setTerms(prev => {
      const next = [...prev, newTerm]
      termsRef.current = next
      return next
    })
    setActiveTermId(id)
  }, [homedir, currentFolderId])

  const addFolder = useCallback(() => {
    const id = generateId()
    const newFolder: TermFolder = { id, name: `Folder ${folderCounterRef.current++}`, parentId: currentFolderId }
    setFolders(prev => {
      const next = [...prev, newFolder]
      foldersRef.current = next
      return next
    })
    setRenamingFolderId(id)
    setRenameValue(newFolder.name)
  }, [currentFolderId])

  const renameFolder = useCallback((id: string, name: string) => {
    setFolders(prev => {
      const next = prev.map(f => f.id === id ? { ...f, name: name.trim() || f.name } : f)
      foldersRef.current = next
      return next
    })
    setRenamingFolderId(null)
  }, [])

  const deleteFolder = useCallback((id: string) => {
    // Collect all descendant folder IDs recursively
    const collectDescendants = (folderId: string, allFolders: TermFolder[]): string[] => {
      const children = allFolders.filter(f => f.parentId === folderId)
      return [folderId, ...children.flatMap(c => collectDescendants(c.id, allFolders))]
    }
    const toDelete = new Set(collectDescendants(id, foldersRef.current))
    // Move all terminals in deleted folders to root
    setTerms(prev => {
      const next = prev.map(t => toDelete.has(t.folderId ?? '') ? { ...t, folderId: null } : t)
      termsRef.current = next
      return next
    })
    setFolders(prev => {
      const next = prev.filter(f => !toDelete.has(f.id))
      foldersRef.current = next
      return next
    })
    // Pop stack back to before the deleted folder if we're inside it
    setFolderStack(prev => {
      const idx = prev.indexOf(id)
      if (idx === -1) return prev
      return prev.slice(0, idx)
    })
  }, [])

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

  // Build breadcrumb from stack
  const breadcrumb = folderStack.map(id => folders.find(f => f.id === id))

  // Count running terminals per folder (including nested) for badge
  const termsInFolder = (folderId: string) => {
    const collectIds = (id: string): string[] => {
      const children = folders.filter(f => f.parentId === id)
      return [id, ...children.flatMap(c => collectIds(c.id))]
    }
    const allIds = new Set(collectIds(folderId))
    return terms.filter(t => allIds.has(t.folderId ?? '')).length
  }

  const canAddMore = totalItems < 4

  return (
    <div className="flex flex-col w-full h-full bg-background overflow-hidden">
      {/* Breadcrumb bar when inside a folder */}
      {folderStack.length > 0 && (
        <div className="flex items-center gap-1 px-3 h-8 border-b border-border bg-card shrink-0 overflow-x-auto">
          <button
            onClick={() => setFolderStack([])}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <TerminalSquare className="h-3 w-3" />
            Home
          </button>
          {breadcrumb.map((folder, i) => (
            <div key={folder?.id ?? i} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
              {i < breadcrumb.length - 1 ? (
                <button
                  onClick={() => setFolderStack(prev => prev.slice(0, i + 1))}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Folder className="h-3 w-3" />
                  {folder?.name ?? 'Folder'}
                </button>
              ) : (
                <span className="flex items-center gap-1 text-xs text-foreground font-medium">
                  <FolderOpen className="h-3 w-3 text-muted-foreground/60" />
                  {folder?.name ?? 'Folder'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div
        className="grid grid-cols-2 gap-3 p-3 flex-1 min-h-0"
        style={{ gridTemplateRows: 'repeat(2, minmax(0, 1fr))' }}
      >
        {/* Folder tiles (only at root) */}
        {visibleFolders.map(folder => (
          <div
            key={folder.id}
            className="flex flex-col rounded-lg border border-border bg-card overflow-hidden hover:border-primary/40 transition-colors cursor-pointer group"
            onClick={() => setFolderStack(prev => [...prev, folder.id])}
          >
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card shrink-0">
              <Folder className="h-3.5 w-3.5 text-primary/60 shrink-0" />
              {renamingFolderId === folder.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter') renameFolder(folder.id, renameValue)
                    if (e.key === 'Escape') { renameFolder(folder.id, folder.name); setRenamingFolderId(null) }
                  }}
                  onBlur={() => renameFolder(folder.id, renameValue)}
                  onClick={e => e.stopPropagation()}
                  className="flex-1 min-w-0 text-xs font-medium bg-transparent outline-none border-b border-primary/50 text-foreground"
                />
              ) : (
                <span
                  className="text-xs font-medium text-foreground flex-1 min-w-0 truncate"
                  onDoubleClick={e => { e.stopPropagation(); setRenamingFolderId(folder.id); setRenameValue(folder.name) }}
                >
                  {folder.name}
                </span>
              )}
              <button
                onClick={e => { e.stopPropagation(); setRenamingFolderId(folder.id); setRenameValue(folder.name) }}
                className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-foreground transition-all shrink-0 px-1"
                title="Rename"
              >
                ✎
              </button>
              <button
                onClick={e => { e.stopPropagation(); deleteFolder(folder.id) }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 transition-all shrink-0"
                title="Delete folder"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground select-none">
              <FolderOpen className="h-8 w-8 opacity-20" />
              <span className="text-xs opacity-50">
                {termsInFolder(folder.id)} terminal{termsInFolder(folder.id) !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
        ))}

        {/* Terminal tiles */}
        {visibleTerms.map(term => (
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
              'flex flex-col rounded-lg border overflow-hidden transition-colors',
              dragOverId === term.id && dragIdRef.current !== term.id
                ? 'border-primary/60 bg-primary/5'
                : 'border-border'
            )}
            onClick={() => setActiveTermId(term.id)}
          >
            <div
              draggable
              onDragStart={e => { e.stopPropagation(); dragIdRef.current = term.id }}
              onDragEnd={() => { dragIdRef.current = null; setDragOverId(null) }}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 border-b shrink-0 cursor-grab active:cursor-grabbing',
                activeTermId === term.id ? 'bg-primary/15 border-primary/40' : 'bg-card border-border'
              )}
            >
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
                  'transition-colors shrink-0',
                  poppedOutIds.has(term.id) ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
                title={poppedOutIds.has(term.id) ? 'Already popped out' : 'Pop out'}
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

        {/* Add tile */}
        {canAddMore && (
          <div className="flex flex-col rounded-lg border-2 border-dashed border-border overflow-hidden">
            <button
              onClick={addTerm}
              className="flex items-center justify-center gap-2 flex-1 hover:bg-accent/10 hover:border-primary/50 transition-colors text-muted-foreground hover:text-foreground group border-b border-dashed border-border"
            >
              <Plus className="h-4 w-4" />
              <span className="text-xs">New Terminal</span>
            </button>
            <button
              onClick={addFolder}
              className="flex items-center justify-center gap-2 flex-1 hover:bg-accent/10 transition-colors text-muted-foreground hover:text-foreground group"
            >
              <Folder className="h-4 w-4" />
              <span className="text-xs">New Folder</span>
            </button>
          </div>
        )}

        {/* Empty grid fillers */}
        {Array.from({ length: Math.max(0, 3 - totalItems) }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
      </div>
    </div>
  )
}
