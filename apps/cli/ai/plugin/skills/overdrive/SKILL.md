---
name: overdrive
description: Push a WordPress site's design past conventional limits with technically ambitious, visually extraordinary implementations.
user-invokable: true
argument-hint: "[target]"
---

```
──────────── ⚡ OVERDRIVE ─────────────
》》》 Entering overdrive mode...
```

Push a WordPress theme's design past conventional limits — shaders, spring physics, scroll animations, 60fps effects — when the user wants something extraordinary rather than conventional.

## MANDATORY PREPARATION

If no design context exists yet (no `.impeccable.md` in the site root), you MUST run `/design-setup` first. Use `site_info` to get the site path and check for `{site_path}/.impeccable.md`.

**Before any implementation you MUST**:

1. Take a screenshot with `take_screenshot` to see the current state
2. **Propose 2-3 directions** with different techniques and trade-offs
3. **STOP and call the AskUserQuestion tool** — ask which direction appeals to them
4. After implementing, take another screenshot to verify the result

Skipping the proposal risks building something inappropriate for the site's actual brand and audience.

---

## What "Extraordinary" Means (Context-Dependent)

- **Marketing / landing pages**: Sensory wow — scroll reveals, shader backgrounds, cinematic transitions
- **Portfolio sites**: Feeling wow — images morphing, spring-physics navigation, immersive galleries
- **Content / blog**: Fluid wow — animated transitions between states, sophisticated reading experience
- **Data-heavy sites**: Invisible wow — no jank, instant filtering, never blocks main thread

The technique must serve the experience, not vice versa.

## Key Techniques

**Cinematic transitions**: View Transitions API (`@view-transition`), `@starting-style`, spring physics
**Scroll-driven effects**: CSS `animation-timeline: scroll()` — no JavaScript needed
**GPU rendering**: WebGL/Canvas for shader backgrounds, SVG filters for effects
**Complex animation**: Custom `@property`, Web Animations API
**Performance**: Web Workers for heavy computation, lazy initialization

## Implementation in WordPress Themes

Changes go in the active theme:
- **`style.css`**: CSS animations, transitions, scroll-driven effects
- **`theme.json`**: Design tokens that feed into styles
- **Custom JS**: Add to theme via `functions.php` → `wp_enqueue_script()`, or inline in a template

For block themes, custom CSS can also be added per-block in `theme.json` → `styles.blocks`.

## Non-Negotiable Rules

- Progressive enhancement required — graceful degradation for all techniques
- Target 60fps minimum; simplify if dropping below 50fps
- **Always** respect `prefers-reduced-motion` — provide beautiful static alternatives:
  ```css
  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }
  ```
- Lazy-initialize heavy resources; pause off-screen rendering
- Test on real mid-range devices, not just development machines
- Polish the last 20% — easing, timing offsets, secondary motion

**NEVER**:
- Ignore accessibility (`prefers-reduced-motion` is mandatory)
- Ship janky effects on mid-range devices
- Use bleeding-edge APIs without functional fallbacks
- Add audio without explicit opt-in
- Use technical ambition to mask weak design fundamentals
- Layer competing extraordinary moments — focus creates impact

## Verification Tests

Take a screenshot after implementing and verify:

- **Wow test**: Would this get an unexpected reaction from a first-time visitor?
- **Removal test**: Does removing the effect diminish the experience?
- **Accessibility test**: Is it still beautiful with reduced motion enabled?
- **Context test**: Does this fit THIS brand and audience?

## WordPress Studio Context

You are operating within WordPress Studio. Before making any changes:

1. Use `site_info` to find the active site's path
2. Find the active theme: `wp_cli theme list --status=active --format=json`
3. Editable design files live at `{site_path}/wp-content/themes/{active-theme}/`:
   - `style.css` — main stylesheet
   - `theme.json` — design tokens (colors, typography, spacing)
   - Custom block styles and templates
4. After making changes, call `take_screenshot` to verify visually
5. Never modify WordPress core files — only theme directory files

The `.impeccable.md` design context file lives at `{site_path}/.impeccable.md`.
