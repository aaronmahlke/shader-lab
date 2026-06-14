import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import glsl from "vite-plugin-glsl";

const coreSrc = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/core/src");

export default defineNuxtConfig({
  devtools: { enabled: false },
  css: ["~/assets/css/app.css"],
  compatibilityDate: "latest",
  ssr: true,
  future: { compatibilityVersion: 4 },
  fonts: { experimental: { disableLocalFallbacks: true } },
  build: {
    transpile: ["@shader-lab/core"],
  },
  vite: {
    plugins: [tailwindcss(), glsl()],
    resolve: {
      alias: {
        "@shader-lab/core/server": resolve(coreSrc, "server.ts"),
        "@shader-lab/core": resolve(coreSrc, "index.ts"),
      },
    },
    optimizeDeps: {
      include: ["@heroicons/vue/16/solid"],
      exclude: ["@shader-lab/core", "@shader-lab/core/server"],
    },
    ssr: {
      noExternal: ["@shader-lab/core"],
    },
  },
  nitro: {
    externals: {
      external: ["gl", "@napi-rs/canvas"],
    },
    rollupConfig: {
      plugins: [glsl()],
    },
  },
  app: {
    head: {
      title: "Shader Lab",
      link: [
        { rel: "icon", type: "image/png", href: "/favicon.png" },
      ],
      meta: [
        { name: "description", content: "Shader experiments playground" },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "Shader Lab" },
        { property: "og:url", content: "https://shader.zeitwork.com" },
        { name: "twitter:site", content: "@zeitwork" },
      ],
    },
  },
  modules: ["@nuxt/fonts", "nuxt-auth-utils"],
  runtimeConfig: {
    oauth: {
      google: {
        clientId: "",
        clientSecret: "",
      },
    },
    aws: {
      region: "us-east-1",
      accessKeyId: "",
      secretAccessKey: "",
      s3Bucket: "shader-lab",
      s3Endpoint: "",
    },
  },
});
