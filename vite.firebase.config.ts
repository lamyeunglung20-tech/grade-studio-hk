import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "mobile",
  publicDir: "../public",
  plugins: [react()],
  build: { outDir: "../firebase-dist", emptyOutDir: true },
});
