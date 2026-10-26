import { createHash } from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { Type } from 'typebox';
import { sitePresetValues, validateBlockMarkup } from 'cli/ai/block-validation-gate';
import { validateBlocks } from 'cli/ai/block-validator';
import { getSiteFileWriteRefusal, resolveSiteFile } from 'cli/ai/site-file-guards';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { resolvePhpTransformer } from 'cli/lib/import-runtime';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { resolveSite, runWpCli, textResult } from './utils';
import type { SiteData } from 'cli/lib/cli-config/core';

interface SupportStylesheet {
	placement: string;
	target: string;
	content: string;
}

interface Conversion {
	original: string;
	status: string;
	serialized: string;
	stylesheets: SupportStylesheet[];
	diagnostics: Record< string, number >;
	lost: { words: string[]; images: string[] };
	stylesheetDirectory: string;
}

// Converts `$data['content']`, or post `$data['post_id']`'s content, with the
// Blocks Engine PHP transformer in the site's WordPress, so core's block parser
// and serializer build the result. The theme's own stylesheets, as WordPress
// enqueues them on the front end, tell the transformer how the HTML looks.
// What the page shows before and after (do_blocks()) is compared word for word
// and image for image.
const CONVERT = `require_once $data['bootstrap'];
$original = isset( $data['post_id'] ) ? (string) get_post_field( 'post_content', (int) $data['post_id'], 'raw' ) : (string) $data['content'];
do_action( 'wp_enqueue_scripts' );
$styles = wp_styles();
$styles->all_deps( $styles->queue );
$roots = array( get_stylesheet_directory_uri() => get_stylesheet_directory(), get_template_directory_uri() => get_template_directory() );
$css = '';
foreach ( $styles->to_do as $handle ) {
	$src = (string) ( $styles->registered[ $handle ]->src ?? '' );
	foreach ( $roots as $uri => $dir ) {
		if ( str_starts_with( $src, $uri . '/' ) ) {
			$file = $dir . substr( strtok( $src, '?' ), strlen( $uri ) );
			$css .= ( is_readable( $file ) ? file_get_contents( $file ) : '' ) . "\\n" . implode( "\\n", (array) $styles->get_data( $handle, 'after' ) ) . "\\n";
		}
	}
}
$result = ( new Automattic\\BlocksEngine\\PhpTransformer\\HtmlToBlocks\\HtmlTransformer() )->transform( $original, array( 'static_css' => $css ) )->toArray();
$visible = static function ( string $markup ): array {
	$html = do_blocks( $markup );
	$text = preg_replace( '/<[^>]+>/', ' ', preg_replace( '@<(script|style)[^>]*?>.*?</\\\\1>@si', '', $html ) );
	$words = preg_split( '/\\s+/u', html_entity_decode( $text, ENT_QUOTES | ENT_HTML5, 'UTF-8' ), -1, PREG_SPLIT_NO_EMPTY );
	$images = array();
	$tags = new WP_HTML_Tag_Processor( $html );
	while ( $tags->next_tag( 'img' ) ) {
		$images[] = (string) $tags->get_attribute( 'src' );
	}
	return array( array_count_values( $words ), array_count_values( $images ) );
};
$serialized = (string) ( $result['serialized_blocks'] ?? '' );
list( $words_before, $images_before ) = $visible( $original );
list( $words_after, $images_after ) = $visible( $serialized );
$lost = static fn( array $before, array $after ): array => array_keys( array_filter( $before, static fn( $count, $item ) => $count > ( $after[ $item ] ?? 0 ), ARRAY_FILTER_USE_BOTH ) );
$diagnostics = array();
foreach ( (array) ( $result['diagnostics'] ?? array() ) as $diagnostic ) {
	$code = (string) ( $diagnostic['code'] ?? 'diagnostic' );
	$diagnostics[ $code ] = ( $diagnostics[ $code ] ?? 0 ) + 1;
}
$stylesheets = array();
foreach ( (array) ( $result['assets'] ?? array() ) as $asset ) {
	if ( 'stylesheet' === ( $asset['role'] ?? '' ) && in_array( $asset['stylesheet_placement'] ?? '', array( 'before-author', 'after-author' ), true ) ) {
		$stylesheets[] = array( 'placement' => $asset['stylesheet_placement'], 'target' => (string) ( $asset['stylesheet_target'] ?? 'both' ), 'content' => (string) $asset['content'] );
	}
}
echo wp_json_encode( array(
	'original' => $original,
	'status' => (string) ( $result['status'] ?? '' ),
	'serialized' => $serialized,
	'stylesheets' => $stylesheets,
	'diagnostics' => (object) $diagnostics,
	'lost' => array( 'words' => $lost( $words_before, $words_after ), 'images' => $lost( $images_before, $images_after ) ),
	'stylesheetDirectory' => get_stylesheet_directory(),
) );`;

