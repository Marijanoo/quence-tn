'use client'

import { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'

type OklchColor = { l: number; c: number; h: number }

function fmt(c: OklchColor) {
  return `oklch(${c.l.toFixed(3)} ${c.c.toFixed(3)} ${Math.round(c.h)})`
}

const ACCENT_PRESETS = [
  { name: 'Lime',   l: 0.75, c: 0.20, h: 130 },
  { name: 'Teal',   l: 0.72, c: 0.19, h: 160 },
  { name: 'Cyan',   l: 0.73, c: 0.16, h: 195 },
  { name: 'Blue',   l: 0.65, c: 0.20, h: 230 },
  { name: 'Violet', l: 0.68, c: 0.20, h: 280 },
  { name: 'Pink',   l: 0.70, c: 0.20, h: 330 },
  { name: 'Orange', l: 0.75, c: 0.18, h: 55  },
  { name: 'Red',    l: 0.62, c: 0.22, h: 20  },
]

interface Settings {
  accent:      OklchColor
  bgL:         number
  bgC:         number
  bgH:         number
  fgL:         number
  mutedL:      number
  destructive: OklchColor
  termBg:      string
  termFg:      string
  termCursor:  string
  termRed:     string
  termGreen:   string
  termYellow:  string
  termBlue:    string
  termMagenta: string
  termCyan:    string
}

export const DEFAULTS: Settings = {
  accent:      { l: 0.75, c: 0.20, h: 145 },
  bgL:         0.28,
  bgC:         0.01,
  bgH:         282,
  fgL:         0.97,
  mutedL:      0.85,
  destructive: { l: 0.55, c: 0.22, h: 25 },
  termBg:      '#0f0f0f',
  termFg:      '#e4e4e7',
  termCursor:  '#85F08F',
  termRed:     '#f87171',
  termGreen:   '#85F08F',
  termYellow:  '#facc15',
  termBlue:    '#60a5fa',
  termMagenta: '#c084fc',
  termCyan:    '#22d3ee',
}

const STORAGE_KEY = 'quence-tn-theme'

function clampL(l: number) { return Math.min(0.90, Math.max(0.35, l)) }
function clampColor(c: OklchColor) { return { ...c, l: clampL(c.l) } }

function clampSettings(s: Settings): Settings {
  const dark = s.bgL <= 0.5
  const fgMin = dark ? Math.min(1, s.bgL + 0.4) : 0
  const fgMax = dark ? 1 : Math.max(0, s.bgL - 0.4)
  const fgL = Math.min(fgMax, Math.max(fgMin, s.fgL))
  const mutedMin = s.bgL + 0.15
  const mutedMax = fgL - 0.1
  const mutedL = Math.min(Math.max(mutedMin, mutedMax), Math.max(Math.min(mutedMin, mutedMax), s.mutedL))
  return {
    ...s,
    bgL: Math.min(0.95, Math.max(0.05, s.bgL)),
    fgL, mutedL,
    accent:      clampColor(s.accent),
    destructive: clampColor(s.destructive),
  }
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return clampSettings({ ...DEFAULTS, ...JSON.parse(raw) })
  } catch {}
  return DEFAULTS
}

