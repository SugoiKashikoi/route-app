import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages のサブパス(/リポジトリ名/)でも動くよう相対パスで出力する
export default defineConfig({
  base: "./",
  plugins: [react()],
});