// A post's content is saved as an administrator, whose content WordPress keeps
// as written (kses_init() only filters users without unfiltered_html).
const SAVE_POST = `$admins = get_users( array( 'role' => 'administrator', 'number' => 1, 'fields' => 'ID' ) );
wp_set_current_user( (int) ( $admins[0] ?? 0 ) );
$saved = wp_update_post( array( 'ID' => (int) $data['post_id'], 'post_content' => wp_slash( $data['content'] ) ), true );
echo is_wp_error( $saved ) ? $saved->get_error_message() : 'saved';`;

const SUPPORT_DIRECTORY = 'assets/css/blocks-engine';
const SUPPORT_LOADER = 'blocks-engine-styles.php';

// Loads the support stylesheets in the places the engine gives them: a
// before-author sheet ahead of the theme's own styles and an after-author sheet
// after them, on the front end and in the editor as each sheet's target says.
const SUPPORT_LOADER_PHP = `<?php
/**
 * Loads the support stylesheets Blocks Engine returned when Studio converted HTML in this theme to blocks.
 * Each file is named <placement>.<target>.<hash>.css: before-author sheets load ahead of the theme's
 * stylesheets and after-author sheets after them, on the front end (target both or frontend) and in
 * the editor (target both or editor).
 */

function blocks_engine_support_styles( string $placement, string $context ): void {
	foreach ( glob( __DIR__ . '/${ SUPPORT_DIRECTORY }/' . $placement . '.*.css' ) ?: array() as $file ) {
		list( , $target, $hash ) = explode( '.', basename( $file, '.css' ) );
		if ( 'both' === $target || $context === $target ) {
			wp_enqueue_style( 'blocks-engine-' . $placement . '-' . $hash, get_theme_file_uri( '${ SUPPORT_DIRECTORY }/' . basename( $file ) ), array(), null );
		}
	}
}

add_action( 'wp_enqueue_scripts', static fn() => blocks_engine_support_styles( 'before-author', 'frontend' ), 1 );
add_action( 'wp_enqueue_scripts', static fn() => blocks_engine_support_styles( 'after-author', 'frontend' ), PHP_INT_MAX );
add_action( 'enqueue_block_assets', static fn() => is_admin() && blocks_engine_support_styles( 'before-author', 'editor' ), 1 );
add_action( 'enqueue_block_assets', static fn() => is_admin() && blocks_engine_support_styles( 'after-author', 'editor' ), PHP_INT_MAX );
`;

const REQUIRE_LOADER = `require_once __DIR__ . '/${ SUPPORT_LOADER }';`;

async function evalWithData( site: SiteData, php: string, data: unknown ): Promise< string > {
	const encoded = Buffer.from( JSON.stringify( data ) ).toString( 'base64' );
	await connectToDaemon();
	try {
		return await runWpCli( site, [
			'eval',
			`$data = json_decode( base64_decode( '${ encoded }' ), true );\n${ php }`,
		] );
	} finally {
		await disconnectFromDaemon();
	}
}

async function readOptional( file: string ): Promise< string | undefined > {
	return readFile( file, 'utf8' ).catch( () => undefined );
}

/**
 * Writes the support stylesheets into the theme, one file per placement and
 * target in the engine's order, and has the theme's functions.php load them.
 * Returns the files written, relative to the theme.
 */
async function installSupportStylesheets(
	themeDirectory: string,
	stylesheets: SupportStylesheet[]
): Promise< string[] > {
	const groups = new Map< string, string[] >();
	for ( const { placement, target, content } of stylesheets ) {
		const key = `${ placement }.${ target }`;
		groups.set( key, [ ...( groups.get( key ) ?? [] ), content ] );
	}
	const written: string[] = [];
	await mkdir( path.join( themeDirectory, SUPPORT_DIRECTORY ), { recursive: true } );
	for ( const [ key, contents ] of groups ) {
		const css = contents.join( '\n' );
		const hash = createHash( 'sha256' ).update( css ).digest( 'hex' ).slice( 0, 16 );
		const file = `${ SUPPORT_DIRECTORY }/${ key }.${ hash }.css`;
		await writeFile( path.join( themeDirectory, file ), css );
		written.push( file );
	}
	if ( written.length === 0 ) {
		return written;
	}
	await writeFile( path.join( themeDirectory, SUPPORT_LOADER ), SUPPORT_LOADER_PHP );
	written.push( SUPPORT_LOADER );
	const functionsPath = path.join( themeDirectory, 'functions.php' );
	const functions = await readOptional( functionsPath );
	if ( ! functions?.includes( REQUIRE_LOADER ) ) {
		const base = functions?.trimEnd() ?? '<?php';
		const open = base.endsWith( '?>' ) ? '\n<?php ' : '\n\n';
		await writeFile( functionsPath, `${ base }${ open }${ REQUIRE_LOADER }\n` );
		written.push( 'functions.php' );
	}
	return written;
}

