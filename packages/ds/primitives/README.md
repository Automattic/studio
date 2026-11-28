# Primitives

The UI primitives: Button, IconButton, Dialog, Menu, Popover, Select, Field, Tooltip and the rest, built on Base UI and styled with the theme tokens. Also small app-agnostic components that several features use: CodeBlock (Shiki highlighting in the current color scheme) and ResizeHandle.

**Belongs here:** a control or visual that knows nothing about Studio. **Doesn't:** anything that reads data, calls the connector, or knows about sites, chats or notices. That goes in the feature that owns it.

## API

Everything is exported from `@studio/ds`. Compound primitives are namespaces.

```tsx
import { Button, Menu, Tooltip, TooltipContent, TooltipTrigger } from '@studio/ds';

<Menu.Root>
	<Menu.Trigger render={ <Button variant="ghost">Options</Button> } />
	<Menu.Popup>
		<Menu.Item onClick={ rename }>Rename</Menu.Item>
	</Menu.Popup>
</Menu.Root>;
```

## Which primitive

- An action: `Button`. Icon only: `IconButton`, whose `label` is also its tooltip. A link inside copy: `Button variant="inline-link" size="inline"`.
- A toolbar mode toggle: `Button` or `IconButton` with `variant="accent-ghost"` and `aria-pressed`. Use `highlightOnToggle={ false }` for a panel disclosure whose resting appearance stays the same while open. Keep its ARIA state and its pointer and keyboard feedback.
- A form row: `Field` with `FieldLabel`, `FieldDescription` and `FieldError`, grouped in a `FieldGroup`. Text: `Input` and `Textarea`, or `InputGroup` for buttons and icons inside the border.
- Dismiss controls: `DismissButton` for the small floating close button on notifications and attachments; its `label` supplies the tooltip. `AttachmentRemoveButton` is its attachment alias.
- File drops: `DropOverlay` for drag feedback, with a translated action label as its children; `DropZone` for a file picker's resting placeholder, with an icon, title, description, and file-selection controls. `DropZone size="sm"` uses text-xs and tighter caption spacing for compact areas. Feature code owns file handling.
- A choice: `Select`, `Combobox` to check several items in a long, searchable list, `Switch` for on/off, `Checkbox` in forms, `Tabs` for sections or a scope switch, `Slider`. A question with options: `Questionnaire`.
- A color: `ColorPicker`, with a controlled six-digit hex `value`, `onValueChange` for live previews and `onValueCommitted` for saves. Its editable hex field opens a saturation/brightness and hue popover.
- A modal: `Dialog` with `DialogContent`. All dialogs share the settings dialog’s popover surface, popover-border outline, small shadow, and rounding. Dialog sidebars use the same background as their content. Settings field groups share the same muted fill in both color schemes. Small info dialogs and forms: `layout="compact"` (16px leading inset, standard 12px padding elsewhere, and extra space above actions). Confirmations: `AlertDialog` with `layout="confirmation"` (the same spacing at a wider width). Two panes: `DialogPanel`. Its optional `footer` accepts a `DialogFooter` outside the scrolling body, using the standard dialog inset.
- Menu text: Use `Menu.ItemLabel` for item text that should truncate instead of widening the menu.
- Floating: `Menu` (right click: `Menu.ContextMenuRoot`), `Popover`, `Tooltip`. Use `Popover.Title` and `Popover.Description` for the shared informational text styles: 14px title at medium weight, 13px muted description, and a 4px gap, matching the empty notification popover.
- Feature education: `FeaturePopover` composes `Popover` with an optional badge, dismiss action, and footer. Use `Navigation` for Next/Skip and step text. The caller owns opening, progression, dismissal, and persistence; the card supports both hover hints and controlled onboarding steps.
- Status: `Alert`, `Empty`, `Skeleton`, `Spinner`, `Progress`, `Badge`, `NotificationDot`. Attachment labels: `AttachmentChip`, with `font="mono"` for element references. Add `AttachmentChipTrigger` to open a preview, with `AttachmentRemoveButton` as its sibling.
- Sidebar groups and rows: `SidebarGroup`, `SidebarMenu`, `SidebarMenuButton`.
- Logos: `LogoTile` frames a brand's logo, an SVG document in its colors, like an app icon `--app-icon-size` wide, or puts an icon on a muted tile when there is none.
- Image previews: `PreviewFrame` for a 16:10 screenshot. Other image wrappers compose `imageOutline` from the theme recipes: a 1px inset overlay at 12% foreground opacity, following the wrapper's radius. Apply it to a positioned wrapper, rather than the `img`, so the line draws over the pixels. `imagePreviewFrame` adds the shared preview shadow.
- `Trace` and its line, icon, title, details and collapsible parts present compact activity rows with aligned details. `CodeBlock variant="plain"` keeps highlighted input and diffs on that surface.
- Also `CodeBlock`, `ResizeHandle`, `MarqueeLabel` (a long label that scrolls on hover), `CommandSheet` (slash commands), `Kbd` and `VisuallyHidden`.

