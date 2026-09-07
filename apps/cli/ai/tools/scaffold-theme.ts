import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import path from 'path';
import { Type } from 'typebox';
import { SiteData } from 'cli/lib/cli-config/core';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommandWithMessaging } from 'cli/lib/run-wp-cli-command';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

async function activateTheme(
	site: SiteData,
	slug: string
): Promise< { ok: boolean; message: string } > {
	try {
		await connectToDaemon();
		try {
			const running = await isServerRunning( site.id );
			if ( ! running ) {
				return {
					ok: false,
					message: `Site is not running. Start it (site_start) then run \`wp theme activate ${ slug }\`.`,
				};
			}
			await using command = await runWpCliCommandWithMessaging( site, [
				'theme',
				'activate',
				slug,
			] );
			const exitCode = await command.response.exitCode;
			const stderr = await command.response.stderrText;
			const stdout = await command.response.stdoutText;
			if ( exitCode !== 0 ) {
				const detail = ( stderr || stdout || '' ).trim();
				return {
					ok: false,
					message: `WP-CLI exited with code ${ exitCode }${ detail ? `: ${ detail }` : '' }`,
				};
			}
			return { ok: true, message: stdout || `Activated theme '${ slug }'.` };
		} finally {
			await disconnectFromDaemon();
		}
	} catch ( error ) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : String( error ),
		};
	}
}

function deriveSlug( input: string ): string {
	return input
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' );
}

async function pathExists( p: string ): Promise< boolean > {
	try {
		await stat( p );
		return true;
	} catch {
		return false;
	}
}

function renderStyleCss( name: string, slug: string ): string {
	return `/*
Theme Name: ${ name }
Description: A custom block theme scaffolded by Studio Code.
Requires at least: 6.7
Tested up to: 6.9
Requires PHP: 7.2
Version: 0.1.0
License: GNU General Public License v2 or later
License URI: http://www.gnu.org/licenses/gpl-2.0.html
Text Domain: ${ slug }
Tags: full-site-editing, block-patterns, block-styles, wide-blocks, accessibility-ready, style-variations
*/

/* WordPress inserts margin-block-start: var(--wp--style--block-gap) between the
   template's top-level sections (header part, main, footer part) — a gap that
   exists even when no markup asks for it. Zero it so sections butt edge-to-edge
   and own their vertical rhythm via padding; this does not affect block gaps
   inside nested layouts. */
.wp-site-blocks > * + * {
	margin-block-start: 0;
}

/* With that gap gone, main carries its own vertical padding so templates this
   theme does not author (WooCommerce shop, product, cart…) still clear the
   header and footer. A descendant selector, not a child one: WooCommerce wraps
   the single-product main in an extra group. Templates built from full-bleed
   sections opt out with is-flush and let the sections own the rhythm. */
.wp-site-blocks main {
	padding-block: var(--wp--preset--spacing--60) var(--wp--preset--spacing--70);
}
.wp-site-blocks main.is-flush {
	padding-block: 0;
}
`;
}

function renderChildStyleCss( name: string, slug: string, parentSlug: string ): string {
	return `/*
Theme Name: ${ name }
Description: A child theme of ${ parentSlug }, scaffolded by Studio Code.
Template: ${ parentSlug }
Requires at least: 6.7
Tested up to: 6.9
Requires PHP: 7.2
Version: 0.1.0
License: GNU General Public License v2 or later
License URI: http://www.gnu.org/licenses/gpl-2.0.html
Text Domain: ${ slug }
Tags: full-site-editing, block-patterns, block-styles, wide-blocks, accessibility-ready, style-variations
*/
`;
}

function renderThemeJson(): string {
	const data = {
		$schema: 'https://schemas.wp.org/wp/6.7/theme.json',
		version: 3,
		settings: {
			appearanceTools: true,
			// Without these, WordPress omits the max-width declaration from the
			// constrained-layout rules entirely, so `layout: constrained` stops
			// constraining anything and every block runs the full viewport width.
			layout: {
				contentSize: '1000px',
				wideSize: '1280px',
			},
			// Puts the horizontal padding below on `.has-global-padding` (every
			// constrained block) rather than on `.wp-site-blocks`, so section
			// backgrounds still reach the viewport edge while their content does not.
			useRootPaddingAwareAlignments: true,
		},
		styles: {
			spacing: {
				padding: {
					top: '0px',
					right: 'clamp(1.25rem, 5vw, 3rem)',
					bottom: '0px',
					left: 'clamp(1.25rem, 5vw, 3rem)',
				},
			},
		},
		// `page.html` renders the post title as the page's h1. A designed page whose
		// hero carries its own heading needs a way to opt out of that title without
		// removing it from `page.html`, which every ordinary page still wants.
		customTemplates: [
			{
				name: 'page-no-title',
				title: 'Page (no title)',
				postTypes: [ 'page' ],
			},
		],
	};
	return JSON.stringify( data, null, '\t' ) + '\n';
}

