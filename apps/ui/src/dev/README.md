# Playground pages

Development pages that render real components with sample data on the in-memory connector, with no Studio backend, so you can iterate on a design without driving the app into each state. They are Vite entries outside the Desktop and `studio ui` builds.

```bash
npm -w @studio/ui run playground
```

It opens http://localhost:5300, which links to each page:

- `/chat.html`: the chat transcript in every state: Markdown, tool calls with results, diffs and errors, a running turn, streaming, pending and answered questions, the image picker, screenshots, annotations and the error markers. Samples are in `chat-samples.ts`.
- `/animation.html`: the preview loading animation, active, still, easing and the selection wave.
- `/notices.html`: the current notice copy rendered with the shared notice card and timestamp components, grouped by product area. `notice-review.json` is the reviewed copy inventory; update it alongside notice wording. The inventory keeps runtime tokens; `previewText` renders them as realistic fictional values for review. Synthetic stress cases and unknown raw errors are omitted. Filter by copy/action and compare 240/320/420px widths. Actions are inert. Inline form/composer alerts are outside this catalog.

Each page shows light and dark side by side, or one scheme from the header. To add a page, add `<name>.html` next to `index.html`, an entry here that imports the theme CSS first and calls `renderPlayground`, a link in `playground.html`, and the entry to `knip.json`.
