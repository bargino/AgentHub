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

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      backend: BackendApi
      dialog: DialogApi
      titlebar: TitlebarApi
    }
  }
}