function renderFunctionsPhp( name: string, slug: string ): string {
	return `<?php
/**
 * ${ name } theme functions.
 *
 * @package ${ slug }
 */

add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_style(
		'${ slug }-style',
		get_parent_theme_file_uri( 'style.css' ),
		array(),
		wp_get_theme()->get( 'Version' )
	);
} );

add_action( 'after_setup_theme', function () {
	add_editor_style( 'style.css' );
} );
`;
}

function renderChildThemeJson(): string {
	const data = {
		$schema: 'https://schemas.wp.org/wp/6.7/theme.json',
		version: 3,
	};
	return JSON.stringify( data, null, '\t' ) + '\n';
}

function renderChildFunctionsPhp( name: string, slug: string, parentSlug: string ): string {
	return `<?php
/**
 * ${ name } child theme functions.
 *
 * @package ${ slug }
 */

add_action( 'wp_enqueue_scripts', function () {
	// Parents that enqueue their stylesheet via get_stylesheet_uri() would load
	// the child's near-empty style.css instead — enqueue the parent's directly.
	wp_enqueue_style(
		'${ parentSlug }-parent-style',
		get_template_directory_uri() . '/style.css',
		array(),
		wp_get_theme( get_template() )->get( 'Version' )
	);
	wp_enqueue_style(
		'${ slug }-style',
		get_stylesheet_directory_uri() . '/style.css',
		array( '${ parentSlug }-parent-style' ),
		wp_get_theme()->get( 'Version' )
	);
} );

add_action( 'after_setup_theme', function () {
	add_editor_style( 'style.css' );
} );
`;
}

const TEMPLATE_INDEX = `<!-- wp:template-part {"slug":"header"} /-->

<!-- wp:group {"tagName":"main"} -->
<main class="wp-block-group">
	<!-- wp:group {"layout":{"type":"constrained"}} -->
	<div class="wp-block-group">
		<!-- wp:query {"queryId":1,"query":{"perPage":10,"pages":0,"offset":0,"postType":"post","order":"desc","orderBy":"date","inherit":true}} -->
		<div class="wp-block-query">
			<!-- wp:post-template -->
				<!-- wp:post-title {"isLink":true,"level":2} /-->
				<!-- wp:post-date /-->
				<!-- wp:post-excerpt /-->
			<!-- /wp:post-template -->

			<!-- wp:query-pagination -->
				<!-- wp:query-pagination-previous /-->
				<!-- wp:query-pagination-numbers /-->
				<!-- wp:query-pagination-next /-->
			<!-- /wp:query-pagination -->

			<!-- wp:query-no-results -->
				<!-- wp:paragraph -->
				<p>No posts were found.</p>
				<!-- /wp:paragraph -->
			<!-- /wp:query-no-results -->
		</div>
		<!-- /wp:query -->
	</div>
	<!-- /wp:group -->
</main>
<!-- /wp:group -->

<!-- wp:template-part {"slug":"footer"} /-->
`;

const TEMPLATE_SINGLE = `<!-- wp:template-part {"slug":"header"} /-->

<!-- wp:group {"tagName":"main"} -->
<main class="wp-block-group">
	<!-- wp:group {"layout":{"type":"constrained"}} -->
	<div class="wp-block-group">
		<!-- wp:post-title {"level":1} /-->
		<!-- wp:post-date /-->
		<!-- wp:post-featured-image /-->
	</div>
	<!-- /wp:group -->

	<!-- wp:post-content {"layout":{"type":"constrained"}} /-->

	<!-- wp:group {"layout":{"type":"constrained"}} -->
	<div class="wp-block-group">
		<!-- wp:post-comments-form /-->
	</div>
	<!-- /wp:group -->
</main>
<!-- /wp:group -->

<!-- wp:template-part {"slug":"footer"} /-->
`;

