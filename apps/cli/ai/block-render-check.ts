/**
 * The blocks of a post or page that WordPress renders as nothing on the front
 * end. Validation compares the markup written with what the block saves, so a
 * block whose save is empty, as a slideshow written without its slides is,
 * passes it and still shows nothing. Studio renders the content as the front
 * end does, through the_content, whose do_blocks() renders each block with
 * render_block() (wp-includes/blocks.php), and names the blocks whose output
 * is empty.
 *
 * A template, template part or pattern renders inside a page, so when one
 * changes Studio renders the front page as a visitor who is not logged in
 * gets it, and states which of its blocks rendered as nothing. Blocks render
 * as nothing there by design, as a query's pagination does with one page of
 * posts, so that is what WordPress shows, not a problem.
 */
import { readFile, stat } from 'fs/promises';
import path from 'path';
import { readPosts, readVersions } from 'cli/ai/post-content-check';
import { readWordPressSite } from 'cli/ai/site-database';
import { themeMarkupFiles } from 'cli/ai/site-markup';
import { runWpCli } from 'cli/ai/tools/utils';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import type { ChangeReport, SiteChangeSource, Versions } from 'cli/ai/site-changes';
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

// The front page as template-loader.php resolves it for '/', rendered by
// get_the_block_template_html() (wp-includes/block-template.php). The blocks a
// dynamic block renders into its own output, and the content core/post-content
// renders, which the posts' own check covers, are not named.
const RENDER_FRONT_PAGE = `
$_SERVER['REQUEST_URI'] = '/';
wp();
$names   = array();
$content = 0;
add_filter( 'render_block_data', function ( $parsed, $source, $parent_block ) use ( &$content ) {
	$parsed['studioSkipped'] = $content > 0 || ( $parent_block && $parent_block->block_type && $parent_block->block_type->is_dynamic() );
	if ( 'core/post-content' === $parsed['blockName'] ) {
		++$content;
	}
	return $parsed;
}, PHP_INT_MAX, 3 );
add_filter( 'render_block', function ( $html, $block ) use ( &$names, &$content ) {
	if ( 'core/post-content' === $block['blockName'] ) {
		--$content;
	}
	if ( ! empty( $block['blockName'] ) && empty( $block['studioSkipped'] ) && '' === trim( $html ) ) {
		$names[] = $block['blockName'];
	}
	return $html;
}, PHP_INT_MAX, 2 );
$template = false;
foreach ( array( 'is_front_page' => 'get_front_page_template', 'is_home' => 'get_home_template', 'is_page' => 'get_page_template', 'is_singular' => 'get_singular_template' ) as $tag => $getter ) {
	if ( $tag() && ( $template = $getter() ) ) {
		break;
	}
}
if ( ! $template ) {
	get_index_template();
}
if ( ! empty( $GLOBALS['_wp_current_template_content'] ) ) {
	get_the_block_template_html();
}
echo 'FRONT_EMPTY=' . wp_json_encode( array_values( array_unique( $names ) ) );`;

/** The blocks of the front page that render as nothing for a visitor who is not logged in. */
async function frontPageEmptyBlocks( site: SiteData ): Promise< string[] > {
	try {
		await connectToDaemon();
		const output = await runWpCli( site, [ 'eval', RENDER_FRONT_PAGE ] );
		return JSON.parse(
			output.slice( output.indexOf( 'FRONT_EMPTY=' ) + 'FRONT_EMPTY='.length )
		) as string[];
	} finally {
		await disconnectFromDaemon();
	}
}

const FILE = 'file ';

// The posts the front end renders, and the active theme's template, template
// part and pattern files, by modification time and size.
async function readRenderedVersions( sitePath: string ): Promise< Versions > {
	const themes = await readWordPressSite( sitePath, ( site ) => [
		...new Set( [ site.option( 'template' ), site.option( 'stylesheet' ) ] ),
	] );
	const files = (
		await Promise.all(
			themes
				.filter( ( theme ): theme is string => typeof theme === 'string' && theme !== '' )
				.map( ( theme ) =>
					themeMarkupFiles( path.join( sitePath, 'wp-content', 'themes', theme ) )
				)
		)
	).flat();
	const versions = await Promise.all(
		files.map( async ( file ) => {
			const { mtimeMs, size } = await stat( file );
			return [ FILE + file, `${ mtimeMs }:${ size }` ];
		} )
	);
	return { ...( await readVersions( sitePath ) ), ...Object.fromEntries( versions ) };
}

// The blocks a piece of markup holds, by name, as the block parser names them.
const blockNames = ( markup: string ) =>
	[ ...markup.matchAll( /<!-- wp:([a-z][a-z0-9_-]*\/)?([a-z][a-z0-9_-]*)/g ) ].map(
		( [ , namespace, name ] ) => ( namespace ?? 'core/' ) + name
	);

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
	read: readRenderedVersions,
	async check( site, before, after ) {
		const changed = Object.keys( after ).filter( ( key ) => before[ key ] !== after[ key ] );
		const files = changed.filter( ( key ) => key.startsWith( FILE ) );
		const ids = changed.filter( ( key ) => ! key.startsWith( FILE ) );
		const read = ids.length ? await readPosts( site.path, ids ) : [];
		const posts = read.filter( ( post ) => FRONT_END_TYPES.has( post.type ) );
		const shared = [
			...read
				.filter( ( post ) => ! FRONT_END_TYPES.has( post.type ) )
				.map( ( post ) => post.content ),
			...( await Promise.all(
				files.map( ( key ) => readFile( key.slice( FILE.length ), 'utf8' ).catch( () => '' ) )
			) ),
		];
		const reports = [
			...( shared.length ? await frontPageReports( site, shared ) : [] ),
			...( posts.length ? await postReports( site, posts ) : [] ),
		];
		return { reports };
	},
};

// What the front page renders as nothing of the blocks in the changed markup.
async function frontPageReports( site: SiteData, markup: string[] ): Promise< ChangeReport[] > {
	const names = new Set( markup.flatMap( blockNames ) );
	const empty = await frontPageEmptyBlocks( site ).catch( () => [] as string[] );
	const named = empty.filter( ( name ) => names.has( name ) );
	return named.length
		? [
				{
					key: 'front page rendered',
					summary: `${
						site.name
					} front page: of the blocks in the changed templates, template parts and patterns, WordPress renders ${ named.join(
						', '
					) } as nothing for a visitor who is not logged in (render_block() through get_the_block_template_html(), in wp-includes/block-template.php).`,
				},
		  ]
		: [];
}

async function postReports(
	site: SiteData,
	posts: Awaited< ReturnType< typeof readPosts > >
): Promise< ChangeReport[] > {
	// A site WordPress cannot render for says nothing, as a failed note does.
	const empty = await emptyBlocks(
		site,
		posts.map( ( post ) => post.id )
	).catch( () => undefined );
	if ( ! empty ) {
		return [];
	}
	return posts.map( ( post ) => {
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
}
