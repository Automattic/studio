import fs from 'fs/promises';
import path from 'path';
import { Type, type Static } from 'typebox';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import {
	composeImagePrompt,
	generateImages,
	IMAGE_ASPECT_RATIOS,
	IMAGE_STYLES,
	isImageGenerationAvailable,
	type GenerateImageResult,
} from '../image-generation';
import { defineTool, type ToolContext, type ToolHandler } from './define-tool';
import { textResult } from './utils';

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

interface ImageReport {
	// One `OK`/`FAILED` line per image, in call order.
	lines: string[];
	// Resolved paths of the images that were not generated.
	failed: Set< string >;
}

interface BackgroundImageJob {
	paths: Set< string >;
	report: Promise< ImageReport >;
}

// Jobs started with `background: true`, kept until a preview has reported
// them, so one that references their files waits for them instead of finding
// them missing, and a rejected preview does not lose the report.
const backgroundJobs = new Set< BackgroundImageJob >();
// Files whose background generation failed: previews keep showing their slot
// as a solid shape, with no error, until the file exists.
const failedImages = new Set< string >();

const exists = ( filePath: string ) =>
	fs.access( filePath ).then(
		() => true,
		() => false
	);

const resolvedPaths = ( filePaths: string[] ) =>
	new Set( filePaths.map( ( filePath ) => path.resolve( filePath ) ) );

function backgroundJobsFor( wanted: Set< string > ): BackgroundImageJob[] {
	return [ ...backgroundJobs ].filter( ( job ) =>
		[ ...job.paths ].some( ( jobPath ) => wanted.has( jobPath ) )
	);
}

/**
 * Waits for the background jobs generating any of `filePaths` and returns
 * their reports; `onWait` fires when there is something to wait for. Files no
 * job covers return at once. `failed` holds the referenced images whose
 * background generation failed and that still do not exist, whether or not
 * their job was reported.
 */
export async function settleBackgroundImages(
	filePaths: string[],
	onWait?: () => void
): Promise< ImageReport > {
	const wanted = resolvedPaths( filePaths );
	const jobs = backgroundJobsFor( wanted );
	if ( jobs.length ) {
		onWait?.();
	}
	const reports = await Promise.all( jobs.map( ( job ) => job.report ) );
	for ( const filePath of reports.flatMap( ( report ) => [ ...report.failed ] ) ) {
		failedImages.add( filePath );
	}
	const failed = new Set< string >();
	for ( const filePath of failedImages ) {
		if ( await exists( filePath ) ) {
			failedImages.delete( filePath );
		} else if ( wanted.has( filePath ) ) {
			failed.add( filePath );
		}
	}
	return { lines: reports.flatMap( ( report ) => report.lines ), failed };
}

// Drops the jobs covering `filePaths` once their report has been delivered.
export function forgetBackgroundImages( filePaths: string[] ): void {
	for ( const job of backgroundJobsFor( resolvedPaths( filePaths ) ) ) {
		backgroundJobs.delete( job );
	}
}

const PROPERTIES = {
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
				Type.Enum( Object.fromEntries( IMAGE_ASPECT_RATIOS.map( ( ratio ) => [ ratio, ratio ] ) ), {
					description:
						'Canvas shape, matched to the layout slot (see the imagery skill). Defaults to landscape.',
				} )
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
};

const BACKGROUND_PROPERTIES = {
	...PROPERTIES,
	background: Type.Optional(
		Type.Boolean( {
			description:
				'Return at once and write the files as they are generated, for the images the design previews need next: present_design_options waits for the ones its previews reference and reports every image of the batch. Leave unset for images the build references right away.',
		} )
	),
};

const DESCRIPTION =
	'Generate AI images (JPEG) from text specs and write them to files inside a site. ' +
	'Load the `imagery` skill FIRST — it defines how to write subjects and page context, which aspect ratio fits which layout slot, and where generated files go (theme assets vs. media library import). ' +
	'Batch every image a page or site needs into as few calls as possible; each call accepts up to ' +
	`${ MAX_IMAGES_PER_CALL } images and generates them concurrently. ` +
	'Generation takes several seconds per image, so tell the user to wait. ' +
	'Failures are reported per image: a safety-filtered image should be retried once with a rewritten subject; other failures should lead you to adapt the layout rather than leave a broken image reference.';

