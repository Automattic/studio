/**
 * Blocks that carry the name of a block style registered for their type as a
 * bare class. WordPress applies a block style through the class
 * `is-style-<name>`: the editor's block styles panel adds it to the block's
 * "className" (replaceActiveStyle() in @wordpress/block-editor), and WordPress
 * reads a block's style variation from it
 * (wp_get_block_style_variation_name_from_class() in
 * wp-includes/block-supports/block-style-variations.php). A block whose class is
 * the bare name has no style applied, and the editor shows none selected.
 *
 * When the site's active code or content changes, Studio asks WordPress for
 * the block styles it registers (WP_Block_Styles_Registry) and the block
 * markup it renders: the active theme's templates and parts as
 * get_block_templates() resolves them, the patterns it registers, and the
 * content of posts, pages and synced patterns.
 */
import { activeCodeVersion } from 'cli/ai/active-code';
import { readVersions } from 'cli/ai/post-content-check';
import { runWpCli } from 'cli/ai/tools/utils';
import type { SiteChangeSource } from 'cli/ai/site-changes';

const KEY = 'block style classes';

const BARE = `$styles = WP_Block_Styles_Registry::get_instance()->get_all_registered();
$sources = array();
foreach ( array( 'wp_template', 'wp_template_part' ) as $type ) {
	foreach ( get_block_templates( array(), $type ) as $template ) {
		$sources[ $type . ' ' . $template->slug ] = $template->content;
	}
}
foreach ( WP_Block_Patterns_Registry::get_instance()->get_all_registered() as $pattern ) {
	$sources[ 'pattern ' . $pattern['name'] ] = $pattern['content'];
}
foreach ( get_posts( array( 'post_type' => array( 'post', 'page', 'wp_block' ), 'post_status' => 'any', 'numberposts' => -1 ) ) as $post ) {
	$sources[ $post->post_type . ' ' . $post->ID ] = $post->post_content;
}
$bare = array();
$visit = function ( $blocks, $where ) use ( &$visit, &$bare, $styles ) {
	foreach ( $blocks as $block ) {
		$classes = preg_split( '/\\s+/', (string) ( $block['attrs']['className'] ?? '' ), -1, PREG_SPLIT_NO_EMPTY );
		foreach ( $classes as $class ) {
			if ( isset( $styles[ $block['blockName'] ][ $class ] ) && ! in_array( 'is-style-' . $class, $classes, true ) ) {
				$bare[ $block['blockName'] . ' ' . $class ][] = $where;
			}
		}
		$visit( $block['innerBlocks'], $where );
	}
};
foreach ( $sources as $where => $content ) {
	$visit( parse_blocks( (string) $content ), $where );
}
echo 'BARE_STYLE_CLASSES=' . wp_json_encode( (object) $bare );`;

export const blockStyleClasses: SiteChangeSource = {
	name: KEY,
	async read( sitePath ) {
		return {
			code: await activeCodeVersion( sitePath, ( name ) => /\.(php|json|html)$/.test( name ) ),
			content: JSON.stringify( await readVersions( sitePath ) ),
		};
	},
	async check( site, before, after ) {
		if ( before.code === after.code && before.content === after.content ) {
			return { reports: [] };
		}
		let bare: Record< string, string[] >;
		try {
			const output = await runWpCli( site, [ 'eval', BARE ] );
			bare = JSON.parse(
				output.slice( output.indexOf( 'BARE_STYLE_CLASSES=' ) + 'BARE_STYLE_CLASSES='.length )
			) as Record< string, string[] >;
		} catch {
			// Code that does not load is reported by what runs it.
			return { reports: [] };
		}
		const found = Object.entries( bare ).map( ( [ block, where ] ) => {
			const [ name, style ] = block.split( ' ' );
			const places = [ ...new Set( where ) ];
			return `${
				where.length
			} ${ name } block(s) with the class "${ style }" and not "is-style-${ style }" (in ${ places.join(
				', '
			) })`;
		} );
		return {
			reports: [
				{
					key: KEY,
					atTurnEnd: true,
					problem: found.length
						? `${
								site.name
						  }: the site registers block styles that its blocks carry by bare name: ${ found.join(
								'; '
						  ) }. WordPress applies a block style through the class is-style-<name> in the block's "className": the editor's block styles panel adds it (replaceActiveStyle() in @wordpress/block-editor), and WordPress reads a block's style variation from it (wp_get_block_style_variation_name_from_class() in wp-includes/block-supports/block-style-variations.php). These blocks have no style applied, and the editor shows none selected. Give each "is-style-<name>" in its "className", where its markup is written.`
						: undefined,
				},
			],
		};
	},
};