const TEMPLATE_PAGE = `<!-- wp:template-part {"slug":"header"} /-->

<!-- wp:group {"tagName":"main"} -->
<main class="wp-block-group">
	<!-- wp:group {"layout":{"type":"constrained"}} -->
	<div class="wp-block-group">
		<!-- wp:post-title {"level":1} /-->
	</div>
	<!-- /wp:group -->

	<!-- wp:post-content {"layout":{"type":"constrained"}} /-->
</main>
<!-- /wp:group -->

<!-- wp:template-part {"slug":"footer"} /-->
`;

const TEMPLATE_PAGE_NO_TITLE = `<!-- wp:template-part {"slug":"header"} /-->

<!-- wp:group {"tagName":"main","className":"is-flush"} -->
<main class="wp-block-group is-flush">
	<!-- wp:post-content {"layout":{"type":"constrained"}} /-->
</main>
<!-- /wp:group -->

<!-- wp:template-part {"slug":"footer"} /-->
`;

const TEMPLATE_ARCHIVE = `<!-- wp:template-part {"slug":"header"} /-->

<!-- wp:group {"tagName":"main"} -->
<main class="wp-block-group">
	<!-- wp:group {"layout":{"type":"constrained"}} -->
	<div class="wp-block-group">
		<!-- wp:query-title {"type":"archive"} /-->
		<!-- wp:term-description /-->

		<!-- wp:query {"queryId":1,"query":{"perPage":10,"pages":0,"offset":0,"postType":"post","order":"desc","orderBy":"date","inherit":true}} -->
		<div class="wp-block-query">
			<!-- wp:post-template -->
				<!-- wp:post-title {"isLink":true,"level":2} /-->
				<!-- wp:post-date /-->
				<!-- wp:post-excerpt /-->
			<!-- /wp:post-template -->

			<!-- wp:query-pagination -->
				<!-- wp:query-pagination-previous /-->
				<!-- wp:query-pagination-numbers /-->
				<!-- wp:query-pagination-next /-->
			<!-- /wp:query-pagination -->
		</div>
		<!-- /wp:query -->
	</div>
	<!-- /wp:group -->
</main>
<!-- /wp:group -->

<!-- wp:template-part {"slug":"footer"} /-->
`;

const TEMPLATE_404 = `<!-- wp:template-part {"slug":"header"} /-->

<!-- wp:group {"tagName":"main"} -->
<main class="wp-block-group">
	<!-- wp:group {"layout":{"type":"constrained"}} -->
	<div class="wp-block-group">
		<!-- wp:heading {"level":1} -->
		<h1 class="wp-block-heading">Page not found</h1>
		<!-- /wp:heading -->

		<!-- wp:paragraph -->
		<p>The page you were looking for doesn't exist. Try a search instead.</p>
		<!-- /wp:paragraph -->

		<!-- wp:search {"label":"Search","showLabel":false,"buttonText":"Search"} /-->
	</div>
	<!-- /wp:group -->
</main>
<!-- /wp:group -->

<!-- wp:template-part {"slug":"footer"} /-->
`;

const PART_HEADER = `<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group">
	<!-- wp:group {"layout":{"type":"flex","justifyContent":"space-between"},"style":{"spacing":{"padding":{"top":"var:preset|spacing|40","bottom":"var:preset|spacing|40"}}}} -->
	<div class="wp-block-group" style="padding-top:var(--wp--preset--spacing--40);padding-bottom:var(--wp--preset--spacing--40)">
		<!-- wp:site-title {"level":0} /-->
		<!-- wp:navigation /-->
	</div>
	<!-- /wp:group -->
</div>
<!-- /wp:group -->
`;

const PART_FOOTER = `<!-- wp:group {"layout":{"type":"constrained"},"style":{"spacing":{"padding":{"top":"var:preset|spacing|50","bottom":"var:preset|spacing|50"}}}} -->
<div class="wp-block-group" style="padding-top:var(--wp--preset--spacing--50);padding-bottom:var(--wp--preset--spacing--50)">
	<!-- wp:group {"layout":{"type":"flex","justifyContent":"center"}} -->
	<div class="wp-block-group">
		<!-- wp:paragraph -->
		<p>©</p>
		<!-- /wp:paragraph -->
		<!-- wp:site-title {"isLink":false,"level":0} /-->
	</div>
	<!-- /wp:group -->
</div>
<!-- /wp:group -->
`;

