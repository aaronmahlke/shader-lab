import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import glsl from "vite-plugin-glsl";

const coreSrc = resolve(dirname(fileURLToPath(import.meta.url)), "../../packages/core/src");

// Dokedu UI (tokens, Tailwind, fonts, d-* components) as a Nuxt layer.
// Linked to the local checkout while we design; switch to the pinned git
// dependency later: "@dokedu/ui": "github:dokedu/ui#<tag>" + extends: ["@dokedu/ui"].
const dokeduUi = process.env.DOKEDU_UI ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../../dokedu/ui");

export default defineNuxtConfig({
  extends: [dokeduUi],
  // We import the kit's CSS ourselves so app tokens share one Tailwind pass.
  dokeduUi: { css: false },
  devtools: { enabled: false },
  css: ["~/assets/css/app.css"],
  compatibilityDate: "latest",
  ssr: true,
  routeRules: {
    // The dashboard is behind login anyway; serving it as an SPA shell makes
    // GET / return 200 for anonymous requests (platform healthchecks probe /
    // and only accept 2xx — the SSR auth redirect was a 302). The auth
    // middleware still redirects logged-out visitors client-side.
    "/": { ssr: false },
  },
  future: { compatibilityVersion: 4 },
  fonts: { experimental: { disableLocalFallbacks: true } },
  build: {
    transpile: ["@shader-lab/core"],
  },
  vite: {
    plugins: [glsl()],
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
  modules: ["nuxt-auth-utils"],
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