async function writeRefusal( filePath: string ): Promise< string | undefined > {
	const siteFile = resolveSiteFile( filePath );
	return siteFile ? getSiteFileWriteRefusal( siteFile ) : undefined;
}

export const convertToBlocksTool = defineTool(
	'convert_to_blocks',
	"Converts the HTML in a block markup file or a post to editable blocks with Blocks Engine, keeping the blocks it already has. It runs in the site's WordPress, styled by the active theme's stylesheets, saves the result, and adds the support stylesheets the conversion returns to the active theme. It saves nothing when the page would lose text or an image, and lists what would be lost.",
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
		file: Type.Optional(
			Type.String( {
				description:
					'Absolute path of a block markup (.html) file in the site, such as a theme template or template part',
			} )
		),
		postId: Type.Optional(
			Type.Number( { description: 'ID of the post whose content to convert' } )
		),
	},
	async ( args, { onProgress } ) => {
		const site = await resolveSite( args.nameOrPath );
		if ( ( args.file === undefined ) === ( args.postId === undefined ) ) {
			throw new Error( 'Pass either file or postId.' );
		}
		const file = args.file && path.resolve( args.file );
		if ( file ) {
			if (
				! file.startsWith( path.resolve( site.path ) + path.sep ) ||
				! file.endsWith( '.html' )
			) {
				throw new Error( `${ file } is not a .html file in ${ site.path }.` );
			}
			const refusal = await writeRefusal( file );
			if ( refusal ) {
				throw new Error( refusal );
			}
		}

		onProgress( 'Preparing Blocks Engine' );
		const transformer = await resolvePhpTransformer();
		onProgress( `Converting with Blocks Engine ${ transformer.version }` );
		const output = await evalWithData( site, CONVERT, {
			bootstrap: transformer.bootstrap,
			...( file ? { content: await readFile( file, 'utf8' ) } : { post_id: args.postId } ),
		} );
		const conversion = JSON.parse( output.slice( output.indexOf( '{' ) ) ) as Conversion;
		const label = file ? path.relative( site.path, file ) : `post ${ args.postId }`;
		const diagnostics = Object.entries( conversion.diagnostics )
			.map( ( [ code, count ] ) => `${ code } ×${ count }` )
			.join( ', ' );
		const engine = `Blocks Engine ${ transformer.version }: ${ conversion.status }${
			diagnostics ? ` (${ diagnostics })` : ''
		}`;
		const { words, images } = conversion.lost;
		if ( words.length || images.length ) {
			return textResult(
				[
					`${ label } is unchanged: converted, the page (do_blocks()) would lose ${ [
						words.length && `${ words.length } word(s): ${ words.slice( 0, 30 ).join( ' ' ) }`,
						images.length && `${ images.length } image(s): ${ images.join( ', ' ) }`,
					]
						.filter( Boolean )
						.join( ', and ' ) }.`,
					engine,
				].join( '\n' )
			);
		}

		const themeRefusal = conversion.stylesheets.length
			? await writeRefusal( path.join( conversion.stylesheetDirectory, 'functions.php' ) )
			: undefined;
		if ( themeRefusal ) {
			throw new Error( themeRefusal );
		}

		onProgress( 'Validating blocks' );
		const siteUrl = getSiteUrl( site );
		const before = await validateBlocks( conversion.original, siteUrl );
		const validation = await validateBlockMarkup(
			conversion.serialized,
			label,
			siteUrl,
			await sitePresetValues( site.path )
		);
		const content = validation.fixedContent ?? conversion.serialized;

		if ( file ) {
			await writeFile( file, content );
		} else {
			const saved = await evalWithData( site, SAVE_POST, { post_id: args.postId, content } );
			if ( ! saved.includes( 'saved' ) ) {
				throw new Error( `Saving post ${ args.postId } failed: ${ saved.trim() }` );
			}
		}
		const stylesheets = await installSupportStylesheets(
			conversion.stylesheetDirectory,
			conversion.stylesheets
		);

		return textResult(
			[
				`Saved ${ label } as blocks.`,
				engine,
				before.error
					? undefined
					: `Before: ${ before.invalidBlocks }/${ before.totalBlocks } blocks invalid, ${
							before.results.filter( ( result ) => result.blockName === 'core/freeform' ).length
					  } Classic.`,
				`After: ${ validation.summary }`,
				validation.problem,
				stylesheets.length
					? `Support stylesheets in ${ conversion.stylesheetDirectory }: ${ stylesheets.join(
							', '
					  ) }`
					: undefined,
			]
				.filter( Boolean )
				.join( '\n' )
		);
	},
	{ annotations: LOCAL_CHANGE }
);
