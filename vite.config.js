import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    proxy: {
      "/github-auth/device-code": {
        target: "https://github.com",
        changeOrigin: true,
        secure: true,
        rewrite: () => "/login/device/code"
      },
      "/github-auth/access-token": {
        target: "https://github.com",
        changeOrigin: true,
        secure: true,
        rewrite: () => "/login/oauth/access_token"
      }
    }
  }
});
