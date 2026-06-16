import { ElectronAPI } from '@electron-toolkit/preload'

export interface BackendApi {
  status: () => Promise<{ ok: boolean; status?: string }>
  restart: () => Promise<'already-running' | 'spawned' | 'failed'>
}

export interface DialogApi {
  selectDirectory: () => Promise<string | null>
  selectFile: (defaultPath?: string) => Promise<string | null>
}

export interface TitlebarApi {
  setTheme: (dark: boolean) => void
}

export type BridgeStatus = 'connecting' | 'connected' | 'disconnected'

export interface BridgeRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
}

export interface BridgeResponse {
  status: number
  body: unknown
}

export interface BridgeEventFrame {
  type: string
  conversationId?: string
  data?: unknown
}

export interface BridgeApi {
  request: (req: BridgeRequest) => Promise<BridgeResponse>
  sendMessage: (payload: {
    conversationId: string
    content: string
    targetAgent?: string
    attachments?: { type: 'image'; url: string; filename?: string }[]
  }) => Promise<BridgeResponse>
  getStatus: () => Promise<BridgeStatus>
  getError: () => Promise<string | null>
  onEvent: (cb: (frame: BridgeEventFrame) => void) => () => void
  onStatus: (cb: (status: BridgeStatus) => void) => () => void
  onError: (cb: (reason: string) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      backend: BackendApi
      dialog: DialogApi
      titlebar: TitlebarApi
    }
    bridge: BridgeApi
  }
}
