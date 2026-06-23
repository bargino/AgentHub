import { createContext } from 'react'

/** 嵌入态：页面渲染在右侧工作区 dock 内（由 RightDock 提供），跳过自带会话头，
 *  改用一条精简操作条承载页面动作，避免与会话头/ dock 标签条重复。 */
export const PageShellEmbeddedContext = createContext(false)
