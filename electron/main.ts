import { app, BrowserWindow, ipcMain } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as pty from 'node-pty'
import * as os from 'os'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pidusage = require('pidusage') as (pids: number | number[]) => Promise<Record<number, { cpu: number; memory: number }>>
import serve from 'electron-serve'
import { autoUpdater } from 'electron-updater'

// Swallow EPIPE errors from node-pty ConPTY pipe teardown
process.on('uncaughtException', (err: any) => {
  if (err?.code === 'EPIPE') return
  throw err
})

const isProd = app.isPackaged || process.env.NODE_ENV === 'production'

if (isProd) {
  serve({ directory: 'out' })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

let mainWindow: BrowserWindow | null = null

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): { width: number; height: number; x?: number; y?: number; isMaximized?: boolean } {
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return { width: 1200, height: 800 }
  }
}

function saveWindowState() {
  if (!mainWindow) return
  try {
    const isMaximized = mainWindow.isMaximized()
    let bounds: { width: number; height: number; x?: number; y?: number; isMaximized?: boolean } = { width: 1200, height: 800 }
    try {
      const raw = fs.readFileSync(getWindowStatePath(), 'utf-8')
      bounds = JSON.parse(raw)
    } catch {}
    if (!isMaximized) {
      const currentBounds = mainWindow.getBounds()
      bounds.x = currentBounds.x
      bounds.y = currentBounds.y
      bounds.width = currentBounds.width
      bounds.height = currentBounds.height
    }
    bounds.isMaximized = isMaximized
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(bounds))
  } catch {}
}

async function createWindow() {
  const windowState = loadWindowState()
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    show: false,
    icon: path.join(__dirname, '..', 'public', process.platform === 'win32' ? 'logo.ico' : 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (windowState.isMaximized) mainWindow.maximize()
  mainWindow.show()

  if (isProd) {
    await mainWindow.loadURL('app://-')
  } else {
    const port = process.argv[2] || 3000
    mainWindow.webContents.session.webRequest.onBeforeRequest(
      { urls: ['ws://_next/*', 'wss://_next/*'] },
      (details, callback) => {
        callback({
          redirectURL: details.url.replace(
            /^wss?:\/\/_next\//,
            `ws://localhost:${port}/_next/`
          ),
        })
      }
    )
    await mainWindow.loadURL(`http://localhost:${port}`)
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F12') {
      if (!isProd) mainWindow!.webContents.toggleDevTools()
      event.preventDefault()
    } else if ((input.control || input.meta) && (input.key === '=' || input.key === '+')) {
      mainWindow!.webContents.setZoomLevel(mainWindow!.webContents.getZoomLevel() + 0.5)
      event.preventDefault()
    } else if ((input.control || input.meta) && input.key === '-') {
      mainWindow!.webContents.setZoomLevel(mainWindow!.webContents.getZoomLevel() - 0.5)
      event.preventDefault()
    } else if ((input.control || input.meta) && input.key === '0') {
      mainWindow!.webContents.setZoomLevel(0)
      event.preventDefault()
    }
  })

  mainWindow.webContents.on('will-reload' as any, (event: Electron.Event) => {
    event.preventDefault()
  })

  mainWindow.on('resize', saveWindowState)
  mainWindow.on('move', saveWindowState)
  mainWindow.on('closed', () => {
    saveWindowState()
    mainWindow = null
  })
}

