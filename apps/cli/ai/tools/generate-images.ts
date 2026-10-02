import fs from 'fs/promises';
import path from 'path';
import { Type } from 'typebox';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import {
	composeImagePrompt,
	generateImages,
	type GenerateImageResult,
	IMAGE_ASPECT_RATIOS,
	IMAGE_STYLES,
	isImageGenerationAvailable,
} from '../image-generation';
import { defineTool } from './define-tool';
import { runWpCli, textResult } from './utils';

const MAX_IMAGES_PER_CALL = 20;
const UPLOADS_DIR = path.sep + path.join( 'wp-content', 'uploads' ) + path.sep;

// Exported for tests. Generated files are jailed to the sites root like the
// pi Write tool, and must be PNGs — the only format the pipeline delivers.
export function resolveImageFilePath( filePath: string, extensions = [ '.png' ] ): string {
	const resolved = path.resolve( filePath );
	if ( resolved !== STUDIO_SITES_ROOT && ! resolved.startsWith( STUDIO_SITES_ROOT + path.sep ) ) {
		throw new Error(
			`Image path must be inside the Studio sites directory (${ STUDIO_SITES_ROOT }): ${ filePath }`
		);
	}
	if ( ! extensions.includes( path.extname( resolved ).toLowerCase() ) ) {
		throw new Error( `Image path must end in ${ extensions.join( ', ' ) }: ${ filePath }` );
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

interface Attachment {
	id: number;
	file: string;
	url: string;
}

// Runs `php` through WP-CLI with `data` decoded into `$data`.
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

// Media-library images get their attachment before they are generated, so the
// result can give their IDs and URLs right away.
const RESERVE_ATTACHMENTS = `$upload = wp_upload_dir();
$reserved = array();
foreach ( $data as $name ) {
	$filename = wp_unique_filename( $upload['path'], $name );
	$type = wp_check_filetype( $filename );
	$id = wp_insert_attachment( array( 'guid' => $upload['url'] . '/' . $filename, 'post_mime_type' => $type['type'] ? $type['type'] : 'image/png', 'post_title' => pathinfo( $filename, PATHINFO_FILENAME ), 'post_content' => '', 'post_status' => 'inherit' ), $upload['path'] . '/' . $filename );
	$reserved[] = array( 'id' => $id, 'file' => substr( $upload['path'], strlen( ABSPATH ) ) . '/' . $filename, 'url' => wp_get_attachment_url( $id ) );
}
echo wp_json_encode( $reserved );`;

const FINALIZE_ATTACHMENTS = `require_once ABSPATH . 'wp-admin/includes/image.php';
foreach ( $data['ready'] as $id ) {
	wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, get_attached_file( $id ) ) );
}
foreach ( $data['failed'] as $id ) {
	wp_delete_attachment( $id, true );
}`;

const IMAGE_SPECS = {
	images: Type.Array(
		Type.Object( {
			path: Type.String( {
				description:
					"Absolute file path to write the generated PNG to. Must be inside the Studio sites directory and end in .png. Under a site's wp-content/uploads/, the image is imported into the media library: the file moves to the uploads folder WordPress picks, and the result gives that path, its attachment ID and its URL. Anywhere else, such as a theme's assets/images, the file stays at this path.",
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

export const generateImagesTool = defineTool(
	'generate_images',
	"Generate AI images (PNG) from text specs and write them to files inside a site. An image written under the site's wp-content/uploads/ is added to its media library; any other image, such as theme imagery in a theme's assets/images, stays where it is written. " +
		'Load the `imagery` skill FIRST — it defines how to write subjects and page context, which aspect ratio fits which layout slot, and where generated images go (theme assets or the media library). ' +
		'Batch every image a page or site needs into as few calls as possible; each call accepts up to ' +
		`${ MAX_IMAGES_PER_CALL } images and generates them concurrently. ` +
		"The call returns at once with each image's path, and for the media library its attachment ID and URL, while the images are generated in the background: the tools that render the site wait for them, and any that failed is reported with a later tool result. " +
		'Failures are reported per image: a safety-filtered image should be retried once with a rewritten subject; other failures should lead you to adapt the layout rather than leave a broken image reference.',
	IMAGE_SPECS,
	async ( args ) => {
		if ( ! ( await isImageGenerationAvailable() ) ) {
			throw new Error(
				'Image generation is not available in this session. Build the site without generated imagery.'
			);
		}

		const targets = args.images.map( ( image ) => ( {
			...image,
			resolvedPath: resolveImageFilePath( image.path ),
		} ) );
		const libraryTargets = targets.filter( ( target ) =>
			target.resolvedPath.includes( UPLOADS_DIR )
		);
		const site = libraryTargets.length
			? await findSiteContaining( libraryTargets.map( ( target ) => target.resolvedPath ) )
			: undefined;
		const attachments = new Map< string, Attachment >();
		if ( site ) {
			const output = await evalWithData(
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

		const requests = targets.map( ( image ) => ( {
			prompt: composeImagePrompt( image, {
				siteContext: args.siteContext,
				imageGrade: args.imageGrade,
			} ),
			aspectRatio: image.aspectRatio,
		} ) );

		const generation = generateImages( requests )
			.catch( ( error ): GenerateImageResult[] =>
				requests.map( () => ( { ok: false, error: String( error ) } ) )
			)
			.then( async ( results ) => {
				const failures: string[] = [];
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
						await fs.writeFile( file, result.bytes );
					} )
				);
				if ( site ) {
					const ids = ( ok: boolean ) =>
						libraryTargets
							.filter( ( target ) => results[ targets.indexOf( target ) ].ok === ok )
							.map( ( target ) => attachments.get( target.resolvedPath )!.id );
					await evalWithData( site, FINALIZE_ATTACHMENTS, {
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
		};
	},
	{
		promptSnippet:
			'Generate AI images (PNG) from text specs into a site: images under its wp-content/uploads/ are added to the media library, others (theme imagery) stay files. Batch all the images a page needs into one call. Load the `imagery` skill first for spec-writing rules and file placement.',
		promptGuidelines: [
			"Whenever the design calls for imagery (hero/cover backgrounds, feature, gallery, or card images, team photos, product shots), load the `imagery` skill and generate the images with generate_images BEFORE writing the markup that references them: images shown by theme files (templates, parts, CSS) go into the active theme's assets/images and are referenced by path, and images shown by post and page content, a page's hero included, go under the site's wp-content/uploads/, which adds them to the media library; the markup uses the attachment ID and URL from the result. Never source images from web URLs and never leave a broken image reference — if an image cannot be generated, adapt the layout instead.",
		],
	}
);

// For hosts that generate images themselves (Codex's image_gen): the same
// call as generate_images, answered with the prompts for the host to render,
// so the runbooks and the site's shared image treatment stay as they are.
// The host shows the images its tool renders at the end of the turn, below
// everything else, so they must stay out of turns that end with design options.
const handoffTiming = ( hostTool: string ) =>
	`${ hostTool } images show at the end of your turn, below everything else, so never render them in a turn that ends with present_design_options: they would land under the options. This takes precedence over the \`imagery\` skill's timing. Render the look image in the turn where you ask your first question about the site, before asking it. Leave the site's image set until the layout is picked: the layout sneak peeks use the look image in their image slots, and you render the set when the build starts.`;

// Added to the site-spec skill, read right before the first question.
export const lookImageFirst = ( hostTool: string ) =>
	`## With ${ hostTool }\n\nBefore you ask your first question, make the look image (the \`imagery\` skill's "Images for design options"): generate_images, then ${ hostTool }, then import_images. Then ask. ${ hostTool } images show at the end of the turn, so this turn ends with the photo and your question, and the look options that follow end the next turn with nothing below them.`;

export function createImageHandoffTool( hostTool: string, studioFallback: boolean ) {
	return defineTool(
		'generate_images',
		`Plans AI images for a site from text specs and returns the full prompt for each, which you then render with ${ hostTool } and bring into the site with import_images. ` +
			'Load the `imagery` skill FIRST — it defines how to write subjects and page context, which aspect ratio fits which layout slot, and where images go (theme assets or the media library). ' +
			`Batch every image a page or site needs into as few calls as possible; each call accepts up to ${ MAX_IMAGES_PER_CALL } images.`,
		{
			...IMAGE_SPECS,
			...( studioFallback
				? {
						renderWithStudio: Type.Optional(
							Type.Boolean( {
								description: `True only when you have no ${ hostTool } tool: Studio then renders the images itself.`,
							} )
						),
				  }
				: {} ),
		},
		async ( args, context ) => {
			if ( ( args as { renderWithStudio?: boolean } ).renderWithStudio ) {
				return generateImagesTool.rawHandler( args, context );
			}
			const images = args.images.map( ( image ) => ( {
				...image,
				resolvedPath: resolveImageFilePath( image.path ),
				prompt: composeImagePrompt( image, {
					siteContext: args.siteContext,
					imageGrade: args.imageGrade,
				} ),
			} ) );
			return textResult(
				[
					`Render these ${ images.length } image${
						images.length === 1 ? '' : 's'
					} now with ${ hostTool }, one call per image, each prompt verbatim and at its aspect ratio. ${ hostTool } is a built-in tool you call directly, not an MCP or plugin tool, so it does not show up in those tool lists.${
						studioFallback
							? ` If you do not have it, call generate_images again with the same arguments and \`renderWithStudio: true\` instead, and Studio renders them.`
							: ''
					}`,
					'',
					...images.map(
						( image, index ) =>
							`${ index + 1 }. ${ image.resolvedPath } (${ image.aspectRatio ?? 'landscape' }): ${
								image.prompt
							}`
					),
					'',
					`Then call import_images once with every image: \`source\` is the file ${ hostTool } saved, \`path\` is the path listed above. Its result gives each image's final path, and for the media library its attachment ID and URL: write the markup that references the images after that.`,
					'',
					handoffTiming( hostTool ),
				].join( '\n' )
			);
		},
		{
			promptSnippet: `Plan AI images for a site: returns the prompt for each, which you render with ${ hostTool } and import with import_images. Batch all the images a page needs into one call. Load the \`imagery\` skill first for spec-writing rules and file placement.`,
			promptGuidelines: [
				`Whenever the design calls for imagery (hero/cover backgrounds, feature, gallery, or card images, team photos, product shots), load the \`imagery\` skill and call generate_images BEFORE writing the markup that references them, then render the returned prompts with ${ hostTool } and bring the files in with import_images. Never source images from web URLs and never leave a broken image reference — if an image cannot be generated, adapt the layout instead.`,
				handoffTiming( hostTool ),
			],
		}
	);
}

const IMPORTABLE_IMAGE_EXTENSIONS = [ '.png', '.jpg', '.jpeg', '.webp' ];

export const importImagesTool = defineTool(
	'import_images',
	"Import images you made or were given (PNG, JPEG or WebP files) into a site. An image written under the site's wp-content/uploads/ is added to its media library; any other image, such as theme imagery in a theme's assets/images, stays where it is written. " +
		'Load the `imagery` skill first for which images a design needs, their subjects, aspect ratios and where they go; create them with your own image tool (such as image_gen in Codex), giving every one the same photographic treatment so they read as one series, then import them all in one call.',
	{
		images: Type.Array(
			Type.Object( {
				source: Type.String( {
					description: 'Absolute path of the image file to import.',
				} ),
				path: Type.String( {
					description:
						"Absolute destination path inside the Studio sites directory, with the source's extension. Under a site's wp-content/uploads/, the image is imported into the media library: the file moves to the uploads folder WordPress picks, and the result gives that path, its attachment ID and its URL.",
				} ),
			} ),
			{ minItems: 1, maxItems: MAX_IMAGES_PER_CALL }
		),
	},
	async ( args ) => {
		const targets = await Promise.all(
			args.images.map( async ( image ) => {
				const resolvedPath = resolveImageFilePath( image.path, IMPORTABLE_IMAGE_EXTENSIONS );
				if (
					path.extname( image.source ).toLowerCase() !== path.extname( resolvedPath ).toLowerCase()
				) {
					throw new Error( `Destination must keep the source's extension: ${ image.path }` );
				}
				return { ...image, resolvedPath, bytes: await fs.readFile( image.source ) };
			} )
		);
		const libraryTargets = targets.filter( ( target ) =>
			target.resolvedPath.includes( UPLOADS_DIR )
		);
		const site = libraryTargets.length
			? await findSiteContaining( libraryTargets.map( ( target ) => target.resolvedPath ) )
			: undefined;
		const attachments = new Map< string, Attachment >();
		if ( site ) {
			const output = await evalWithData(
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
		await Promise.all(
			targets.map( async ( target ) => {
				const file = attachments.get( target.resolvedPath )?.file ?? target.resolvedPath;
				await fs.mkdir( path.dirname( file ), { recursive: true } );
				await fs.writeFile( file, target.bytes );
			} )
		);
		if ( site ) {
			await evalWithData( site, FINALIZE_ATTACHMENTS, {
				ready: [ ...attachments.values() ].map( ( attachment ) => attachment.id ),
				failed: [],
			} );
		}
		return textResult(
			[
				`Imported ${ targets.length } image${ targets.length === 1 ? '' : 's' }:`,
				...targets.map( ( target ) => {
					const attachment = attachments.get( target.resolvedPath );
					return attachment
						? `- ${ attachment.file }, attachment ID ${ attachment.id }, URL ${ attachment.url }`
						: `- ${ target.resolvedPath }`;
				} ),
			].join( '\n' )
		);
	},
	{
		promptSnippet:
			'Import images you created with your own image tool into a site: images under its wp-content/uploads/ are added to the media library, others (theme imagery) stay files.',
	}
);
