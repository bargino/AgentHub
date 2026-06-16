import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    // sandbox: true 下 preload 运行在沙箱中、无法 require node_modules，
    // 因此排除 @electron-toolkit/preload，让其被打包进 out/preload/index.js
    plugins: [externalizeDepsPlugin({ exclude: ['@electron-toolkit/preload'] })]
  },
  renderer: {
    resolve: {
      // node_modules 经 junction/符号链接共享自其他目录时，不解析到真实目标路径，
      // 保持模块停留在项目内，避免 dev server 因 fs.allow 拒绝（白屏 403）
      preserveSymlinks: true,
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    server: {
      fs: {
        // 兜底：即便仍命中符号链接目标，也放行 dev server 文件服务（仅开发期生效）
        strict: false
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
