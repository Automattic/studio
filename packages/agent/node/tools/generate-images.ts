import fs from 'fs/promises';
import path from 'path';
import { Type } from 'typebox';
import {
	composeImagePrompt,
	generateImages,
	type GenerateImageResult,
	IMAGE_ASPECT_RATIOS,
	IMAGE_STYLES,
	isImageGenerationAvailable,
} from '@studio/agent/node/image-generation';
import { defineTool, REMOTE_CHANGE } from './define-tool';
import { runWpCli, textResult } from './utils';
import type { StudioToolDefinition } from './define-tool';
import type { HostSite, StudioAgentHost } from '@studio/agent/node/host';

const MAX_IMAGES_PER_CALL = 20;
const UPLOADS_DIR = path.sep + path.join( 'wp-content', 'uploads' ) + path.sep;

// Exported for tests. Generated files are jailed to the sites root like the
// pi Write tool.
export function resolveImageFilePath( sitesRoot: string, filePath: string ): string {
	const resolved = path.resolve( filePath );
	if ( resolved !== sitesRoot && ! resolved.startsWith( sitesRoot + path.sep ) ) {
		throw new Error(
			`Image path must be inside the Studio sites directory (${ sitesRoot }): ${ filePath }`
		);
	}
	return resolved;
}

async function findSiteContaining(
	host: StudioAgentHost,
	filePaths: string[]
): Promise< HostSite > {
	const sites = await host.sites.all();
	const site = sites.find( ( candidate ) =>
		filePaths.every( ( filePath ) =>
			filePath.startsWith( path.resolve( candidate.path ) + path.sep )
		)
	);
	if ( ! site ) {
		throw new Error( 'Images under wp-content/uploads must all be inside one Studio site.' );
	}
	return site;
}

interface Attachment {
	id: number;
	file: string;
	url: string;
}

// Runs `php` through WP-CLI with `data` decoded into `$data`.
async function evalWithData(
	host: StudioAgentHost,
	site: HostSite,
	php: string,
	data: unknown
): Promise< string > {
	const encoded = Buffer.from( JSON.stringify( data ) ).toString( 'base64' );
	return runWpCli( host, site, [
		'eval',
		`$data = json_decode( base64_decode( '${ encoded }' ), true );\n${ php }`,
	] );
}

// Media-library images get their attachment before they are generated, so the
// result can give their IDs and URLs right away.
const RESERVE_ATTACHMENTS = `$upload = wp_upload_dir();
$reserved = array();
foreach ( $data as $name ) {
	$filename = wp_unique_filename( $upload['path'], $name );
	$id = wp_insert_attachment( array( 'guid' => $upload['url'] . '/' . $filename, 'post_mime_type' => wp_check_filetype( $filename )['type'] ?: 'image/png', 'post_title' => pathinfo( $filename, PATHINFO_FILENAME ), 'post_content' => '', 'post_status' => 'inherit' ), $upload['path'] . '/' . $filename );
	$reserved[] = array( 'id' => $id, 'file' => substr( $upload['path'], strlen( ABSPATH ) ) . '/' . $filename, 'url' => wp_get_attachment_url( $id ) );
}
echo wp_json_encode( $reserved );`;

/**
 * The image model delivers PNGs. An image whose path names another format,
 * such as a.jpg, is saved in it by WordPress's image editor, which takes the
 * type from the extension (WP_Image_Editor::get_output_format()), where
 * wp_image_editor_supports() says it saves the type wp_check_filetype()
 * gives the extension (wp-includes/media.php). The PNG is removed either way; an image WordPress
 * cannot save gets WordPress's reason.
 */
const CONVERT_IMAGES = `require_once ABSPATH . 'wp-admin/includes/image.php';
$errors = array();
foreach ( $data as $image ) {
	$type = wp_check_filetype( $image['to'] )['type'];
	$editor = wp_get_image_editor( $image['from'] );
	if ( ! $type || ! wp_image_editor_supports( array( 'mime_type' => $type ) ) ) {
		$errors[ $image['to'] ] = "WordPress's image editor does not save ." . pathinfo( $image['to'], PATHINFO_EXTENSION ) . ' files (wp_image_editor_supports())';
	} elseif ( is_wp_error( $editor ) ) {
		$errors[ $image['to'] ] = $editor->get_error_message();
	} else {
		$saved = $editor->save( $image['to'] );
		$errors[ $image['to'] ] = is_wp_error( $saved ) ? $saved->get_error_message() : '';
	}
	wp_delete_file( $image['from'] );
}
echo wp_json_encode( (object) $errors );`;

