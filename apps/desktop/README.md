# Shader Lab desktop

Electron shell around the editor in **local mode**: projects are folders on
disk, no database, no login.

```
my-video/
  shaderlab.json      project manifest (name, compositions)
  comps/<name>.json   one composition each (readable, diffable, agent-editable)
  assets/             imported images / video
  components/         your own stage components (coming next)
  .shaderlab/         caches (thumbnails), gitignored
```

## Run

```bash
bun run build           # build the editor once
bun run desktop         # app starts its own local server
```

Development (hot reload):

```bash
bun run dev:local       # editor in local mode on :3000
bun run desktop:dev     # Electron pointed at it
```

Recent projects live in `~/.shaderlab/projects.json` (`SHADERLAB_HOME` to
override). Removing a project from the list never deletes its folder.

`SHADERLAB_SCREENSHOT=out.png` saves a screenshot of the window after load.
