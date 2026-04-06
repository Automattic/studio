import { __ } from '@wordpress/i18n';

export interface SlashCommandDef {
	name: string;
	description: string;
}

export const AI_CHAT_BROWSER_COMMAND = '/browser';
export const AI_CHAT_API_KEY_COMMAND = '/api-key';
export const AI_CHAT_LOGIN_COMMAND = '/login';
export const AI_CHAT_LOGOUT_COMMAND = '/logout';
export const AI_CHAT_MODEL_COMMAND = '/model';
export const AI_CHAT_PROVIDER_COMMAND = '/provider';
export const AI_CHAT_EXIT_COMMAND = '/exit';
export const AI_CHAT_CLASSIC_TO_BLOCKS_COMMAND = '/classic-to-blocks';

export const AI_CHAT_SLASH_COMMANDS: SlashCommandDef[] = [
	{ name: 'browser', description: __( 'Open the active site in the browser' ) },
	{ name: 'api-key', description: __( 'Set or update the Anthropic API key' ) },
	{
		name: 'classic-to-blocks',
		description: __( 'Convert the active classic theme to a block theme' ),
	},
	{ name: 'login', description: __( 'Log in to WordPress.com' ) },
	{ name: 'logout', description: __( 'Log out of WordPress.com' ) },
	{ name: 'model', description: __( 'Switch the AI model' ) },
	{ name: 'provider', description: __( 'Switch the AI provider' ) },
	{ name: 'exit', description: __( 'Exit the chat' ) },
	{ name: 'taxonomist', description: __( 'Optimize category taxonomy with AI' ) },
	{ name: 'need-for-speed', description: __( 'Run a performance audit on a site' ) },
];

export const CLASSIC_TO_BLOCKS_PROMPT = `Convert the active site's current classic PHP theme into a fully functional WordPress block theme. Follow these steps precisely:

## Step 1: Capture the current design

Before making ANY changes, capture visual reference of the classic theme:
1. Use site_info to get the site URL.
2. Use take_screenshot on the site's homepage (desktop and mobile).
3. Take screenshots of other key pages if they exist (check with wp_cli: \`post list --post_type=page --post_status=publish --fields=ID,post_title,post_name\`).
4. Save these screenshots mentally as the "target" — the block theme MUST look identical.

## Step 2: Analyze the classic theme

Read and understand the entire classic theme structure:
1. List all theme files with Glob (*.php, *.css, *.js in the theme directory).
2. Read every PHP template file: index.php, header.php, footer.php, sidebar.php, single.php, page.php, archive.php, functions.php, and any custom templates.
3. Read style.css fully — every CSS rule matters.
4. Read any JS files.
5. Identify: the header structure, navigation menus, footer structure, sidebars/widgets, custom post type templates, template hierarchy usage, enqueued styles/scripts, custom functions, theme supports, and customizer settings.

## Step 3: Create the block theme

Create a NEW block theme (do not modify the classic theme in place). Name it with "-blocks" appended (e.g., "flavor-blocks" for "flavor"):

### Required files:
- **style.css**: Theme header + ALL the original CSS rules, adapted for block markup. Selectors may need updating since block themes use different markup (e.g., \`.wp-block-navigation\` instead of custom menu markup).
- **theme.json**: Define colors, typography, spacing, and layout settings matching the classic theme's design. Use the original fonts, colors, and sizes.
- **functions.php**: Enqueue styles, register block patterns, add theme supports. Keep any custom functionality from the original.
- **templates/index.html**: Main template using blocks.
- **templates/page.html**: Page template.
- **templates/single.html**: Single post template.
- **templates/archive.html**: Archive/category template.
- **templates/404.html**: 404 page.
- **templates/front-page.html**: If the original has a custom front page.
- **parts/header.html**: Header template part — must match the original header exactly (logo, navigation, any top bars).
- **parts/footer.html**: Footer template part — must match the original footer exactly.

### Conversion rules:
- PHP template tags → block equivalents: \`the_title()\` → \`core/post-title\`, \`the_content()\` → \`core/post-content\`, \`the_excerpt()\` → \`core/post-excerpt\`, \`wp_nav_menu()\` → \`core/navigation\`, \`get_header()\`/\`get_footer()\` → template parts, \`the_post_thumbnail()\` → \`core/post-featured-image\`, \`get_search_form()\` → \`core/search\`, \`dynamic_sidebar()\` → relevant blocks, loops → \`core/query\` + \`core/post-template\`.
- Custom PHP logic → block patterns or custom blocks where necessary.
- Preserve ALL visual styling — every color, font, spacing, border, shadow, hover effect.
- Preserve responsive behavior.

## Step 4: Activate and validate

1. Activate the new block theme: \`wp_cli theme activate <new-theme-slug>\`.
2. Use take_screenshot on every page you captured in Step 1.
3. Compare side by side with the original screenshots. Fix ANY visual differences:
   - Header layout and navigation
   - Typography (fonts, sizes, weights, line heights)
   - Colors (backgrounds, text, links, accents)
   - Spacing (margins, padding)
   - Footer layout
   - Responsive behavior (check mobile too)
4. Run validate_blocks on all template files to ensure block validity.
5. Iterate until the block theme is visually indistinguishable from the classic theme.

IMPORTANT: The goal is VISUAL PARITY. The block theme must look exactly like the classic theme. Do not "improve" or "modernize" the design — reproduce it faithfully.`;
