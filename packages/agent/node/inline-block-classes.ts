/**
 * Blocks whose class the active theme's stylesheets make inline-level and that
 * sit directly in a constrained layout. Blocks in a constrained layout are
 * placed with auto inline margins (wp-includes/block-supports/layout.php),
 * which inline-level boxes ignore; a block in a flow layout, as a column's,
 * gets no such margins, so its class is not noted. This is the one place the
 * note is raised: a stylesheet's text cannot tell where its class's blocks sit,
 * and a note on it disagreed with this check (eval30 pileon: a paragraph in a
 * column, noted on every stylesheet write).
 *
 * When the site's active code or content changes and the active theme's
 * stylesheets make a class inline-level, Studio asks WordPress for the classes
 * of the blocks whose parent lays them out as a constrained layout, walking
 * the blocks as a page renders them: the active theme's templates as
 * get_block_templates() resolves them, with the parts, patterns and synced
 * patterns they hold, and the content of posts and pages inside the
 * templates' post content block.
 */
import { activeCodeVersion } from '@studio/agent/node/active-code';
import { readVersions } from '@studio/agent/node/post-content-check';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { inlineDisplayClasses } from '@studio/agent/node/theme-css-notes';
import { activeThemes, themesDir } from '@studio/agent/node/themes';
import { wpEvalJson } from '@studio/agent/node/tools/utils';
import type { SiteChangeSource } from '@studio/agent/node/site-changes';

const KEY = 'inline block classes';

const BLOCK_CLASSES = `$types    = WP_Block_Type_Registry::get_instance();
$patterns = WP_Block_Patterns_Registry::get_instance();
// Whether a block lays out its inner blocks as a constrained layout, as
// wp_render_layout_support_flag() in wp-includes/block-supports/layout.php resolves it.
$constrained = function ( $block ) use ( $types ) {
	$type = $types->get_registered( (string) $block['blockName'] );
	if ( ! $type || ! ( block_has_support( $type, 'layout', false ) || block_has_support( $type, '__experimentalLayout', false ) ) ) {
		return false;
	}
	$fallback = $type->supports['layout']['default'] ?? array();
	if ( empty( $fallback ) ) {
		$fallback = $type->supports['__experimentalLayout']['default'] ?? array();
	}
	$layout = $block['attrs']['layout'] ?? $fallback;
	return 'constrained' === ( $layout['type'] ?? '' ) || ! empty( $layout['inherit'] ) || ! empty( $layout['contentSize'] );
};
$used         = array();
$post_content = false;
$visit        = function ( $blocks, $in_constrained, $depth = 0 ) use ( &$visit, &$used, &$post_content, $constrained, $patterns ) {
	if ( $depth > 20 ) {
		return;
	}
	foreach ( $blocks as $block ) {
		$name = (string) $block['blockName'];
		// A pattern or synced pattern renders its blocks in its own place.
		if ( 'core/pattern' === $name ) {
			$pattern = $patterns->get_registered( (string) ( $block['attrs']['slug'] ?? '' ) );
			$visit( $pattern ? parse_blocks( (string) $pattern['content'] ) : array(), $in_constrained, $depth + 1 );
			continue;
		}
		if ( 'core/block' === $name ) {
			$post = get_post( (int) ( $block['attrs']['ref'] ?? 0 ) );
			$visit( $post ? parse_blocks( (string) $post->post_content ) : array(), $in_constrained, $depth + 1 );
			continue;
		}
		if ( $in_constrained ) {
			foreach ( preg_split( '/\\s+/', (string) ( $block['attrs']['className'] ?? '' ), -1, PREG_SPLIT_NO_EMPTY ) as $class ) {
				$used[ $class ] = true;
			}
		}
		// A template part's wrapper has no layout.
		if ( 'core/template-part' === $name ) {
			$part = get_block_template( ( $block['attrs']['theme'] ?? get_stylesheet() ) . '//' . ( $block['attrs']['slug'] ?? '' ), 'wp_template_part' );
			$visit( $part ? parse_blocks( (string) $part->content ) : array(), false, $depth + 1 );
			continue;
		}
		$inner = $constrained( $block );
		if ( 'core/post-content' === $name ) {
			$post_content = $post_content || $inner;
		}
		$visit( $block['innerBlocks'], $inner, $depth + 1 );
	}
};
foreach ( get_block_templates( array(), 'wp_template' ) as $template ) {
	$visit( parse_blocks( (string) $template->content ), false );
}
foreach ( get_posts( array( 'post_type' => array( 'post', 'page' ), 'post_status' => 'any', 'numberposts' => -1 ) ) as $post ) {
	$visit( parse_blocks( (string) $post->post_content ), $post_content );
}
echo wp_json_encode( array( 'used' => array_keys( $used ) ) );`;

export const inlineBlockClasses: SiteChangeSource = {
	name: KEY,
	async read( sitePath, last ) {
		return {
			code: await activeCodeVersion( sitePath, ( name ) => /\.(php|json|html|css)$/.test( name ) ),
			content: JSON.stringify( await readVersions( sitePath ) ),
			// The notes raised, which a read before a call keeps for its check.
			...( last?.raised ? { raised: last.raised } : {} ),
		};
	},
	async check( site, before, after, host ) {
		// The notes raised as problems, by key, each its own, so one fixed
		// leaves the others as they were raised: in eval29 redo port 2 the
		// note of the one class left, joined with another's, came again.
		const raised: string[] = JSON.parse( before.raised ?? '[]' );
		const keep = { ...after, raised: JSON.stringify( raised ) };
		if ( before.code === after.code && before.content === after.content ) {
			return { reports: [], next: keep };
		}
		const themes = await readWordPressSite( site.path, ( wp ) =>
			activeThemes( wp ).map( ( name ) => themesDir( site.path, name ) )
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
				return { reports: [], next: keep };
			}
		}
		const notes = inline
			.filter( ( { className } ) => used.has( className ) )
			.map( ( { note } ) => ( { key: `${ KEY } ${ note }`, note } ) );
		const keys = notes.map( ( { key } ) => key );
		return {
			reports: [
				...notes.map( ( { key, note } ) => ( {
					key,
					atTurnEnd: true,
					problem: `${ site.name }: ${ note }`,
				} ) ),
				...[ KEY, ...raised ]
					.filter( ( key ) => ! keys.includes( key ) )
					.map( ( key ) => ( { key, atTurnEnd: true, problem: undefined } ) ),
			],
			next: { ...after, raised: JSON.stringify( keys ) },
		};
	},
};
