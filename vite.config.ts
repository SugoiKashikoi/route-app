import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages のサブパス(/リポジトリ名/)でも動くよう相対パスで出力する
export default defineConfig({
  base: "./",
  plugins: [react()],
  // 画面に出す版(日本時間のビルド日時)。iPhoneで古いページが残っていないか確かめるため
  define: {
    __BUILD__: JSON.stringify(
      new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    ),
  },
});
