// node --test apps/web/tests/project-components.test.mjs (Node 22.15+)
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { compileProjectComponent, listProjectComponents } from "../server/utils/project-components.ts";

const parent = spec => '<script setup>\nimport Child from "' + spec + '"\n</script>\n<template><Child /></template>';
async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), "stage-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await mkdir(join(folder, "components/helpers"), { recursive: true });
  return { folder, write: (file, source) => writeFile(join(folder, "components", file), source) };
}

test("loads a relative child and its sibling through the stage runtime", async t => {
  const { folder, write } = await fixture(t);
  await write("Scene.vue", parent("./helpers/Activity.vue"));
  await write("helpers/Activity.vue", parent("./Label.vue"));
  await write("helpers/Label.vue", '<template><b>Working</b></template><style scoped>b { color: red }</style>');
  const list = await listProjectComponents(folder);
  assert.deepEqual(list.map(v => v.name), ["Scene"]);
  const graph = await compileProjectComponent(folder, "Scene");
  // Stand in for Nuxt's fetch, alias resolver, and the document style container.
  const hooks = registerHooks({ resolve(spec, context, next) {
    if (spec.startsWith("~/")) return next(new URL("../app/" + spec.slice(2) + ".ts", import.meta.url).href, context);
    return next(spec, context);
  }});
  t.after(() => hooks.deregister());
  // Tailwind's virtual theme module requires Nuxt; only assert scoped SFC CSS here.
  for (const mod of graph.modules) mod.candidates = [];
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected network access"); });
  globalThis.$fetch = async path => path.endsWith("/components") ? list : graph;
  const styles = [];
  globalThis.document = { getElementById: () => null, createElement: () => ({}), head: { appendChild: el => styles.push(el) } };
  t.after(() => { delete globalThis.$fetch; delete globalThis.document; });
  const api = await import("../app/utils/project-components.ts");
  await api.loadProjectComponents("demo");
  const scene = await api.loadProjectComponent("Scene");
  assert.match(await renderToString(createSSRApp(scene.default)), /<b data-v-[\da-f]+>Working<\/b>/);
  assert.ok(styles.some(s => /b\[data-v-/.test(s.textContent)));
  await write("helpers/Label.vue", "<template>Changed</template>");
  assert.notEqual((await listProjectComponents(folder))[0].version, list[0].version);
});

test("rejects imports outside components, symlinks, missing children and cycles", async t => {
  const { folder, write } = await fixture(t);
  await writeFile(join(folder, "Outside.vue"), "<template>Outside</template>");
  await symlink(join(folder, "Outside.vue"), join(folder, "components/Link.vue"));
  for (const [spec, error] of [["../Outside.vue", /invalid local/], ["./Link.vue", /Symlinked/],
    ["./Scene.vue", /Circular/], ["./Missing.vue", /cannot find/]]) {
    await write("Scene.vue", parent(spec));
    await assert.rejects(compileProjectComponent(folder, "Scene"), error);
  }
  assert.equal(await compileProjectComponent(folder, "../Outside"), null);
});
