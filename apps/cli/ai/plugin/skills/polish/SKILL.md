---
name: polish
description: Final quality pass — visual alignment, typography, interactions, and edge cases. Run when a site is functionally complete and needs refinement.
user-invokable: true
argument-hint: "[target]"
---

Perform a systematic final-pass quality review and improvement of a WordPress site's design, covering every dimension of visual and interaction quality.

## MANDATORY PREPARATION

If no design context exists yet (no `.impeccable.md` in the site root), you MUST run `/design-setup` first to establish persistent design guidelines. Use `site_info` to get the site path and check for `{site_path}/.impeccable.md`.

**Polish is the last step, not the first. Don't polish work that's not functionally complete.**

---

## Assess Current State

Take a screenshot with `take_screenshot` and analyze systematically. Check the active theme files for issues before proposing fixes.

### Visual Alignment
- Are elements aligned to a consistent grid?
- Is spacing consistent or arbitrary?
- Do columns line up? Do margins match?

### Typography
- Is there clear hierarchy (H1 > H2 > body > caption)?
- Are font sizes consistent for the same element types?
- Is body text readable? (min 16px, sufficient contrast)
- Are line lengths comfortable? (45–75 characters)

### Color & Contrast
- Do all text/background combinations meet WCAG AA (4.5:1 for body, 3:1 for large text)?
- Is the color palette consistent throughout?
- Are interactive elements clearly distinguishable?

### Interaction States
- Do all buttons, links, and interactive elements have hover states?
- Are focus states visible? (Critical for keyboard navigation)
- Are disabled states clearly communicated?
- Are loading states handled gracefully?

### Micro-interactions
- Do buttons give feedback on click?
- Do form inputs respond to focus/validation?
- Are transitions smooth (not instant or jarring)?

### Content & Copy
- Is heading hierarchy semantically correct (one H1, logical H2/H3)?
- Is placeholder content (Lorem ipsum) replaced?
- Are there any orphaned words in headings?
- Is punctuation consistent?

### Icons & Images
- Are icon sizes consistent throughout?
- Are images properly cropped and optimized?
- Do images have appropriate alt text?

### Forms
- Are labels associated with inputs?
- Are error messages clear and helpful?
- Is required field marking consistent?
- Does tab order make sense?

### Edge Cases
- What does the site look like with very long content?
- What about very short content (empty states)?
- What happens on mobile? (Take a mobile screenshot if possible)

### Responsiveness
- Does the layout adapt gracefully at small screen widths?
- Are touch targets large enough? (min 44×44px)
- Is text readable without horizontal scrolling?

### Performance
- Are there unused stylesheets or large images causing slow loads?
- Are web fonts causing layout shift?

## Fix Issues Systematically

Work through the theme files methodically:

1. **theme.json** — fix design tokens (colors, typography, spacing) first; they cascade everywhere
2. **style.css** — fix global styles
3. **Block-specific CSS** — fix individual block styles
4. **Template parts** — fix structural layout issues

Take a screenshot after each significant change to verify visually.

**NEVER**:
- Polish what isn't functionally complete yet
- Make changes that break existing functionality
- Edit WordPress core files — only theme files

## Verify Quality

Final checks before declaring complete:

- [ ] Take a fresh screenshot — does it look polished?
- [ ] Hierarchy is clear at a glance
- [ ] Spacing feels consistent and intentional
- [ ] All interactive states are handled
- [ ] Accessible: contrast, focus states, alt text
- [ ] Responsive: readable on mobile
- [ ] No placeholder content remains

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