export const scaffoldThemeTool = defineTool(
	'scaffold_theme',
	'Scaffolds a minimal block theme into the given site at wp-content/themes/<slug>/ and activates it by default. ' +
		'Drops in style.css (theme header, a reset zeroing the default block gap between top-level template sections, and default vertical padding on main that full-bleed templates opt out of with the is-flush class), ' +
		'theme.json (appearanceTools, a content/wide layout width, and root-padding-aware horizontal padding so content never touches the viewport edge), ' +
		'functions.php (frontend + editor style enqueue), default templates (index, single, page, archive, 404), ' +
		'a registered page-no-title template to assign to designed pages whose content carries its own heading, ' +
		'header/footer parts, and empty assets/fonts and patterns directories. ' +
		'Use when the user wants to start a new custom theme — the agent fills in design-specific content afterwards. ' +
		'Pass parentTheme to scaffold a child theme of an installed theme instead — required when customizing a third-party theme, whose files must never be edited directly. ' +
		'Block themes only; does not support classic (PHP template) themes. ' +
		'Fails if the target theme directory already exists. ' +
		'When the site is not running or activation fails, the scaffold still succeeds and the result reports the manual activation command.',
	{
		nameOrPath: Type.String( {
			description: 'The site name or filesystem path of the site to scaffold the theme into.',
		} ),
		name: Type.String( {
			description:
				'Display name of the theme (e.g. "Acme Studio"). Used in style.css Theme Name header.',
		} ),
		slug: Type.Optional(
			Type.String( {
				description:
					'Optional theme slug (lowercase letters, digits, dashes). Used as the directory name and text domain. Derived from the name when omitted.',
			} )
		),
		parentTheme: Type.Optional(
			Type.String( {
				description:
					"Slug of an installed theme to use as the parent (e.g. 'ollie'). When set, scaffolds a CHILD theme instead of a blank theme — templates, parts, patterns, theme.json settings, and styles inherit from the parent. Use to customize an installed third-party theme instead of editing its files (a theme update would wipe direct edits). The parent must already exist under wp-content/themes/.",
			} )
		),
		activate: Type.Optional(
			Type.Boolean( {
				description:
					'Whether to activate the theme after scaffolding via WP-CLI (`theme activate <slug>`). Defaults to true. Set to false to leave the theme inactive.',
			} )
		),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );

			const trimmedName = args.name.trim();
			if ( ! trimmedName ) {
				throw new Error( 'Theme name must not be empty.' );
			}

			const slug = ( args.slug ?? deriveSlug( trimmedName ) ).trim();
			if ( ! slug || ! /^[a-z0-9][a-z0-9-]*$/.test( slug ) ) {
				throw new Error(
					'Theme slug must contain only lowercase letters, digits and dashes, and start with a letter or digit.'
				);
			}

			const themesDir = path.join( site.path, 'wp-content', 'themes' );
			if ( ! ( await pathExists( themesDir ) ) ) {
				throw new Error( `wp-content/themes directory not found in site: ${ themesDir }` );
			}

			const parentSlug = args.parentTheme?.trim();
			if ( parentSlug !== undefined ) {
				if ( ! parentSlug || ! /^[a-z0-9][a-z0-9-]*$/.test( parentSlug ) ) {
					throw new Error(
						'Parent theme slug must contain only lowercase letters, digits and dashes, and start with a letter or digit.'
					);
				}
				if ( parentSlug === slug ) {
					throw new Error(
						'parentTheme must be different from the child theme slug. Pick a distinct slug for the child theme.'
					);
				}
				const parentStyleCssPath = path.join( themesDir, parentSlug, 'style.css' );
				if ( ! ( await pathExists( parentStyleCssPath ) ) ) {
					throw new Error(
						`Parent theme '${ parentSlug }' is not installed at wp-content/themes/${ parentSlug }/.`
					);
				}
				const grandparentMatch = ( await readFile( parentStyleCssPath, 'utf8' ) ).match(
					/^[ \t/*#@]*Template:[ \t]*(\S+)/im
				);
				if ( grandparentMatch ) {
					throw new Error(
						`'${ parentSlug }' is itself a child theme of '${ grandparentMatch[ 1 ] }' — WordPress does not support grandchild themes. Use parentTheme: '${ grandparentMatch[ 1 ] }' instead.`
					);
				}
			}

			const themeDir = path.join( themesDir, slug );
			if ( await pathExists( themeDir ) ) {
				throw new Error(
					`A theme already exists at wp-content/themes/${ slug }. Choose a different slug or remove the existing directory first.`
				);
			}

			let files: Array< [ string, string ] >;
			if ( parentSlug !== undefined ) {
				// A block child theme inherits templates, parts, patterns, theme.json
				// settings, and styles from the parent by path resolution — the child
				// only needs the three root files until the agent adds overrides.
				await mkdir( themeDir, { recursive: true } );
				files = [
					[ 'style.css', renderChildStyleCss( trimmedName, slug, parentSlug ) ],
					[ 'theme.json', renderChildThemeJson() ],
					[ 'functions.php', renderChildFunctionsPhp( trimmedName, slug, parentSlug ) ],
				];
			} else {
				await mkdir( path.join( themeDir, 'templates' ), { recursive: true } );
				await mkdir( path.join( themeDir, 'parts' ), { recursive: true } );
				await mkdir( path.join( themeDir, 'assets', 'fonts' ), { recursive: true } );
				await mkdir( path.join( themeDir, 'patterns' ), { recursive: true } );

				files = [
					[ 'style.css', renderStyleCss( trimmedName, slug ) ],
					[ 'theme.json', renderThemeJson() ],
					[ 'functions.php', renderFunctionsPhp( trimmedName, slug ) ],
					[ path.join( 'templates', 'index.html' ), TEMPLATE_INDEX ],
					[ path.join( 'templates', 'single.html' ), TEMPLATE_SINGLE ],
					[ path.join( 'templates', 'page.html' ), TEMPLATE_PAGE ],
					[ path.join( 'templates', 'page-no-title.html' ), TEMPLATE_PAGE_NO_TITLE ],
					[ path.join( 'templates', 'archive.html' ), TEMPLATE_ARCHIVE ],
					[ path.join( 'templates', '404.html' ), TEMPLATE_404 ],
					[ path.join( 'parts', 'header.html' ), PART_HEADER ],
					[ path.join( 'parts', 'footer.html' ), PART_FOOTER ],
				];
			}

			for ( const [ relPath, content ] of files ) {
				await writeFile( path.join( themeDir, relPath ), content, 'utf8' );
			}

			const shouldActivate = args.activate ?? true;
			const activation = shouldActivate ? await activateTheme( site, slug ) : null;

			let summaryLines: Array< string >;
			if ( parentSlug !== undefined ) {
				summaryLines = [
					`Child theme '${ trimmedName }' of '${ parentSlug }' scaffolded at wp-content/themes/${ slug }/.`,
					'',
					'Created files:',
					...files.map( ( [ relPath ] ) => `  ${ relPath }` ),
					'',
					`Templates, parts, patterns, theme.json settings, and styles inherit from '${ parentSlug }'.`,
					'Override by creating files at the same relative path inside the child theme; put CSS and theme.json changes in the child, never in the parent.',
					'',
					'These files already contain standard WordPress headers.',
					'Read a file before editing it — do not assume its contents.',
					'',
				];
			} else {
				summaryLines = [
					`Block theme '${ trimmedName }' scaffolded at wp-content/themes/${ slug }/.`,
					'',
					'Created files:',
					...files.map( ( [ relPath ] ) => `  ${ relPath }` ),
					'',
					'Empty directories:',
					'  assets/fonts/',
					'  patterns/',
					'',
					// These files already contain standard WordPress headers and starter
					// markup, so an Edit anchored on an assumed minimal header (e.g. just
					// `Theme Name`) would fail to match. Nudge the agent to read first.
					'These files already contain standard WordPress headers and starter content.',
					'Read a file before editing it — do not assume its contents.',
					'',
				];
			}

			if ( ! activation ) {
				summaryLines.push( `Activate with: wp theme activate ${ slug }` );
			} else if ( activation.ok ) {
				summaryLines.push( `Activated: ${ activation.message }` );
			} else {
				summaryLines.push(
					`Activation skipped: ${ activation.message }`,
					`Activate manually with: wp theme activate ${ slug }`
				);
			}

			return textResult( summaryLines.join( '\n' ) );
		} catch ( error ) {
			throw new Error(
				`Failed to scaffold theme: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
