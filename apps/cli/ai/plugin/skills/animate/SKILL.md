---
name: animate
description: Add purposeful animations and micro-interactions to make the site feel alive. Use when the UI feels static or interactions lack feedback.
user-invokable: true
argument-hint: "[target]"
---

Analyze a WordPress site and strategically add animations and micro-interactions that enhance understanding, provide feedback, and create delight.

## MANDATORY PREPARATION

If no design context exists yet (no `.impeccable.md` in the site root), you MUST run `/design-setup` first. Use `site_info` to get the site path and check for `{site_path}/.impeccable.md`.

---

## Assess Animation Opportunities

Take a screenshot with `take_screenshot`, then analyze the active theme:

1. **Identify static areas**:
   - **Missing feedback**: Actions without visual acknowledgment (button clicks, form submission, etc.)
   - **Jarring transitions**: Instant state changes that feel abrupt (show/hide, page loads)
   - **Unclear relationships**: Spatial or hierarchical relationships that aren't obvious
   - **Lack of delight**: Functional but joyless interactions
   - **Missed guidance**: Opportunities to direct attention or explain behavior

2. **Understand the context**:
   - What's the personality? (Playful vs serious, energetic vs calm)
   - Who's the audience? (Motion-sensitive users? Power users who want speed?)
   - What matters most? (One hero animation vs many micro-interactions?)

If any of these are unclear, STOP and call the AskUserQuestion tool to clarify.

**CRITICAL**: Respect `prefers-reduced-motion`. Always provide non-animated alternatives for users who need them.

## Plan Animation Strategy

Create a purposeful animation plan:

- **Hero moment**: What's the ONE signature animation?
- **Feedback layer**: Which interactions need acknowledgment?
- **Transition layer**: Which state changes need smoothing?
- **Delight layer**: Where can we surprise and delight?

**IMPORTANT**: One well-orchestrated experience beats scattered animations everywhere. Focus on high-impact moments.

## Implement Animations

In WordPress themes, animations live in `style.css` or block-specific CSS files. Add motion systematically:

### Entrance Animations
- **Page load choreography**: Stagger element reveals (100-150ms delays), fade + slide combinations
- **Hero section**: Dramatic entrance for primary content
- **Content reveals**: Scroll-triggered animations using intersection observer
- **Modal/drawer entry**: Smooth slide + fade, backdrop fade

### Micro-interactions
- **Button feedback**:
  - Hover: Subtle scale (1.02-1.05), color shift, shadow increase
  - Click: Quick scale down then up (0.95 → 1)
  - Loading: Spinner or pulse state
- **Form interactions**:
  - Input focus: Border color transition, slight glow
  - Validation: Shake on error, check mark on success
- **Toggle switches**: Smooth slide + color transition (200-300ms)
- **Like/favorite**: Scale + color transition

### State Transitions
- **Show/hide**: Fade + slide (not instant), appropriate timing (200-300ms)
- **Expand/collapse**: Height transition with overflow handling, icon rotation
- **Loading states**: Skeleton screen fades, spinner animations
- **Success/error**: Color transitions, icon animations, gentle scale pulse

### Navigation & Flow
- **Tab switching**: Slide indicator, content fade/slide
- **Scroll effects**: Parallax layers, sticky header state changes

### Delight Moments
- **Empty states**: Subtle floating animations on illustrations
- **Completed actions**: Check mark flourish, success celebrations

## Technical Implementation

```css
/* Recommended easing curves */
--ease-out-quart: cubic-bezier(0.25, 1, 0.5, 1);    /* Smooth, refined */
--ease-out-quint: cubic-bezier(0.22, 1, 0.36, 1);   /* Slightly snappier */
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);     /* Confident, decisive */

/* AVOID - feel dated and tacky */
/* bounce: cubic-bezier(0.34, 1.56, 0.64, 1); */
/* elastic: cubic-bezier(0.68, -0.6, 0.32, 1.6); */
```

**Durations by purpose:**
- **100-150ms**: Instant feedback (button press, toggle)
- **200-300ms**: State changes (hover, menu open)
- **300-500ms**: Layout changes (accordion, modal)
- **500-800ms**: Entrance animations (page load)

**Exit animations are faster than entrances.** Use ~75% of enter duration.

### Performance
- **GPU acceleration**: Use `transform` and `opacity`, avoid layout properties
- **will-change**: Add sparingly for known expensive animations

### Accessibility — REQUIRED
```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

**NEVER**:
- Use bounce or elastic easing curves — they feel dated
- Animate layout properties (width, height, top, left) — use transform instead
- Use durations over 500ms for feedback — it feels laggy
- Animate without purpose — every animation needs a reason
- Ignore `prefers-reduced-motion` — this is an accessibility violation
- Animate everything — animation fatigue makes interfaces feel exhausting

## Verify Quality

Take a screenshot after implementing, then check:

- **Smooth**: No jank on target devices
- **Natural**: Easing curves feel organic, not robotic
- **Appropriate**: Not too fast (jarring) or too slow (laggy)
- **Reduced motion works**: Animations disabled or simplified appropriately
- **Doesn't block**: Users can interact during/after animations
- **Adds value**: Makes interface clearer or more delightful

Remember: Motion should enhance understanding and provide feedback, not just add decoration. Animate with purpose, respect performance constraints, and always consider accessibility. Great animation is invisible — it just makes everything feel right.

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