const BACKGROUND_DESCRIPTION =
	' Pass `background: true` for the images of the design steps, so they generate while you write the previews.';

const PROMPT = {
	promptSnippet:
		'Generate AI images (JPEG) from text specs and write them to files inside a site. Batch all the images a page needs into one call. Load the `imagery` skill first for spec-writing rules and file placement.',
};

type ImageTarget = Static< typeof PROPERTIES.images.items > & { resolvedPath: string };

async function generateImageFiles(
	targets: ImageTarget[],
	args: { siteContext?: string; imageGrade?: string },
	onProgress: ToolContext[ 'onProgress' ]
): Promise< ImageReport > {
	const requests = targets.map( ( image ) => ( {
		prompt: composeImagePrompt( image, {
			siteContext: args.siteContext,
			imageGrade: args.imageGrade,
		} ),
		aspectRatio: image.aspectRatio,
	} ) );
	let generated = 0;
	const results = await generateImages( requests, ( _index, result ) => {
		if ( result.ok ) {
			generated++;
			onProgress( `Generated ${ generated }/${ targets.length } images`, true );
		}
	} ).catch( ( error ): GenerateImageResult[] => {
		const message = error instanceof Error ? error.message : String( error );
		return targets.map( () => ( { ok: false, error: message } ) );
	} );

	const lines: string[] = new Array( targets.length );
	const failed = new Set< string >();
	await Promise.all(
		results.map( async ( result, index ) => {
			const target = targets[ index ];
			if ( ! result.ok || ! result.bytes ) {
				failed.add( target.resolvedPath );
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
	return { lines, failed };
}

// `background` is only offered where present_design_options exists to wait
// for the files: a Studio UI attached and a user to ask.
export function createGenerateImagesTool( { background }: { background: boolean } ) {
	const handler: ToolHandler< typeof BACKGROUND_PROPERTIES > = async ( args, context ) => {
		if ( ! ( await isImageGenerationAvailable() ) ) {
			throw new Error(
				'Image generation is not available in this session. Build the site without generated imagery.'
			);
		}

		const targets = args.images.map( ( image ) => ( {
			...image,
			resolvedPath: resolveImageFilePath( image.path ),
		} ) );
		const count = `${ targets.length } image${ targets.length === 1 ? '' : 's' }`;

		if ( background && args.background ) {
			backgroundJobs.add( {
				paths: new Set( targets.map( ( target ) => target.resolvedPath ) ),
				report: generateImageFiles( targets, args, () => {} ),
			} );
			const paths = targets.map( ( target ) => target.path ).join( '\n' );
			return textResult(
				`Generating ${ count } in the background; each file is written when it is ready:\n${ paths }\n\npresent_design_options waits for the ones its previews reference and reports every image of this batch.`
			);
		}

		context.onProgress( `Generating ${ count }…` );
		const { lines, failed } = await generateImageFiles( targets, args, context.onProgress );
		if ( failed.size === targets.length ) {
			throw new Error(
				`All ${ targets.length } image generations failed:\n${ lines.join( '\n' ) }`
			);
		}
		const summary =
			failed.size === 0
				? `Generated ${ count }:`
				: `Generated ${ targets.length - failed.size } of ${ targets.length } images (${
						failed.size
				  } failed):`;
		return textResult( [ summary, ...lines ].join( '\n' ) );
	};

	return background
		? defineTool(
				'generate_images',
				DESCRIPTION + BACKGROUND_DESCRIPTION,
				BACKGROUND_PROPERTIES,
				handler,
				PROMPT
		  )
		: defineTool( 'generate_images', DESCRIPTION, PROPERTIES, handler, PROMPT );
}

export const generateImagesTool = createGenerateImagesTool( { background: false } );
