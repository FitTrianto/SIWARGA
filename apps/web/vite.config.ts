import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Base path saat deploy di sub-path (GitHub Pages `/<nama-repo>/`).
  // Workflow Pages mengeset `VITE_BASE=/SIWARGA/`; build lokal memakai default "/".
  base: process.env.VITE_BASE || "/",
  server: {
    // Semua `/api` diteruskan ke backend Fastify (127.0.0.1:3000) lewat proxy
    // sehingga FE & API satu origin → cookie `sid` (httpOnly) dan `csrf_token`
    // terkirim otomatis, tanpa CORS. Bila backend mati, proxy menjawab bukan
    // JSON → klien API mengembalikan galat `OFFLINE` (mode demo).
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false,
      },
    },
  },
});
