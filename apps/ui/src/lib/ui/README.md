# lib/ui

The UI primitives: Button, IconButton, Dialog, Menu, Popover, Select, Field, Tooltip and the rest, built on Base UI and styled after the rebuild's kit. Also small app-agnostic components that several features use: CodeBlock (Shiki highlighting in the current color scheme) and ResizeHandle.

**Belongs here:** a control or visual that knows nothing about Studio. **Doesn't:** anything that reads data, calls the connector, or knows about sites, chats or notices. That goes in the feature that owns it.

## API

Everything is exported from `@/lib/ui`. Compound primitives are namespaces.

```tsx
import { Button, Menu, Tooltip, TooltipContent, TooltipTrigger } from '@/lib/ui';

<Menu.Root>
	<Menu.Trigger render={ <Button variant="ghost">Options</Button> } />
	<Menu.Popup>
		<Menu.Item onClick={ rename }>Rename</Menu.Item>
	</Menu.Popup>
</Menu.Root>;
```

## Constraints

- One folder per primitive: `index.tsx` and its `style.module.css`.
- Styles sit in the `ui` cascade layer, so a feature's CSS module overrides them without specificity tricks. Change a button's resting fill with `--button-background`, not `background-color`.
- Colors, type, radius and motion come from the tokens in `@/lib/theme`.
- CodeBlock loads Shiki lazily on first render, with a fixed set of languages in `code-block/highlight.ts`. Add a language there.
- Imports only other `lib/` packages and libraries. No `@tanstack/*`, `@wordpress/ui` or `@wordpress/components` (lint-enforced).
