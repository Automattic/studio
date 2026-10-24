# lib/markdown

Rendering for code and, later, Markdown that isn't tied to the chat.

**Belongs here:** `CodeBlock`, which highlights a snippet with Shiki in the current color scheme. **Doesn't:** the chat's Markdown renderer, which stays in `features/chats` while it opens links through the connector and adds the chat's copy and context-menu hooks.

## API

```tsx
import { CodeBlock } from '@/lib/markdown';

<CodeBlock code={ snippet } language="json" />;
```

`children` render above the code, for a header or a copy button.

## Constraints

- Shiki loads lazily on first render, with a fixed set of languages (`code-block/highlight.ts`). Add a language there.
- No imports from the app (lint-enforced).