// Each converted image's path, with '' once saved or WordPress's reason not.
async function convertImages(
	host: StudioAgentHost,
	site: HostSite | undefined,
	conversions: { from: string; to: string }[]
): Promise< Record< string, string > > {
	if ( ! site ) {
		await Promise.all( conversions.map( ( { from } ) => fs.rm( from, { force: true } ) ) );
		return Object.fromEntries(
			conversions.map( ( { to } ) => [
				to,
				'it is in no Studio site whose WordPress could save it',
			] )
		);
	}
	const output = await evalWithData( host, site, CONVERT_IMAGES, conversions );
	return JSON.parse( output.trim().split( '\n' ).pop() ?? '{}' );
}

const isPng = ( file: string ) => path.extname( file ).toLowerCase() === '.png';

const FINALIZE_ATTACHMENTS = `require_once ABSPATH . 'wp-admin/includes/image.php';
foreach ( $data['ready'] as $id ) {
	wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, get_attached_file( $id ) ) );
}
foreach ( $data['failed'] as $id ) {
	wp_delete_attachment( $id, true );
}`;

export const generateImagesTool = defineTool(
	'generate_images',
	"Generate AI images from text specs and write them to files inside a site. An image written under the site's wp-content/uploads/ is added to its media library; any other image, such as theme imagery in a theme's assets/images, stays where it is written. " +
		'Batch every image a page or site needs into as few calls as possible; each call accepts up to ' +
		`${ MAX_IMAGES_PER_CALL } images and generates them concurrently. ` +
		"The call returns at once with each image's path, and for the media library its attachment ID and URL, while the images are generated in the background: the tools that render the site wait for them, and any that failed is reported with a later tool result. " +
		'Failures are reported per image: a safety-filtered image should be retried once with a rewritten subject; other failures should lead you to adapt the layout rather than leave a broken image reference.',
	{
		images: Type.Array(
			Type.Object( {
				path: Type.String( {
					description:
						"Absolute file path to write the generated image to, inside the Studio sites directory. Its extension picks the format: .png as generated, or another WordPress's image editor saves, such as .jpg or .webp. Under a site's wp-content/uploads/, the image is imported into the media library: the file moves to the uploads folder WordPress picks, and the result gives that path, its attachment ID and its URL. Anywhere else, such as a theme's assets/images, the file stays at this path.",
				} ),
				subject: Type.String( {
					description:
						'What the image shows and from what point of view (composition, framing, vantage, mood). 1-3 sentences, of the scene alone: the page carries the words, and imageGrade the treatment all images share.',
				} ),
				pageContext: Type.Optional(
					Type.String( {
						description:
							'Where and how the image is used, in pictorial slot language (e.g. "full-frame editorial photograph with the left third kept as open, low-detail negative space"), not layout words such as "hero" or "headline", which get drawn. Steers mood and composition; it is not drawn. Write in English.',
					} )
				),
				style: Type.Optional(
					Type.Enum( Object.fromEntries( IMAGE_STYLES.map( ( style ) => [ style, style ] ) ), {
						description: 'Rendering style. Defaults to photorealistic.',
					} )
				),
				aspectRatio: Type.Optional(
					Type.Enum(
						Object.fromEntries( IMAGE_ASPECT_RATIOS.map( ( ratio ) => [ ratio, ratio ] ) ),
						{
							description:
								'Canvas shape, matched to the layout slot: images in one row or grid share a ratio, and full-bleed backgrounds are landscape or ultrawide. Defaults to landscape.',
						}
					)
				),
			} ),
			{ minItems: 1, maxItems: MAX_IMAGES_PER_CALL }
		),
		siteContext: Type.Optional(
			Type.String( {
				description:
					"One sentence of subject matter steering shared by all images (e.g. 'A neighborhood bakery selling sourdough and pastries.'). Studio leaves the site's name out of the prompt, since the image model paints a name it is given in as a fake wordmark.",
			} )
		),
		imageGrade: Type.Optional(
			Type.String( {
				description:
					'One site-wide photographic treatment applied to every image so they read as one series (e.g. "warm natural window light, soft muted color"). Keep it identical across calls for the same site.',
			} )
		),
	},
	async ( args, { host } ) => {
		if ( ! ( await isImageGenerationAvailable() ) ) {
			throw new Error(
				'Image generation is not available in this session. Build the site without generated imagery.'
			);
		}

		const targets = args.images.map( ( image ) => ( {
			...image,
			resolvedPath: resolveImageFilePath( host.sitesRoot, image.path ),
		} ) );
		const libraryTargets = targets.filter( ( target ) =>
			target.resolvedPath.includes( UPLOADS_DIR )
		);
		const site = libraryTargets.length
			? await findSiteContaining(
					host,
					libraryTargets.map( ( target ) => target.resolvedPath )
			  )
			: undefined;
		const attachments = new Map< string, Attachment >();
		if ( site ) {
			const output = await evalWithData(
				host,
				site,
				RESERVE_ATTACHMENTS,
				libraryTargets.map( ( target ) => path.basename( target.resolvedPath ) )
			);
			const reserved: Attachment[] = JSON.parse( output.trim().split( '\n' ).pop() ?? '[]' );
			libraryTargets.forEach( ( target, index ) =>
				attachments.set( target.resolvedPath, {
					...reserved[ index ],
					file: path.join( site.path, reserved[ index ].file ),
				} )
			);
		}

		// The site the images are for, wherever in it they are written.
		const forSite =
			site ??
			( await host.sites.all() ).find( ( candidate ) =>
				targets.every( ( target ) =>
					target.resolvedPath.startsWith( path.resolve( candidate.path ) + path.sep )
				)
			);
		const siteName = forSite?.name;
		const requests = targets.map( ( image ) => ( {
			prompt: composeImagePrompt( image, {
				siteContext: args.siteContext,
				imageGrade: args.imageGrade,
				siteName,
			} ),
			aspectRatio: image.aspectRatio,
		} ) );

		const generation = generateImages( host.userAgent, requests )
			.catch( ( error ): GenerateImageResult[] =>
				requests.map( () => ( { ok: false, error: String( error ) } ) )
			)
			.then( async ( results ) => {
				const failures: string[] = [];
				const conversions: { from: string; to: string }[] = [];
				await Promise.all(
					results.map( async ( result, index ) => {
						const target = targets[ index ];
						if ( ! result.ok || ! result.bytes ) {
							const hint = result.filtered
								? ' (safety filter — rewrite the subject to avoid the sensitive element and call generate_images again for this image)'
								: '';
							failures.push( `FAILED ${ target.path }: ${ result.error }${ hint }` );
							return;
						}
						const file = attachments.get( target.resolvedPath )?.file ?? target.resolvedPath;
						await fs.mkdir( path.dirname( file ), { recursive: true } );
						if ( isPng( file ) ) {
							await fs.writeFile( file, result.bytes );
							return;
						}
						const png = path.join( path.dirname( file ), `.${ path.basename( file ) }.png` );
						await fs.writeFile( png, result.bytes );
						conversions.push( { from: png, to: file } );
					} )
				);
				if ( conversions.length ) {
					const errors = await convertImages( host, forSite, conversions );
					for ( const { to } of conversions ) {
						if ( errors[ to ] === '' ) {
							continue;
						}
						const index = targets.findIndex(
							( target ) =>
								( attachments.get( target.resolvedPath )?.file ?? target.resolvedPath ) === to
						);
						const error = errors[ to ] ?? 'WordPress did not save it';
						results[ index ] = { ok: false, error };
						failures.push( `FAILED ${ targets[ index ].path }: ${ error }` );
					}
				}
				if ( site ) {
					const ids = ( ok: boolean ) =>
						libraryTargets
							.filter( ( target ) => results[ targets.indexOf( target ) ].ok === ok )
							.map( ( target ) => attachments.get( target.resolvedPath )!.id );
					await evalWithData( host, site, FINALIZE_ATTACHMENTS, {
						ready: ids( true ),
						failed: ids( false ),
					} );
				}
				return failures.length
					? `These images failed, and any attachment reserved for them was removed. Drop them from the markup or generate them again:\n${ failures.join(
							'\n'
					  ) }`
					: undefined;
			} );

		return {
			...textResult(
				[
					`Generating ${ targets.length } image${
						targets.length === 1 ? '' : 's'
					} in the background. Use them in the markup now:`,
					...targets.map( ( target ) => {
						const attachment = attachments.get( target.resolvedPath );
						return attachment
							? `- ${ attachment.file }, attachment ID ${ attachment.id }, URL ${ attachment.url }`
							: `- ${ target.path }`;
					} ),
				].join( '\n' )
			),
			pending: generation,
			// As paths in the site, which its absolute paths contain too.
			pendingFiles: targets.map( ( target ) => {
				const file = attachments.get( target.resolvedPath )?.file ?? target.resolvedPath;
				return forSite ? path.relative( path.resolve( forSite.path ), file ) : file;
			} ),
		};
	},
	{
		annotations: REMOTE_CHANGE,
		forHost: ( options ): StudioToolDefinition | undefined =>
			options.imageGeneration ? generateImagesTool : undefined,
	}
);
