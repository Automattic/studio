# UI Desks Design System

`ui-desks` has its own shared UI components in `components/`. These components are the preferred building blocks for desks UI. They keep interaction details, sizes, spacing, and visual treatment consistent without coupling desks screens to the broader Studio UI or to third-party component APIs.

This guidance applies to components used inside `apps/ui/src/ui-desks`. Components outside `ui-desks` are not considered duplicates unless `ui-desks` imports and uses them.

When adding or updating desks UI, prefer imports from `@/ui-desks/components`.

## Current Shared Components

- `Button`: shared desks button primitive for icon buttons, toolbar buttons, quiet actions, and filled actions.
- `Dialog`: shared centered modal dialog primitive, including `DialogHeader`, `DialogTitle`, `DialogContent`, `DialogFooter`, `DialogCloseButton`, `DialogRow`, `DialogError`, and `DialogTip`.
- `Menu`: shared menu primitives for desks popups and dropdown-style actions.
- `Surface` and `Divider`: shared visual containers and separators.
- `List` and `ListItem`: shared list navigation/action primitives.
- `LoadingPlaceholder`: shared loading skeleton placeholder.

## Buttons

Use `Button` for user-visible button controls in desks UI. Do not import `Button` or `IconButton` directly from `@wordpress/ui` or `@wordpress/components` in `ui-desks`.

Button size should drive icon size. Avoid adding per-call icon sizing unless there is a clear new component need.

Use variants by intent:

- `chrome`: floating chrome and toolbar controls.
- `quiet`: low-emphasis actions, icon-only utility actions, and controls that should visually recede until hovered or active.
- `filled`: emphasized local actions, form actions, and primary dialog actions.

Prefer `tone` when the action needs a semantic color treatment instead of overriding button colors locally. Use `tone="primary"` for brand-colored primary actions and `tone="inverse"` for strong black/white actions.

Use `intent="chat"` for primary actions that start, submit, or hand work to chat or the agent. The chat intent adds the shared blue glow only when combined with `variant="filled"` and `tone="primary"`.

Local button classes are acceptable for layout constraints such as width, positioning, or contextual spacing. Avoid local classes that recreate button states, icon sizing, hover treatment, or disabled treatment. If the same visual override appears in multiple places, add a Button variant or a small shared wrapper instead.

Raw `<button>` elements are acceptable for primitives that are not normal visible buttons, such as invisible backdrops, internal list/menu item primitives, or custom card-like controls that need their own component abstraction.

## Dialogs

Use `Dialog` for centered modal dialogs in desks UI. It owns the backdrop, modal role, Escape handling, basic focus behavior, and the shared desks dialog surface.

Use `Dialog as="form"` for submit-driven prompt dialogs. Use the default `div` rendering for settings, confirmations, and other non-form modals.

Do not import `Dialog` from `@wordpress/ui` in `ui-desks`. If a modal needs a design or behavior that the shared `Dialog` does not support, extend the desks primitive first.

The chats panel currently uses `@base-ui/react/dialog` directly because it is not a centered modal. It is a non-modal, floating, resizable panel with custom focus and pointer behavior. Treat that as a separate primitive candidate, not as a `Dialog` replacement.

## External UI Primitives

External primitives can still be used where desks does not yet have a wrapper, but keep the dependency localized and intentional. Current examples include `Icon`, `Tooltip`, and `Field` from `@wordpress/ui`.

If an external primitive becomes a repeated desks pattern, wrap it in `@/ui-desks/components` before spreading usage further.

## Adding Shared Components

Add a shared desks component when at least one of these is true:

- The same control pattern appears in more than one desks area.
- A component centralizes accessibility or keyboard behavior.
- A component prevents local CSS from recreating shared states.
- A component gives a desks-specific API over an external primitive.

Keep shared component APIs narrow. Prefer intent-based props such as `variant`, `tone`, and `size` over props that expose implementation details.
