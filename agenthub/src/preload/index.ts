import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

type BridgeStatus = 'connecting' | 'connected' | 'disconnected'
interface BridgeRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
}
interface BridgeResponse {
  status: number
  body: unknown
}
interface BridgeEventFrame {
  type: string
  conversationId?: string
  data?: unknown
}

// Custom APIs for renderer
const api = {
  backend: {
    status: (): Promise<{ ok: boolean; status?: string }> => ipcRenderer.invoke('backend:status'),
    restart: (): Promise<'already-running' | 'spawned' | 'failed'> =>
      ipcRenderer.invoke('backend:restart')
  },
  dialog: {
    selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDirectory'),
    selectFile: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:selectFile', defaultPath)
  },
  titlebar: {
    setTheme: (dark: boolean): void => ipcRenderer.send('titlebar:theme', dark)
  }
}

// 进程内桥：取代本地 HTTP/WebSocket，统一经主进程的 stdio 桥与 Python 通信
const bridge = {
  request: (req: BridgeRequest): Promise<BridgeResponse> =>
    ipcRenderer.invoke('bridge:request', req),
  sendMessage: (payload: {
    conversationId: string
    content: string
    targetAgent?: string
    attachments?: { type: 'image'; url: string; filename?: string }[]
  }): Promise<BridgeResponse> => ipcRenderer.invoke('bridge:sendMessage', payload),
  getStatus: (): Promise<BridgeStatus> => ipcRenderer.invoke('bridge:status'),
  getError: (): Promise<string | null> => ipcRenderer.invoke('bridge:getError'),
  onEvent: (cb: (frame: BridgeEventFrame) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, frame: BridgeEventFrame): void => cb(frame)
    ipcRenderer.on('bridge:event', listener)
    return () => ipcRenderer.removeListener('bridge:event', listener)
  },
  onStatus: (cb: (status: BridgeStatus) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, status: BridgeStatus): void => cb(status)
    ipcRenderer.on('bridge:status', listener)
    return () => ipcRenderer.removeListener('bridge:status', listener)
  },
  onError: (cb: (reason: string) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, reason: string): void => cb(reason)
    ipcRenderer.on('bridge:error', listener)
    return () => ipcRenderer.removeListener('bridge:error', listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('bridge', bridge)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
  // @ts-ignore (define in dts)
  window.bridge = bridge
}
