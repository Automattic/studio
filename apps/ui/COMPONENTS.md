# Components

Who owns which piece of the UI, and how to change it. Read this before adding a control, a variant or a stylesheet. The rule underneath: a look that more than one screen shares lives in one owner, so a change there reaches every caller.

## Primitives

Import from `@/lib/ui`. Feature code doesn't import Base UI directly.

| Need | Use |
| --- | --- |
| An action | `Button` (`variant`, `size`, `loading`). Icon only: `IconButton`, which takes a `label` and shows it as a tooltip |
| A text link inside copy | `Button variant="inline-link" size="inline"`. "Learn more…" links: `LearnMoreLink` from `@/features/onboarding` |
| A text field | `Input` and `Textarea`. With buttons or icons inside the border: `InputGroup` with `InputGroupAddon` |
| A form row with a label, description and error | `Field`, `FieldLabel`, `FieldDescription`, `FieldError`. Group rows with `FieldGroup`, and give them a heading with `FieldSet` and `FieldLegend` |
| A choice | `Select` for a list, `Switch` for on/off, `Checkbox` in forms, `Tabs` for sections, `Slider` for a range |
| A modal | `Dialog` with `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter`. A confirmation: `AlertDialog`. A two-pane dialog: `DialogPanel` with `PanelHeader` |
| A menu | `Menu.Root`, `Menu.Trigger`, `Menu.Popup`, `Menu.Item`. Right click: `Menu.ContextMenuRoot` with `Menu.ContextPopup` |
| Content that floats next to a trigger | `Popover`. Preview on hover: `HoverCard`. A hint: `Tooltip` |
| A status message in the page | `Alert`. Nothing to show yet: `Empty`. Loading: `Skeleton` or `Spinner`. Progress: `Progress` |
| A small label or count | `Badge`. A shortcut: `Kbd` |
| Code | `CodeBlock`, highlighted with Shiki in the current scheme |
| A site screenshot | `PreviewFrame` and `PreviewImage` |
| A resizable split | `ResizeHandle` |
| A long label in a narrow row | `MarqueeLabel`, which scrolls it on hover and focus |
| A slash-command list | `CommandList` and `CommandSheet` |
| A label only screen readers read | `VisuallyHidden` |

When none fits, add a primitive in `src/lib/ui/` (see its README) rather than styling a `div` in a feature. Icons are `lucide-react`, or a file in `src/lib/icons/` drawn on the same 24px grid.

## Product surfaces

Each surface has one owner. Change it there, and import other features' pieces from their entry (`@/features/<name>`).

| Surface | Owner |
| --- | --- |
| Window layout: the sidebar column and the workspace frame | `features/sidebar/sidebar-layout`, rendered by `router/layout-dashboard` |
| Sidebar: site rows, chat rows, pins, reordering, collapsed switcher | `features/sidebar` |
| Site workspace: the chat beside the preview | `features/chats/site-workspace` and `features/sites/preview-split-frame` |
| Chat transcript: messages, tool rows, questions, images, markers | `features/chats/session-view/conversation` |
| Chat markdown | `features/chats/markdown`, with code from `CodeBlock` |
| Composer: input, attachments, model picker, notices above it | `features/composer` |
| Site preview: address bar, loading particles, stopped state | `features/sites/site-preview`, `preview-particles`, `stopped-site-preview` |
| Site header actions, site menus, open-in | `features/sites` (`site-header-actions`, `site-actions-menu`, `open-in-menu`) |
| Add site, import, Blueprints, create form | `features/sites/add-site-dialog` and its panels |
| Publish and pull | `features/sync` |
| Share previews | `features/sharing` |
| Settings dialog, its rows and sections | `features/settings` (`SettingsRow`, `SettingsToggle`, `SettingsSelect` in `settings-view/rows.tsx`; sections in `data/settings-sections.ts`) |
| Account, sign-in prompts, avatar | `features/account` |
| AI credits and access notices | `features/credits` |
| Toasts, notice cards, notice history | `features/notifications`. Raise a toast with `showToast` from `data/app-messages` |
| Welcome, orientation guide, What's New | `features/onboarding` |
| Command palette | `features/commands` |
| Preview annotations | `features/annotations` |

Shared pieces that aren't primitives because they know about Studio: `CopyButton` (chats), `SiteIcon` (sites), `Gravatar` (account), `LearnMoreLink` (onboarding). Use them instead of a local copy.

## Restyling

Primitives sit in the `ui` cascade layer, so a feature's CSS module overrides them without specificity tricks. That makes overriding easy, which is how the screens drifted from the design during the port. Before writing a rule against a primitive, check whether the change belongs to every caller.

Do:

- Pick a `variant` and `size` first. If none matches the design, add one to the primitive.
- Fix a primitive that looks wrong everywhere in the primitive, not on the screen where you noticed it.
- Pass `className` for layout: placement, width, margins, grid and flex.
- Change a button's fill with its custom properties (`--button-background`, `--button-hover-background`, `--button-hover-color`), not `background-color`.
- Use the tokens in `src/lib/theme/tokens.css` for every color, size, radius, shadow and duration.
- Check light and dark.

Don't:

- Restyle a primitive's color, type, height, padding, radius or border from a feature to make one screen match.
- Reach into a primitive's parts with `[data-slot=…]` selectors, or set its private custom properties (`--button-size`, `--button-padding-inline`, `--alert-tone`).
- Raise specificity (`.a.a`, `[class]`, `!important`) to beat a primitive or another feature.
- Copy a primitive's markup and styles into a feature.
- Style another feature's component from your CSS. Ask its owner for a prop or variant.
