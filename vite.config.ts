import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { z } from "zod";

const configuredBasePath = z
  .string()
  .regex(/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/)
  .parse(process.env.VITE_BASE_PATH ?? "/");
const basePath = configuredBasePath.endsWith("/")
  ? configuredBasePath
  : configuredBasePath + "/";

export default defineConfig({
  base: basePath,
  plugins: [vue(), tailwindcss()],
});