export function applySettings(s: Settings) {
  const el = document.documentElement
  const set = (v: string, color: OklchColor) => el.style.setProperty(v, fmt(color))
  const setRaw = (v: string, val: string) => el.style.setProperty(v, val)

  const bg: OklchColor = { l: s.bgL, c: s.bgC, h: s.bgH }
  const fg: OklchColor = { l: s.fgL, c: 0, h: 0 }

  set('--primary', s.accent)
  set('--accent', s.accent)
  set('--ring', s.accent)
  set('--primary-foreground', { l: s.bgL, c: s.bgC, h: s.bgH })
  set('--accent-foreground',  { l: s.bgL, c: s.bgC, h: s.bgH })

  set('--background', bg)
  set('--card',      { ...bg, l: Math.min(1, bg.l + 0.04) })
  set('--popover',   { ...bg, l: Math.min(1, bg.l + 0.06) })
  set('--muted',     { ...bg, l: Math.min(1, bg.l + 0.08) })
  set('--input',     { ...bg, l: Math.min(1, bg.l + 0.08) })
  set('--secondary', { ...bg, l: Math.min(1, bg.l + 0.10) })
  set('--border',    { ...bg, l: Math.min(1, bg.l + 0.14) })

  set('--foreground', fg)
  set('--card-foreground', fg)
  set('--popover-foreground', fg)
  set('--destructive-foreground', fg)
  set('--secondary-foreground', { ...fg, l: Math.max(0, fg.l - 0.10) })
  set('--muted-foreground', { l: s.mutedL, c: 0, h: 0 })
  set('--destructive', s.destructive)

  setRaw('--term-bg',      s.termBg)
  setRaw('--term-fg',      s.termFg)
  setRaw('--term-cursor',  s.termCursor)
  setRaw('--term-red',     s.termRed)
  setRaw('--term-green',   s.termGreen)
  setRaw('--term-yellow',  s.termYellow)
  setRaw('--term-blue',    s.termBlue)
  setRaw('--term-magenta', s.termMagenta)
  setRaw('--term-cyan',    s.termCyan)
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Slider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{value.toFixed(step >= 1 ? 0 : 2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full accent-primary cursor-pointer"
      />
    </div>
  )
}

function Swatch({ color, label }: { color: OklchColor; label?: string }) {
  return (
    <div className="flex flex-col items-center gap-1" style={{ flex: 1 }}>
      <div className="h-5 rounded-sm w-full" style={{ background: fmt(color) }} />
      {label && <span className="text-[10px] text-muted-foreground">{label}</span>}
    </div>
  )
}

function ColorSection({ label, color, onChange, showSwatch = true }: {
  label: string; color: OklchColor; onChange: (c: OklchColor) => void; showSwatch?: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        {showSwatch && <div className="h-4 w-8 rounded-sm" style={{ background: fmt(color) }} />}
      </div>
      <Slider label="Lightness" value={color.l} min={0.35} max={0.90} step={0.01}
        onChange={v => onChange({ ...color, l: v })} />
      <Slider label="Chroma" value={color.c} min={0} max={0.4} step={0.01}
        onChange={v => onChange({ ...color, c: v })} />
      <Slider label="Hue" value={color.h} min={0} max={359} step={1}
        onChange={v => onChange({ ...color, h: v })} />
    </div>
  )
}

function HexColorRow({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground flex-1">{label}</span>
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 rounded-sm border border-border shrink-0" style={{ background: value }} />
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="h-6 w-12 rounded cursor-pointer border-0 bg-transparent p-0"
        />
      </div>
    </div>
  )
}

function TermPreview({ s }: { s: Settings }) {
  return (
    <pre className="font-mono text-[11px] leading-relaxed rounded-md border border-border p-3 overflow-x-auto" style={{ background: s.termBg, color: s.termFg }}>
      <span style={{ color: s.termGreen }}>user@host</span><span style={{ color: s.termFg }}>:</span><span style={{ color: s.termBlue }}>~/projects</span><span style={{ color: s.termFg }}>$ </span><span>npm run dev</span>{'\n'}
      <span style={{ color: s.termCyan }}>&gt; quence-tn@0.1.0 dev</span>{'\n'}
      <span style={{ color: s.termYellow }}>warn</span><span style={{ color: s.termFg }}> - ready on http://localhost:3002</span>{'\n'}
      <span style={{ color: s.termRed }}>error</span><span style={{ color: s.termFg }}> - build failed</span>{'\n'}
      <span style={{ color: s.termMagenta }}>info</span><span style={{ color: s.termFg }}> - compiling...</span>{'\n'}
      <span style={{ color: s.termCursor }}>█</span>
    </pre>
  )
}

interface Props { open: boolean; onClose: () => void }

export function SettingsPanel({ open, onClose }: Props) {
  const [s, setS] = useState<Settings>(DEFAULTS)

  useEffect(() => {
    const loaded = load()
    setS(loaded)
    applySettings(loaded)
  }, [])

  const update = useCallback((updater: (prev: Settings) => Settings) => {
    setS(prev => {
      const next = clampSettings(updater(prev))
      applySettings(next)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  if (!open) return null

  const bg: OklchColor = { l: s.bgL, c: s.bgC, h: s.bgH }

  return (
    <div className="w-80 bg-card border-l border-border flex flex-col h-full shrink-0">

      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span className="text-sm font-medium">Appearance</span>
        <div className="flex items-center gap-2">
          <button onClick={() => update(() => DEFAULTS)}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded hover:bg-accent/20 transition-colors">
            Reset
          </button>
          <button onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-accent/20 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">

        {/* Accent */}
        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Accent Color</p>
          <div className="grid grid-cols-4 gap-2">
            {ACCENT_PRESETS.map(p => {
              const active = Math.abs(s.accent.h - p.h) < 6 && Math.abs(s.accent.c - p.c) < 0.05
              return (
                <button key={p.name} title={p.name}
                  onClick={() => update(prev => ({ ...prev, accent: { l: p.l, c: p.c, h: p.h } }))}
                  className="flex flex-col items-center gap-1">
                  <div className={`w-8 h-8 rounded-full transition-all ${active ? 'ring-2 ring-offset-2 ring-offset-card ring-foreground/80 scale-110' : 'hover:scale-110'}`}
                    style={{ background: `oklch(${p.l} ${p.c} ${p.h})` }} />
                  <span className="text-[10px] text-muted-foreground">{p.name}</span>
                </button>
              )
            })}
          </div>
          <ColorSection label="Custom accent" color={s.accent} showSwatch={false}
            onChange={c => update(prev => ({ ...prev, accent: c }))} />
          <Swatch color={s.accent} />
        </section>

        <div className="border-t border-border" />

        {/* Background */}
        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Background</p>
          <Slider label="Lightness" value={s.bgL} min={0.05} max={0.95} step={0.01}
            onChange={v => update(prev => ({ ...prev, bgL: v }))} />
          <Slider label="Chroma (tint)" value={s.bgC} min={0} max={0.08} step={0.005}
            onChange={v => update(prev => ({ ...prev, bgC: v }))} />
          <Slider label="Hue" value={s.bgH} min={0} max={359} step={1}
            onChange={v => update(prev => ({ ...prev, bgH: v }))} />
          <div className="flex gap-1.5">
            <Swatch color={bg} label="BG" />
            <Swatch color={{ ...bg, l: Math.min(1, bg.l + 0.04) }} label="Card" />
            <Swatch color={{ ...bg, l: Math.min(1, bg.l + 0.10) }} label="Secondary" />
            <Swatch color={{ ...bg, l: Math.min(1, bg.l + 0.14) }} label="Border" />
          </div>
        </section>

        <div className="border-t border-border" />

        {/* Text */}
        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Text</p>
          <Slider label="Text Brightness" value={s.fgL} min={0} max={1} step={0.01}
            onChange={v => update(prev => ({ ...prev, fgL: v }))} />
          <Slider label="Muted Text" value={s.mutedL} min={0} max={1} step={0.01}
            onChange={v => update(prev => ({ ...prev, mutedL: v }))} />
          <div className="flex gap-1.5">
            <Swatch color={{ l: s.fgL, c: 0, h: 0 }} label="Text" />
            <Swatch color={{ l: s.mutedL, c: 0, h: 0 }} label="Muted" />
          </div>
        </section>

        <div className="border-t border-border" />

        {/* Destructive */}
        <section className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Destructive / Error</p>
          <ColorSection label="" color={s.destructive} showSwatch={false}
            onChange={c => update(prev => ({ ...prev, destructive: c }))} />
          <Swatch color={s.destructive} />
        </section>

        <div className="border-t border-border" />

        {/* Terminal colors */}
        <section className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Terminal Colors</p>
          <TermPreview s={s} />
          <HexColorRow label="Background" value={s.termBg}
            onChange={v => update(prev => ({ ...prev, termBg: v }))} />
          <HexColorRow label="Foreground" value={s.termFg}
            onChange={v => update(prev => ({ ...prev, termFg: v }))} />
          <HexColorRow label="Cursor" value={s.termCursor}
            onChange={v => update(prev => ({ ...prev, termCursor: v }))} />
          <div className="border-t border-border pt-3 space-y-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">ANSI Colors</p>
            <HexColorRow label="Red" value={s.termRed}
              onChange={v => update(prev => ({ ...prev, termRed: v }))} />
            <HexColorRow label="Green" value={s.termGreen}
              onChange={v => update(prev => ({ ...prev, termGreen: v }))} />
            <HexColorRow label="Yellow" value={s.termYellow}
              onChange={v => update(prev => ({ ...prev, termYellow: v }))} />
            <HexColorRow label="Blue" value={s.termBlue}
              onChange={v => update(prev => ({ ...prev, termBlue: v }))} />
            <HexColorRow label="Magenta" value={s.termMagenta}
              onChange={v => update(prev => ({ ...prev, termMagenta: v }))} />
            <HexColorRow label="Cyan" value={s.termCyan}
              onChange={v => update(prev => ({ ...prev, termCyan: v }))} />
          </div>
        </section>

      </div>
    </div>
  )
}