app.on('ready', () => {
  createWindow()

  ipcMain.on('window-minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  ipcMain.on('window-maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.on('window-close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.on('window-zoom-in', () => {
    mainWindow?.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5)
  })
  ipcMain.on('window-zoom-out', () => {
    mainWindow?.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5)
  })

  // ── Terminal ────────────────────────────────────────────────────────────────
  const termProcesses = new Map<string, pty.IPty>()
  const termAlive = new Map<string, boolean>()
  const termResizeReady = new Map<string, boolean>()
  const termPopouts = new Map<string, BrowserWindow>()

  function destroyTerm(id: string) {
    if (!termAlive.get(id)) return
    termAlive.set(id, false)
    termResizeReady.delete(id)
    const proc = termProcesses.get(id)
    if (proc) {
      const origWrite = process.stderr.write.bind(process.stderr) as typeof process.stderr.write
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(process.stderr as any).write = (chunk: string | Uint8Array, ...rest: any[]) => {
        const s = typeof chunk === 'string' ? chunk : chunk.toString()
        if (s.includes('AttachConsole') || s.includes('conpty_console_list')) return true
        return origWrite(chunk, ...rest)
      }
      try { proc.kill() } catch {}
      termProcesses.delete(id)
      setTimeout(() => { process.stderr.write = origWrite }, 500)
    }
  }

  function sendToTerm(id: string, data: string) {
    const popout = termPopouts.get(id)
    if (popout && !popout.isDestroyed()) {
      popout.webContents.send(`pty:data:${id}`, data)
      return
    }
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(`pty:data:${id}`, data)
  }

  ipcMain.handle('pty:create', (_e, { id, cols, rows, cwd }: { id: string; cols: number; rows: number; cwd?: string }) => {
    if (termAlive.get(id) && termProcesses.has(id)) return { ok: true, reattached: true }
    destroyTerm(id)

    const isWin = process.platform === 'win32'
    const shell = isWin ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL ?? 'bash')
    const args = isWin ? ['/K'] : []
    const env = { ...process.env } as Record<string, string>
    delete env['TERM']

    let proc: pty.IPty
    try {
      proc = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: Math.max(cols || 80, 1),
        rows: Math.max(rows || 24, 1),
        cwd: cwd || os.homedir(),
        env,
        useConpty: true,
      })
    } catch (e: any) {
      sendToTerm(id, `\r\n\x1b[31m[failed to start terminal: ${e.message}]\x1b[0m\r\n`)
      return { ok: false, error: e.message }
    }

    termProcesses.set(id, proc)
    termAlive.set(id, true)
    setTimeout(() => { if (termAlive.get(id)) termResizeReady.set(id, true) }, 1000)

    proc.onData(data => {
      if (!termAlive.get(id)) return
      sendToTerm(id, data)
    })

    proc.onExit(() => {
      sendToTerm(id, `\r\n\x1b[90m[process exited]\x1b[0m\r\n`)
      const popout = termPopouts.get(id)
      if (popout && !popout.isDestroyed()) popout.webContents.send(`pty:exit:${id}`)
      else if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(`pty:exit:${id}`)
      termAlive.delete(id)
      termResizeReady.delete(id)
      termProcesses.delete(id)
    })

    return { ok: true }
  })

  ipcMain.on('pty:write', (_e, { id, data }: { id: string; data: string }) => {
    if (!termAlive.get(id)) return
    try { termProcesses.get(id)?.write(data) } catch {}
  })

  ipcMain.on('pty:resize', (_e, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    if (!termAlive.get(id) || !termResizeReady.get(id)) return
    try { termProcesses.get(id)?.resize(Math.max(cols, 1), Math.max(rows, 1)) } catch {}
  })

  ipcMain.on('pty:ready', () => {})

  ipcMain.handle('pty:kill', (_e, { id }: { id: string }) => {
    destroyTerm(id)
    return { ok: true }
  })

  ipcMain.on('pty:popin', (_e, { id }: { id: string }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:popin', id)
      mainWindow.focus()
    }
    const popout = termPopouts.get(id)
    if (popout && !popout.isDestroyed()) popout.close()
  })

  ipcMain.handle('pty:popout', async (_e, { id, title }: { id: string; title: string }) => {
    const existing = termPopouts.get(id)
    if (existing && !existing.isDestroyed()) { existing.focus(); return { ok: true } }

    const win = new BrowserWindow({
      width: 800,
      height: 500,
      minWidth: 400,
      minHeight: 200,
      title,
      frame: false,
      show: false,
      icon: path.join(__dirname, '..', 'public', process.platform === 'win32' ? 'logo.ico' : 'logo.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    termPopouts.set(id, win)
    win.on('closed', () => {
      termPopouts.delete(id)
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pty:popout-closed', id)
      }
    })

    if (isProd) {
      await win.loadURL(`app://-/terminal?id=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}`)
    } else {
      const port = process.argv[2] || 3000
      await win.loadURL(`http://localhost:${port}/terminal?id=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}`)
    }

    win.show()
    return { ok: true }
  })

  ipcMain.handle('pty:homedir', () => os.homedir())

  ipcMain.handle('pty:stats', async (_e, { ids }: { ids: string[] }) => {
    const pids = ids.map(id => termProcesses.get(id)?.pid).filter((p): p is number => p != null)
    if (pids.length === 0) return {}
    try {
      const stats = await pidusage(pids)
      const result: Record<string, { cpu: number; memory: number }> = {}
      for (const id of ids) {
        const pid = termProcesses.get(id)?.pid
        if (pid != null && stats[pid]) {
          result[id] = { cpu: stats[pid].cpu, memory: stats[pid].memory }
        }
      }
      return result
    } catch {
      return {}
    }
  })

  app.on('before-quit', () => {
    for (const id of [...termProcesses.keys()]) destroyTerm(id)
    termProcesses.clear()
    termAlive.clear()
    termResizeReady.clear()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Auto-updater — only runs in production builds
if (isProd) {
  const logFile = fs.createWriteStream(path.join(app.getPath('userData'), 'updater.log'), { flags: 'a' })
  const log = {
    info:  (...a: unknown[]) => { const msg = `[${new Date().toISOString()}] INFO  ${a.join(' ')}\n`; logFile.write(msg); console.log(msg.trimEnd()) },
    warn:  (...a: unknown[]) => { const msg = `[${new Date().toISOString()}] WARN  ${a.join(' ')}\n`; logFile.write(msg); console.warn(msg.trimEnd()) },
    error: (...a: unknown[]) => { const msg = `[${new Date().toISOString()}] ERROR ${a.join(' ')}\n`; logFile.write(msg); console.error(msg.trimEnd()) },
  }
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Marijanoo',
    repo: 'quence-tn',
  })

  autoUpdater.on('update-available', (info) => {
    log.info('[updater] Update available:', info.version)
    mainWindow?.webContents.send('update-available')
  })
  autoUpdater.on('update-not-available', (info) => {
    log.info('[updater] Already up to date:', info.version)
  })
  autoUpdater.on('download-progress', (info) => {
    log.info(`[updater] Downloading… ${info.percent.toFixed(1)}%`)
    mainWindow?.webContents.send('update-progress', info.percent)
  })
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] Downloaded:', info.version)
    mainWindow?.webContents.send('update-downloaded')
  })
  autoUpdater.on('error', (err) => {
    log.error('[updater] Error:', err?.message ?? err)
  })

  process.on('unhandledRejection', () => {})

  ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall(true, false)
  })

  app.on('browser-window-created', (_, win) => {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000)
      setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000)
    })
  })
}

app.on('activate', () => {
  if (mainWindow === null) createWindow()
})
