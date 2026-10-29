# Digest preview

The export command runs the app through an ephemeral localhost Hono Node server, fetches
`/digest/2026-10-28`, checks for a successful HTML response, and writes one self-contained
`index.html`:

```sh
pnpm preview:export -- --out-dir /tmp/digest-preview
```

`.env` is ignored by git. For a local marked export, set `LANE_MARKER` in the process environment;
the command never prints the marker or the rendered page.

The `.github/workflows/digest-preview.yml` workflow has only a manual `workflow_dispatch` trigger.
Do not run it until a human has approved public publication and reviewer submission. Before the
first approved run, configure GitHub Pages to use GitHub Actions as its source and add the
approved marker as the repository Actions secret `LANE_MARKER`. Dispatch with `include_marker`
enabled for the review copy. The workflow removes its downloadable Pages artifact after a
successful deployment.

After the reviewer has completed the review, dispatch the same workflow with `include_marker`
disabled. It leaves `LANE_MARKER` unset for export, so the same Pages URL is replaced by the
unmarked page. Keep the workflow's Actions permissions limited to the permissions declared in the
workflow; `actions: write` is used only to delete the deployment artifact.