When none fits, add one here rather than styling a `div` in a feature.

## Button hierarchy

- Use `variant="accent"` for the primary action in a screen, form or dialog: Publish, Send, Create site, Save, Import and Continue.
- Supporting actions use `outline`, the default for `Button`: Manage, Connect, Reload, Retry, Cancel, Discard and dismiss-only Done buttons. Choose by role in context: Buy credits is accent as the primary action in Add credits.
- Use `muted-ghost` for secondary toolbar utilities, link variants for navigation within copy, and `destructive` for destructive actions or error feedback.
- Add the `destructive` prop to a quiet `Button` or `IconButton` to use a destructive foreground on hover, press, and keyboard focus, with the standard neutral highlight. Use `variant="destructive"` for a filled destructive action.
- The white-filled `default` variant is not used for product actions. Choose accent or outline according to the action's role.
- Form controls use the standard 36px size. Dialog-header Save and Discard actions use `size="sm"` (32px).

## Spacing and corners

- Use the theme's space and radius scales. Pick the component's `size`, `variant` or `layout` for its role. Menu, command, dialog, composer toolbar and notice insets have independent defaults.
- For nested surfaces that follow the same edge, use one inset for padding and the radius calculation. Subtract padding and any layout border from the outer radius, clamping at zero. A menu starts from the row radius and adds its inset to get the popup radius. Shadow outlines occupy no layout space.
- Overlays that paint the same edge use the same radius. Flush joins can have square corners. Derive a radius from the inset where both edges meet the same corner. Controls farther from that corner and deliberate circles or pills use their own shape.

## Restyling

Styles sit in the `ui` cascade layer, so a feature's CSS module overrides them without specificity tricks. That makes one-screen overrides easy, and they are how screens drifted from the design.

- Pick a `variant` and `size` first. If none matches, add one here. A primitive that looks wrong everywhere gets fixed here, not on the screen where you noticed it.
- From a feature, pass `className` for layout: placement, width, margins, grid and flex.
- Use `--motion-duration-feedback` and `ease` for pointer-driven button color and fill changes. Keyboard focus, menu highlights, sidebar rows and segmented-tab labels respond immediately.
- Change a button's fill with `--button-background`, `--button-hover-background` or `--button-hover-color`, not `background-color`.
- Size a `LogoTile` with `--app-icon-size`, which app icons share, so a fallback tile matches the icon it stands in for.
- A container can set `--radius-button` on a button it renders at its corner. Use the component API for other styling and let each primitive own its internal parts.

## Constraints

- One folder per primitive: `index.tsx` and its `style.module.css`.
- Colors, type, radius and motion come from the tokens in `@studio/ds/theme`.
- CodeBlock loads Shiki lazily on first render, with a fixed set of languages in `code-block/highlight.ts`. Add a language there.
- Imports the other folders of `@studio/ds` through their entries, and libraries. No `@tanstack/*`, `@wordpress/ui` or `@wordpress/components` (lint-enforced).
