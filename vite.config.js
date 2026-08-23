import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // 打包成桌面应用后，页面是用 file:// 协议直接打开 dist/index.html 的，不是网页服务器；
  // 不设 base 时 Vite 默认按网站根目录 "/" 生成资源路径（如 /assets/xxx.js），
  // file:// 协议下会被当成"整个硬盘根目录"去找，找不到文件，页面就是一片空白。
  // 改成 "./"，资源路径变成相对路径，双击打开 index.html 也能正确找到同目录下的 assets。
  base: "./",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
