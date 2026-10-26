/**
 * The blocks of a post or page that WordPress renders as nothing on the front
 * end. Validation compares the markup written with what the block saves, so a
 * block whose save is empty, as a slideshow written without its slides is,
 * passes it and still shows nothing. Studio renders the content as the front
 * end does, through the_content, whose do_blocks() renders each block with
 * render_block() (wp-includes/blocks.php), and names the blocks whose output
 * is empty.
 */
import { readPosts, readVersions } from 'cli/ai/post-content-check';
import { runWpCli } from 'cli/ai/tools/utils';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import type { ChangeReport, SiteChangeSource } from 'cli/ai/site-changes';
import type { SiteData } from 'cli/lib/cli-config/core';

// The post types whose content the front end renders through the_content.
const FRONT_END_TYPES = new Set( [ 'post', 'page' ] );

const RENDER = ( ids: number[] ) => `
$empty = array();
foreach ( ${ JSON.stringify( ids ) } as $id ) {
	$post = get_post( $id );
	if ( ! $post ) {
		continue;
	}
	$GLOBALS['post'] = $post;
	setup_postdata( $post );
	$found = array();
	// A dynamic block renders its inner blocks into its own output, as a
	// form field does its label, so their output alone is not what shows.
	$parent = function ( $parsed, $source, $parent_block ) {
		$parsed['studioInDynamicBlock'] = $parent_block && $parent_block->block_type && $parent_block->block_type->is_dynamic();
		return $parsed;
	};
	$record = function ( $html, $block ) use ( &$found ) {
		if ( ! empty( $block['blockName'] ) && empty( $block['studioInDynamicBlock'] ) && '' === trim( $html ) ) {
			$type    = WP_Block_Type_Registry::get_instance()->get_registered( $block['blockName'] );
			$sourced = array();
			foreach ( $type ? (array) $type->attributes : array() as $name => $attribute ) {
				if ( isset( $attribute['source'] ) && 'meta' !== $attribute['source'] ) {
					$sourced[] = $name;
				}
			}
			// The file a block.json "render" names, which
			// register_block_type_from_metadata() requires inside an output buffer.
			$render = null;
			if ( $type && $type->render_callback instanceof Closure ) {
				$used   = ( new ReflectionFunction( $type->render_callback ) )->getStaticVariables();
				$render = isset( $used['template_path'] ) && is_string( $used['template_path'] ) ? $used['template_path'] : null;
			}
			$found[] = array(
				'name'    => $block['blockName'],
				'saved'   => '' !== trim( implode( '', array_filter( $block['innerContent'], 'is_string' ) ) ),
				'sourced' => $sourced,
				'render'  => $render,
			);
		}
		return $html;
	};
	add_filter( 'render_block_data', $parent, PHP_INT_MAX, 3 );
	add_filter( 'render_block', $record, PHP_INT_MAX, 2 );
	apply_filters( 'the_content', $post->post_content );
	remove_filter( 'render_block', $record, PHP_INT_MAX );
	remove_filter( 'render_block_data', $parent, PHP_INT_MAX );
	wp_reset_postdata();
	$empty[ $id ] = $found;
}
echo 'EMPTY_BLOCKS=' . wp_json_encode( (object) $empty );`;

interface EmptyBlock {
	name: string;
	saved: boolean;
	sourced: string[];
	render: string | null;
}

/** The blocks of each post that render as nothing, by post ID. */
export async function emptyBlocks(
	site: SiteData,
	ids: number[]
): Promise< Record< string, EmptyBlock[] > > {
	try {
		await connectToDaemon();
		const output = await runWpCli( site, [ 'eval', RENDER( ids ) ] );
		return JSON.parse(
			output.slice( output.indexOf( 'EMPTY_BLOCKS=' ) + 'EMPTY_BLOCKS='.length )
		) as Record< string, EmptyBlock[] >;
	} finally {
		await disconnectFromDaemon();
	}
}

// Whether the block is one written without the saved HTML its attributes are read from.
const unsaved = ( block: EmptyBlock ) => ! block.saved && block.sourced.length > 0;

function describe( block: EmptyBlock ): string {
	if ( block.render ) {
		return `${ block.name }, whose output is what ${ block.render } prints: register_block_type_from_metadata() (wp-includes/blocks.php) requires the file inside ob_start() and returns ob_get_clean()`;
	}
	if ( ! unsaved( block ) ) {
		return block.name;
	}
	return `${
		block.name
	}, written without saved HTML, which its block.json reads ${ block.sourced.join(
		', '
	) } from (each attribute's "source")`;
}

export const renderedBlocks: SiteChangeSource = {
	name: 'rendered blocks',
	read: readVersions,
	async check( site, before, after ) {
		const changed = Object.keys( after ).filter( ( id ) => before[ id ] !== after[ id ] );
		const posts = ( changed.length ? await readPosts( site.path, changed ) : [] ).filter(
			( post ) => FRONT_END_TYPES.has( post.type )
		);
		if ( ! posts.length ) {
			return { reports: [] };
		}
		// A site WordPress cannot render for says nothing, as a failed note does.
		const empty = await emptyBlocks(
			site,
			posts.map( ( post ) => post.id )
		).catch( () => undefined );
		if ( ! empty ) {
			return { reports: [] };
		}
		const reports: ChangeReport[] = posts.map( ( post ) => {
			const blocks = empty[ post.id ] ?? [];
			return {
				key: `rendered ${ post.id }`,
				problem: blocks.length
					? `${ site.name } ${ post.type } ${ post.id } "${
							post.title
					  }": WordPress renders these blocks as nothing on the front end (render_block() through the_content, in wp-includes/blocks.php): ${ blocks
							.map( describe )
							.join( '; ' ) }.${
							blocks.some( unsaved )
								? " The block editor writes a block's saved HTML from its attributes when it inserts it."
								: ''
					  }`
					: undefined,
			};
		} );
		return { reports };
	},
};
