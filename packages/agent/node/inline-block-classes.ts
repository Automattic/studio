/**
 * Blocks whose class the active theme's stylesheets make inline-level. Blocks
 * in a constrained layout are placed with auto inline margins
 * (wp-includes/block-supports/layout.php), which inline-level boxes ignore.
 * Studio notes such a rule when a stylesheet is written for a class blocks
 * already carry (lintThemeCss() in site-file-guards.ts); this covers the
 * class arriving after the stylesheet.
 *
 * When the site's active code or content changes and the active theme's
 * stylesheets make a class inline-level, Studio asks WordPress for the classes
 * of the blocks it renders: the active theme's templates and parts as
 * get_block_templates() resolves them, the patterns it registers, and the
 * content of posts, pages and synced patterns.
 */
import path from 'path';
import { activeCodeVersion } from '@studio/agent/node/active-code';
import { readVersions } from '@studio/agent/node/post-content-check';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { inlineDisplayClasses } from '@studio/agent/node/site-file-guards';
import { wpEvalJson } from '@studio/agent/node/tools/utils';
import type { SiteChangeSource } from '@studio/agent/node/site-changes';

const KEY = 'inline block classes';

const BLOCK_CLASSES = `$sources = array();
foreach ( array( 'wp_template', 'wp_template_part' ) as $type ) {
	foreach ( get_block_templates( array(), $type ) as $template ) {
		$sources[] = $template->content;
	}
}
foreach ( WP_Block_Patterns_Registry::get_instance()->get_all_registered() as $pattern ) {
	$sources[] = $pattern['content'];
}
foreach ( get_posts( array( 'post_type' => array( 'post', 'page', 'wp_block' ), 'post_status' => 'any', 'numberposts' => -1 ) ) as $post ) {
	$sources[] = $post->post_content;
}
$used  = array();
$visit = function ( $blocks ) use ( &$visit, &$used ) {
	foreach ( $blocks as $block ) {
		foreach ( preg_split( '/\\s+/', (string) ( $block['attrs']['className'] ?? '' ), -1, PREG_SPLIT_NO_EMPTY ) as $class ) {
			$used[ $class ] = true;
		}
		$visit( $block['innerBlocks'] );
	}
};
foreach ( $sources as $content ) {
	$visit( parse_blocks( (string) $content ) );
}
echo wp_json_encode( array( 'used' => array_keys( $used ) ) );`;

export const inlineBlockClasses: SiteChangeSource = {
	name: KEY,
	async read( sitePath ) {
		return {
			code: await activeCodeVersion( sitePath, ( name ) => /\.(php|json|html|css)$/.test( name ) ),
			content: JSON.stringify( await readVersions( sitePath ) ),
		};
	},
	async check( site, before, after, host ) {
		if ( before.code === after.code && before.content === after.content ) {
			return { reports: [] };
		}
		const themes = await readWordPressSite( site.path, ( wp ) =>
			[ ...new Set( [ wp.option( 'stylesheet' ), wp.option( 'template' ) ] ) ]
				.filter( ( name ): name is string => typeof name === 'string' && name !== '' )
				.map( ( name ) => path.join( site.path, 'wp-content', 'themes', name ) )
		).catch( () => [] as string[] );
		const inline = inlineDisplayClasses( themes );
		let used: Set< string > = new Set();
		if ( inline.length ) {
			try {
				used = new Set(
					( await wpEvalJson< { used: string[] } >( host, site, BLOCK_CLASSES ) ).used
				);
			} catch {
				// Code that does not load is reported by what runs it.
				return { reports: [] };
			}
		}
		const notes = inline.filter( ( { className } ) => used.has( className ) );
		return {
			reports: [
				{
					key: KEY,
					atTurnEnd: true,
					problem: notes.length
						? `${ site.name }: ${ notes.map( ( { note } ) => note ).join( ' ' ) }`
						: undefined,
				},
			],
		};
	},
};
