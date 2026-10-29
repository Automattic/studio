# lib/ui

The UI primitives: Button, IconButton, Dialog, Menu, Popover, Select, Field, Tooltip and the rest, built on Base UI and styled with the theme tokens. Also small app-agnostic components that several features use: CodeBlock (Shiki highlighting in the current color scheme) and ResizeHandle.

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

## Which primitive

- An action: `Button`. Icon only: `IconButton`, whose `label` is also its tooltip. A link inside copy: `Button variant="inline-link" size="inline"`.
- A toolbar toggle: `Button` or `IconButton` with `variant="accent-ghost"` and `aria-pressed`. Pressed and expanded toggles use an accent fill and text, with a stronger accent fill on hover. Other variants use their hover fill and text for pressed and expanded states.
- A form row: `Field` with `FieldLabel`, `FieldDescription` and `FieldError`, grouped in a `FieldGroup`. Text: `Input` and `Textarea`, or `InputGroup` for buttons and icons inside the border.
- Attachments: `AttachmentRemoveButton` for the thumbnail's dismiss control; `AttachmentDropOverlay` for drop feedback, with the translated label as its children.
- A choice: `Select`, `Switch` for on/off, `Checkbox` in forms, `Tabs` for sections or a scope switch, `Slider`. A question with options: `Questionnaire`.
- A modal: `Dialog` with `DialogContent`. All dialogs share the settings dialog’s popover surface, popover-border outline, small shadow, and rounding. Dialog sidebars use the same background as their content. Settings field groups share the same muted fill in both color schemes. Small info dialogs and forms: `layout="compact"` (16px leading inset, standard 12px padding elsewhere, and extra space above actions). Confirmations: `AlertDialog` with `layout="confirmation"` (the same spacing at a wider width). Two panes: `DialogPanel`. Its optional `footer` accepts a `DialogFooter` outside the scrolling body, using the standard dialog inset.
- Floating: `Menu` (right click: `Menu.ContextMenuRoot`), `Popover`, `HoverCard`, `Tooltip`.
- Tabular data: `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`.
- Status: `Alert`, `Empty`, `Skeleton`, `Spinner`, `Progress`, `Badge`, `NotificationDot`. Attachment labels: `AttachmentChip`, with `font="mono"` for element references.
- Sidebar groups and rows: `SidebarGroup`, `SidebarMenu`, `SidebarMenuButton`.
- Also `CodeBlock`, `PreviewFrame`, `ResizeHandle`, `MarqueeLabel` (a long label that scrolls on hover), `CommandSheet` (slash commands), `Kbd` and `VisuallyHidden`.

When none fits, add one here rather than styling a `div` in a feature.

## Restyling

Styles sit in the `ui` cascade layer, so a feature's CSS module overrides them without specificity tricks. That makes one-screen overrides easy, and they are how screens drifted from the design.

- Pick a `variant` and `size` first. If none matches, add one here. A primitive that looks wrong everywhere gets fixed here, not on the screen where you noticed it.
- From a feature, pass `className` for layout: placement, width, margins, grid and flex.
- Button color, background and border feedback use `--motion-duration-feedback`. Hover-only actions appear immediately, without an opacity transition.
- Menu items, sidebar rows and tabs respond immediately to hover and selection, without color or background transitions.
- Change a button's fill with `--button-background`, `--button-hover-background` or `--button-hover-color`, not `background-color`.
- Don't reach into a primitive's parts with `[data-slot]` selectors, set its other custom properties, or raise specificity to beat it.

## Constraints

- One folder per primitive: `index.tsx` and its `style.module.css`.
- Colors, type, radius and motion come from the tokens in `@/lib/theme`.
- CodeBlock loads Shiki lazily on first render, with a fixed set of languages in `code-block/highlight.ts`. Add a language there.
- Imports only other `lib/` packages and libraries. No `@tanstack/*`, `@wordpress/ui` or `@wordpress/components` (lint-enforced).
