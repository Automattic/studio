import fs from 'fs/promises';
import path from 'path';
import { Type } from 'typebox';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import {
	composeImagePrompt,
	generateImages,
	IMAGE_ASPECT_RATIOS,
	IMAGE_STYLES,
	isImageGenerationAvailable,
} from '../image-generation';
import { defineTool } from './define-tool';
import { runWpCli } from './utils';

const MAX_IMAGES_PER_CALL = 20;
const UPLOADS_DIR = path.sep + path.join( 'wp-content', 'uploads' ) + path.sep;

// Exported for tests. Generated files are jailed to the sites root like the
// pi Write tool, and must be JPEGs — the only format the pipeline delivers.
export function resolveImageFilePath( filePath: string ): string {
	const resolved = path.resolve( filePath );
	if ( resolved !== STUDIO_SITES_ROOT && ! resolved.startsWith( STUDIO_SITES_ROOT + path.sep ) ) {
		throw new Error(
			`Image path must be inside the Studio sites directory (${ STUDIO_SITES_ROOT }): ${ filePath }`
		);
	}
	if ( ! /\.jpe?g$/i.test( resolved ) ) {
		throw new Error( `Image path must end in .jpg: ${ filePath }` );
	}
	return resolved;
}

async function findSiteContaining( filePaths: string[] ): Promise< SiteData > {
	const { sites } = await readCliConfig();
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

// WordPress keeps its own copy of an imported file under uploads/, so the
// generated file is removed and the attachment reported at WordPress's path.
async function addToMediaLibrary( site: SiteData, filePaths: string[] ) {
	await connectToDaemon();
	try {
		const ids = await Promise.all(
			filePaths.map( async ( filePath ) =>
				Number(
					await runWpCli( site, [
						'media',
						'import',
						path.relative( site.path, filePath ),
						'--porcelain',
					] )
				)
			)
		);
		const attachments: Array< { ID: number; guid: string } > = JSON.parse(
			await runWpCli( site, [
				'post',
				'list',
				'--post_type=attachment',
				`--post__in=${ ids.join( ',' ) }`,
				'--fields=ID,guid',
				'--format=json',
			] )
		);
		const placements = new Map(
			filePaths.map( ( filePath, index ) => {
				const url = attachments.find( ( attachment ) => attachment.ID === ids[ index ] )!.guid;
				const uploadedPath = path.join( site.path, decodeURIComponent( new URL( url ).pathname ) );
				return [ filePath, `${ uploadedPath }, attachment ID ${ ids[ index ] }, URL ${ url }` ];
			} )
		);
		await Promise.all( filePaths.map( ( filePath ) => fs.rm( filePath ) ) );
		return placements;
	} finally {
		await disconnectFromDaemon();
	}
}

export const generateImagesTool = defineTool(
	'generate_images',
	"Generate AI images (JPEG) from text specs and write them to files inside a site. An image written under the site's wp-content/uploads/ is added to its media library; any other image, such as theme imagery in a theme's assets/images, stays where it is written. " +
		'Load the `imagery` skill FIRST — it defines how to write subjects and page context, which aspect ratio fits which layout slot, and where generated images go (theme assets or the media library). ' +
		'Batch every image a page or site needs into as few calls as possible; each call accepts up to ' +
		`${ MAX_IMAGES_PER_CALL } images and generates them concurrently. ` +
		'Generation takes several seconds per image, so tell the user to wait. ' +
		'Failures are reported per image: a safety-filtered image should be retried once with a rewritten subject; other failures should lead you to adapt the layout rather than leave a broken image reference.',
	{
		images: Type.Array(
			Type.Object( {
				path: Type.String( {
					description:
						"Absolute file path to write the generated JPEG to. Must be inside the Studio sites directory and end in .jpg. Under a site's wp-content/uploads/, the image is imported into the media library: the file moves to the uploads folder WordPress picks, and the result gives that path, its attachment ID and its URL. Anywhere else, such as a theme's assets/images, the file stays at this path.",
				} ),
				subject: Type.String( {
					description:
						'What the image shows and from what point of view (composition, framing, vantage, mood). 1-3 sentences. Never ask for rendered text, and never restate the site-wide imageGrade here.',
				} ),
				pageContext: Type.Optional(
					Type.String( {
						description:
							'Where and how the image is used, in pictorial slot language (e.g. "full-frame editorial photograph with the left third kept as open, low-detail negative space"). Steers mood and composition; it is not drawn. Write in English.',
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
								'Canvas shape, matched to the layout slot (see the imagery skill). Defaults to landscape.',
						}
					)
				),
			} ),
			{ minItems: 1, maxItems: MAX_IMAGES_PER_CALL }
		),
		siteContext: Type.Optional(
			Type.String( {
				description:
					"One sentence of subject matter steering shared by all images (e.g. 'A neighborhood bakery selling sourdough and pastries.'). NEVER include the site or business name — a name in the prompt is what painted-in fake wordmarks stand in for.",
			} )
		),
		imageGrade: Type.Optional(
			Type.String( {
				description:
					'One site-wide photographic treatment applied to every image so they read as one series (e.g. "warm natural window light, soft muted color"). Keep it identical across calls for the same site.',
			} )
		),
	},
	async ( args, context ) => {
		if ( ! ( await isImageGenerationAvailable() ) ) {
			throw new Error(
				'Image generation is not available in this session. Build the site without generated imagery.'
			);
		}

		const targets = args.images.map( ( image ) => ( {
			...image,
			resolvedPath: resolveImageFilePath( image.path ),
		} ) );
		const libraryPaths = targets
			.map( ( target ) => target.resolvedPath )
			.filter( ( resolvedPath ) => resolvedPath.includes( UPLOADS_DIR ) );
		const site = libraryPaths.length ? await findSiteContaining( libraryPaths ) : undefined;

		context.onProgress(
			`Generating ${ targets.length } image${ targets.length === 1 ? '' : 's' }…`
		);

		const requests = targets.map( ( image ) => ( {
			prompt: composeImagePrompt( image, {
				siteContext: args.siteContext,
				imageGrade: args.imageGrade,
			} ),
			aspectRatio: image.aspectRatio,
		} ) );

		const lines: string[] = new Array( targets.length );
		let generated = 0;
		const results = await generateImages( requests, ( _index, result ) => {
			if ( result.ok ) {
				generated++;
				context.onProgress( `Generated ${ generated }/${ targets.length } images`, true );
			}
		} );

		await Promise.all(
			results.map( async ( result, index ) => {
				const target = targets[ index ];
				if ( ! result.ok || ! result.bytes ) {
					const hint = result.filtered
						? ' (safety filter — rewrite the subject to avoid the sensitive element and call generate_images again for this image)'
						: '';
					lines[ index ] = `FAILED ${ target.path }: ${ result.error }${ hint }`;
					return;
				}
				await fs.mkdir( path.dirname( target.resolvedPath ), { recursive: true } );
				await fs.writeFile( target.resolvedPath, result.bytes );
				lines[ index ] = `OK ${ target.path } (${ Math.round( result.bytes.length / 1024 ) } KB)`;
			} )
		);

		const failures = results.filter( ( result ) => ! result.ok ).length;
		if ( failures === targets.length ) {
			throw new Error(
				`All ${ targets.length } image generations failed:\n${ lines.join( '\n' ) }`
			);
		}

		const written = targets
			.filter(
				( target, index ) => results[ index ].ok && target.resolvedPath.includes( UPLOADS_DIR )
			)
			.map( ( target ) => target.resolvedPath );
		if ( site && written.length > 0 ) {
			context.onProgress( 'Adding the images to the media library…' );
			try {
				const placements = await addToMediaLibrary( site, written );
				targets.forEach( ( target, index ) => {
					const placement = placements.get( target.resolvedPath );
					if ( placement ) {
						lines[ index ] = `OK ${ placement }`;
					}
				} );
			} catch ( error ) {
				lines.push(
					`Not added to the media library: ${
						error instanceof Error ? error.message : String( error )
					}`
				);
			}
		}

		const summary =
			failures === 0
				? `Generated ${ targets.length } image${ targets.length === 1 ? '' : 's' }:`
				: `Generated ${ targets.length - failures } of ${
						targets.length
				  } images (${ failures } failed):`;
		return { content: [ { type: 'text', text: [ summary, ...lines ].join( '\n' ) } ] };
	},
	{
		promptSnippet:
			'Generate AI images (JPEG) from text specs into a site: images under its wp-content/uploads/ are added to the media library, others (theme imagery) stay files. Batch all the images a page needs into one call. Load the `imagery` skill first for spec-writing rules and file placement.',
		promptGuidelines: [
			"Whenever the design calls for imagery (hero/cover backgrounds, feature, gallery, or card images, team photos, product shots), load the `imagery` skill and generate the images with generate_images BEFORE writing the markup that references them: images used in theme files (templates, parts, CSS) go into the active theme's assets/images and are referenced by path, and images used in post and page content go under the site's wp-content/uploads/, which adds them to the media library; the markup uses the attachment ID and URL from the result. Never source images from web URLs and never leave a broken image reference — if an image cannot be generated, adapt the layout instead.",
		],
	}
);
