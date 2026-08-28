import fs from 'fs/promises';
import path from 'path';
import { Type } from 'typebox';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import {
	composeImagePrompt,
	generateImages,
	IMAGE_ASPECT_RATIOS,
	IMAGE_STYLES,
	isImageGenerationAvailable,
} from '../image-generation';
import { defineTool } from './define-tool';

const MAX_IMAGES_PER_CALL = 20;

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

export const generateImagesTool = defineTool(
	'generate_images',
	'Generate AI images (JPEG) from text specs and write them to files inside a site. ' +
		'Load the `imagery` skill FIRST — it defines how to write subjects and page context, which aspect ratio fits which layout slot, and where generated files go (theme assets vs. media library import). ' +
		'Batch every image a page or site needs into as few calls as possible; each call accepts up to ' +
		`${ MAX_IMAGES_PER_CALL } images and generates them concurrently. ` +
		'Generation takes several seconds per image, so tell the user to wait. ' +
		'Failures are reported per image: a safety-filtered image should be retried once with a rewritten subject; other failures should lead you to adapt the layout rather than leave a broken image reference.',
	{
		images: Type.Array(
			Type.Object( {
				path: Type.String( {
					description:
						'Absolute file path to write the generated JPEG to. Must be inside the Studio sites directory and end in .jpg.',
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

		const summary =
			failures === 0
				? `Generated ${ targets.length } image${ targets.length === 1 ? '' : 's' }:`
				: `Generated ${ targets.length - failures } of ${
						targets.length
				  } images (${ failures } failed):`;
		return { content: [ { type: 'text', text: [ summary, ...lines ].join( '\n' ) } ] };
	}
);
