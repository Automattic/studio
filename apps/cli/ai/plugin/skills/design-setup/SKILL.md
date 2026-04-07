---
name: design-setup
description: One-time setup — discover design context for a WordPress site and write it to .impeccable.md. Run once before using other design skills.
user-invokable: true
---

Gather design context for this WordPress site, then persist it for all future design sessions.

## Step 1: Explore the Site's Theme

Before asking questions, use `site_info` to get the active site path, then find the active theme with `wp_cli theme list --status=active --format=json`. Thoroughly scan the theme to discover what you can:

- **Theme name and style.css header**: Theme purpose, author, version, description
- **theme.json**: Design tokens — color palette, typography scale, spacing scale, layout settings
- **Template files**: What kind of site (blog, portfolio, business, shop)?
- **Existing CSS**: Current design patterns, spacing, typography in use
- **Block patterns**: Pre-designed layouts that indicate the intended aesthetic
- **functions.php**: Registered fonts, enqueued styles, theme features
- **Homepage / front page**: What the site currently looks like (use `take_screenshot`)

Note what you've learned and what remains unclear.

## Step 2: Ask WordPress-Specific Design Questions

STOP and call the AskUserQuestion tool to clarify. Focus only on what you couldn't infer from the theme:

### Site Type & Audience
- What kind of site is this? (Blog, portfolio, business, e-commerce, nonprofit, etc.)
- Who visits it? What's their context when they arrive?
- What action should visitors take? (Contact, buy, read, subscribe, etc.)
- What emotions should the site evoke? (Trust, excitement, calm, urgency, etc.)

### Theme & Stack
- Is this a block theme (Full Site Editing) or a classic theme?
- Are you using a page builder (Elementor, Divi, Beaver Builder)?
- Any plugins that affect the design (WooCommerce, bbPress, LMS)?

### Brand & Personality
- How would you describe the brand personality in 3 words?
- Any reference sites that capture the right feel? What specifically about them?
- What should this site explicitly NOT look like?

### Aesthetic Preferences
- Any strong preferences for visual direction? (minimal, bold, elegant, playful, editorial, etc.)
- Light mode, dark mode, or both?
- Any colors that must be used or avoided?

### Accessibility & Inclusion
- Specific accessibility requirements? (WCAG level, known user needs)
- Considerations for reduced motion, color blindness, or other accommodations?

Skip questions where the answer is already clear from the theme exploration.

## Step 3: Write Design Context

Synthesize your findings and the user's answers into a `## Design Context` section:

```markdown
## Design Context

### Users
[Who they are, their context, the job to be done]

### Brand Personality
[Voice, tone, 3-word personality, emotional goals]

### Aesthetic Direction
[Visual tone, references, anti-references, theme]

### WordPress Stack
[Theme type (block/classic), page builder if any, key plugins affecting design]

### Design Principles
[3-5 principles derived from the conversation that should guide all design decisions]
```

Write this section to `{site_path}/.impeccable.md`. If the file already exists, update the Design Context section in place.

Then STOP and call the AskUserQuestion tool to ask whether they'd like to run one of the design skills now (`/polish`, `/typeset`, `/arrange`, `/animate`, `/bolder`, `/overdrive`).

Confirm completion and summarize the key design principles that will now guide all future work.

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
