import { Tooltip as WpTooltip } from '@wordpress/ui';

// Re-exports @wordpress/ui's Tooltip primitives so components can pull them
// from a stable, local-to-apps/ui import path. Uses the same wrapper used
// internally by `IconButton`, which means the popup is already themed
// (ThemeProvider-wrapped with the dark surface) and positioned with sensible
// defaults — no extra Portal/Positioner boilerplate needed.

export const Root = WpTooltip.Root;
export const Trigger = WpTooltip.Trigger;
export const Popup = WpTooltip.Popup;
export const Provider = WpTooltip.Provider;
