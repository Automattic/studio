# lib/keyboard

Keyboard handling that knows nothing about Studio: matching shortcuts across platforms, leaving keys to text fields and IME composition, and letting Return confirm a dialog.

**Belongs here:** key matching and keyboard behavior any app could reuse (`isShortcut`, `isTextEntry`, `isDialogOpen`, `isImeComposing`, `useConfirmOnEnter`). **Doesn't:** Studio's own shortcuts and what they do (the command palette, sidebar row shortcuts), which live in their features.

## API

```tsx
import { isShortcut, isTextEntry, useConfirmOnEnter } from '@/lib/keyboard';

// ⌘K on macOS, Ctrl+K elsewhere, unless the user is typing.
if ( isShortcut( event, 'k' ) && ! isTextEntry( event.target ) ) openPalette();

// Return presses the dialog's "Delete" button from anywhere inside it.
const handleKeyDown = useConfirmOnEnter( __( 'Delete' ) );
<DialogContent onKeyDown={ handleKeyDown }>…</DialogContent>;
```

## Constraints

- No imports from the app (lint-enforced), and no `@tanstack/*`.
- `isShortcut` treats ⌘ on Apple platforms and Ctrl elsewhere as the primary modifier; pass `'alt'` or `'shift'` for a second one.
