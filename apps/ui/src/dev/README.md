# Playground pages

Development pages that render real components with sample data on the in-memory connector, with no Studio backend, so you can iterate on a design without driving the app into each state. They are Vite entries outside the Desktop and `studio ui` builds.

```bash
npm -w @studio/ui run playground
```

It opens http://localhost:5300, which links to each page:

- `/chat.html`: the chat transcript in every state: Markdown, tool calls with results, diffs and errors, a running turn, streaming, pending and answered questions, the image picker, screenshots, annotations and the error markers. Samples are in `chat-samples.ts`.
- `/animation.html`: the preview loading animation, active, still, easing and the selection wave.

Each page shows light and dark side by side, or one scheme from the header. To add a page, add `<name>.html` next to `index.html`, an entry here that imports the theme CSS first and calls `renderPlayground`, a link in `playground.html`, and the entry to `knip.json`.

- `/annotate-tip.html`: accent feature announcements and a two-step walkthrough, with optional badges and footer actions in light and dark. Use `?side=top|right|bottom|left` to check directional motion.
- `/update-preview.html`: app update failure, dismissal, retry, download, and restart states. Use `?scheme=dark` for dark mode, `?result=error` for a failed retry, or `?state=ready` to start with a downloaded update.
- `/email-preview.html`: the email log loading skeleton, empty state, multiple selectable sample emails, and loading error. Use `?state=skeleton`, `?state=empty`, `?state=multiple`, or `?state=error` to start in a particular state.
- `/sidebar-preview.html`: the real app shell with its sidebar held in loading. Use the links to switch to loaded rows or between light and dark mode.
  Add `&rows=30` for a scrolling sidebar or `&chat=long` for a sample conversation.
- `/walkthrough.html`: the Getting started flow in the actual app with sample data. Use `?stage=options` for the existing-site introduction, `?stage=workspace` for the composer, `&scheme=dark` for dark mode, `&host=browser` to omit annotation controls, `&account=connected` for WordPress.com, or `&provider=anthropic` for an API key. Reload to restart.
  Use `&site=running` to check that guidance pauses while annotating. Composer branches are available with `&credits=empty` or `&gate=payment|access|access-returning|blocked|offline|provider-error|quota-error` (WordPress.com gates require `&account=connected`).

Replay the walkthrough with **Take a tour** in Help (Desktop) or command search. Searching **Getting started** or **Walkthrough** also finds it. **Reset tips** restores contextual hints without starting the tour or navigating away. Both preserve Welcome, account setup, What’s New, and interface preferences.
