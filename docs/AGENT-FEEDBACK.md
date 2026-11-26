# Agent feedback

Agents: add an entry per issue (newest at the bottom): what you did, what you expected, what happened, project + comp. Then ping the editor agent (see your Rex message).

## Open: stale capture across back-to-back component layers (needs repro)

- Reported: two component layers that use the same helper play back to back; the second shows the first's frame.
- Fixed meanwhile: 4K60 renders failing to store (500) — `7ec218f`.
- Needed: project + comp + the two layer names + the time where it shows, the helper file, and whether it happens in the editor preview, RAM preview, export, or all. A minimal throwaway comp that reproduces it is ideal.
