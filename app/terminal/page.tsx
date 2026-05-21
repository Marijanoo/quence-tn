'use client'

import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Minus, Square, X, TerminalSquare, PanelLeftOpen } from 'lucide-react'
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

export default function TerminalPopout() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState('Terminal')
  const [termId, setTermId] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('id')
    const t = params.get('title')
    if (t) setTitle(t)
    if (id) setTermId(id)
    if (!id || !window.electronAPI?.pty) return

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
    term.open(containerRef.current!)
    fitAddon.fit()

    window.electronAPI.pty.onData(id, data => term.write(data))
    window.electronAPI.pty.onExit(id, () => term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n'))
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
        if (term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()).catch(() => {}); return false }
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

    term.onData(data => { try { window.electronAPI!.pty.write(id, data) } catch {} })

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
    ro.observe(containerRef.current!)

    return () => {
      cancelAnimationFrame(rafId)
      ro.disconnect()
      containerRef.current?.removeEventListener('paste', onPaste, true)
      containerRef.current?.removeEventListener('contextmenu', onContextMenu, true)
      window.electronAPI!.pty.offData(id)
      window.electronAPI!.pty.offExit(id)
      term.dispose()
    }
  }, [])

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: 'var(--term-bg, #0f0f0f)' }}>
      <div
        className="flex items-center gap-2 px-3 h-8 bg-[#18181b] border-b border-[#27272a] shrink-0 select-none"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <TerminalSquare className="h-3.5 w-3.5 text-green-400 shrink-0" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} />
        <span className="text-xs font-medium text-[#e4e4e7] flex-1 truncate">{title}</span>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => termId && window.electronAPI?.pty.popIn?.(termId)}
            className="flex items-center justify-center h-5 w-5 rounded hover:bg-white/10 text-[#71717a] hover:text-[#e4e4e7] transition-colors"
            title="Pop back in"
          >
            <PanelLeftOpen className="h-3 w-3" />
          </button>
          <div className="w-px h-3 bg-[#3f3f46] mx-0.5" />
          <button
            onClick={() => window.electronAPI?.minimize()}
            className="flex items-center justify-center h-5 w-5 rounded hover:bg-white/10 text-[#71717a] hover:text-[#e4e4e7] transition-colors"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            onClick={() => window.electronAPI?.maximize()}
            className="flex items-center justify-center h-5 w-5 rounded hover:bg-white/10 text-[#71717a] hover:text-[#e4e4e7] transition-colors"
          >
            <Square className="h-3 w-3" />
          </button>
          <button
            onClick={() => window.electronAPI?.close()}
            className="flex items-center justify-center h-5 w-5 rounded hover:bg-red-500/80 text-[#71717a] hover:text-white transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" style={{ padding: '4px 6px' }} />
    </div>
  )
}
