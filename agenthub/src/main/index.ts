import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  bridgeRequest,
  bridgeSendMessage,
  getBridgeError,
  getBridgeStatus,
  restartBridge,
  startBridge,
  stopBridge,
  type BridgeRequest
} from './bridge'

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
}

const DEFAULT_WINDOW_STATE: WindowState = { width: 1200, height: 780 }

function windowStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): WindowState {
  try {
    const parsed = JSON.parse(readFileSync(windowStatePath(), 'utf-8')) as Partial<WindowState>
    if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
      return {
        width: parsed.width,
        height: parsed.height,
        ...(typeof parsed.x === 'number' && typeof parsed.y === 'number'
          ? { x: parsed.x, y: parsed.y }
          : {})
      }
    }
  } catch {
    // 文件不存在或内容损坏时回退默认尺寸
  }
  return { ...DEFAULT_WINDOW_STATE }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const { width, height, x, y } = win.getBounds()
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(windowStatePath(), JSON.stringify({ width, height, x, y }))
  } catch (err) {
    console.error('[window-state] failed to save:', err)
  }
}

function createWindow(): void {
  const state = loadWindowState()

  // Create the browser window.
  // frameless 一体化标题栏：Win 用系统 titleBarOverlay 绘制窗口控制键，
  // mac 用 hidden 保留 traffic lights，Linux 不支持 overlay 保持系统标题栏
  // 亚克力 / 云母半透材质：Win11 用 mica，macOS 用 vibrancy；
  // 背景设为全透明，让标题栏 + 左侧导航等半透明区域透出系统材质（不支持的平台自动降级为不透明）。
  const surfaceOptions =
    process.platform === 'win32'
      ? { backgroundColor: '#00000000', backgroundMaterial: 'mica' as const }
      : process.platform === 'darwin'
        ? {
            backgroundColor: '#00000000',
            vibrancy: 'under-window' as const,
            visualEffectState: 'active' as const
          }
        : {}

  const mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...surfaceOptions,
    ...(process.platform === 'linux'
      ? { icon }
      : {
          titleBarStyle: 'hidden' as const,
          ...(process.platform === 'win32'
            ? {
                titleBarOverlay: {
                  color: '#00000000',
                  symbolColor: '#1f1f1f',
                  height: 40
                }
              }
            : {})
        }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 桥模式下渲染层不再发起跨域 fetch（全走主进程 stdio 桥），
      // 因此恢复同源策略并开启沙箱，缩小不可信内容（Markdown 链接/预览 iframe）的攻击面
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', () => {
    saveWindowState(mainWindow)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // 主题切换时联动 Windows 标题栏 overlay 配色（其余平台 no-op）
  ipcMain.on('titlebar:theme', (_event, dark: boolean) => {
    if (process.platform !== 'win32') return
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.setTitleBarOverlay({
          color: '#00000000',
          symbolColor: dark ? '#e0e0e0' : '#1f1f1f',
          height: 40
        })
      } catch {
        // 非 overlay 窗口（如 Linux）忽略
      }
    }
  })

  // 兼容旧 IPC：后端状态/重启改由 stdio 桥承载
  ipcMain.handle('backend:status', () => ({
    ok: getBridgeStatus() === 'connected',
    status: getBridgeStatus()
  }))
  ipcMain.handle('backend:restart', async () => {
    await restartBridge()
    return getBridgeStatus() === 'connected' ? 'spawned' : 'failed'
  })

  // 进程内桥：渲染层请求 / 发送消息 / 状态查询
  ipcMain.handle('bridge:request', (_event, req: BridgeRequest) => bridgeRequest(req))
  ipcMain.handle('bridge:sendMessage', (_event, payload: unknown) => bridgeSendMessage(payload))
  ipcMain.handle('bridge:status', () => getBridgeStatus())
  ipcMain.handle('bridge:getError', () => getBridgeError())
  ipcMain.handle('dialog:selectDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: '选择项目文件夹'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
  ipcMain.handle('dialog:selectFile', async (_event, defaultPath?: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      title: '引用文件',
      ...(defaultPath ? { defaultPath } : {})
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // 尽早 spawn 桥（conda 解析有延迟），不阻塞窗口创建；
  // 就绪状态经 bridge:status 推送给 renderer
  startBridge().catch((err) => console.error('[bridge] startBridge error:', err))

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  stopBridge()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
