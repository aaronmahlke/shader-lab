import tailwindcss from "@tailwindcss/vite";
import glsl from "vite-plugin-glsl";

export default defineNuxtConfig({
  devtools: { enabled: false },
  css: ["~/assets/css/app.css"],
  compatibilityDate: "latest",
  ssr: true,
  future: { compatibilityVersion: 4 },
  fonts: { experimental: { disableLocalFallbacks: true } },
  vite: {
    plugins: [tailwindcss(), glsl()],
    optimizeDeps: {
      include: ["@heroicons/vue/16/solid"],
    },
  },
  nitro: {
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
