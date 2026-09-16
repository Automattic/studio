import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Type } from 'typebox';
import { renderDesignBoard } from 'cli/ai/design-board';
import { DESIGN_OPTIONS } from 'cli/ai/design-catalog';
import { recordDesignTracksEvent, type DesignTracksContext } from 'cli/ai/design-tracks';
import { resolveScreenshotDirectory } from 'cli/ai/screenshot-storage';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { TRACKS_EVENTS } from 'cli/lib/tracks';
import { defineTool } from './define-tool';
import { forgetBackgroundImages, settleBackgroundImages } from './generate-images';
import { captureScreenshotBuffer, saveScreenshotFile } from './screenshot-helpers';
import { textResult } from './utils';
import type { AskUserQuestion } from 'cli/ai/types';

const PREVIEW_VIEWPORT = { width: 1200, height: 900 } as const;

const OTHER_OPTIONS = 'Show other options';

const FRAME_FILL_RECIPE =
	'make `body` a `min-height: 100vh` flex column and give the last section `flex: 1` and a background, so the page reaches the bottom edge whatever its copy length';

const INLINE_IMAGE_MIME_TYPES: Record< string, string > = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp',
};

const LOCAL_IMAGE_REFERENCE =
	/(src=|url\()(["']?)((?:file:\/\/|\/)[^"')\s]+\.(?:jpe?g|png|webp))\2/gi;

// Stands in for an image that failed to generate: the slot shows the solid
// color behind it instead of a broken image.
const TRANSPARENT_PIXEL =
	'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

function localImagePath( reference: string ): string {
	try {
		return path.resolve(
			reference.startsWith( 'file://' ) ? fileURLToPath( reference ) : reference
		);
	} catch {
		return reference;
	}
}

function localImageReferences( html: string ): string[] {
	return [ ...html.matchAll( LOCAL_IMAGE_REFERENCE ) ].map( ( match ) => match[ 3 ] );
}

// The preview page is a `file://` document, so referenced images are inlined
// rather than relying on file-to-file loads; only the sites root qualifies.
export async function inlineLocalImages(
	html: string,
	failed: ReadonlySet< string > = new Set()
): Promise< string > {
	const dataUrls = new Map< string, string >();
	for ( const reference of localImageReferences( html ) ) {
		if ( dataUrls.has( reference ) ) {
			continue;
		}
		const filePath = localImagePath( reference );
		if ( ! filePath.startsWith( STUDIO_SITES_ROOT + path.sep ) ) {
			throw new Error(
				`Preview image must be inside the Studio sites directory (${ STUDIO_SITES_ROOT }): ${ reference }`
			);
		}
		if ( failed.has( filePath ) ) {
			dataUrls.set( reference, TRANSPARENT_PIXEL );
			continue;
		}
		let bytes: Buffer;
		try {
			bytes = await readFile( filePath );
		} catch {
			throw new Error(
				`Preview image not found: ${ reference }. Generate it first, or use a solid color shape instead.`
			);
		}
		const mimeType = INLINE_IMAGE_MIME_TYPES[ path.extname( filePath ).toLowerCase() ];
		dataUrls.set( reference, `data:${ mimeType };base64,${ bytes.toString( 'base64' ) }` );
	}
	return html.replace(
		LOCAL_IMAGE_REFERENCE,
		( _match, prefix: string, quote: string, reference: string ) =>
			`${ prefix }${ quote }${ dataUrls.get( reference ) }${ quote }`
	);
}

type Option = { label: string; description: string; image: string };

type AnswerType = 'picked' | 'other_options' | 'free_form' | 'none';

function classifyAnswer( answer: string | undefined, picked: number ): AnswerType {
	if ( ! answer ) return 'none';
	if ( picked !== -1 ) return 'picked';
	if ( answer === OTHER_OPTIONS ) return 'other_options';
	return 'free_form';
}

// Rendering and asking live in one tool so the model cannot attach preview
// images to unrelated questions.
export function createPresentDesignOptionsTool(
	onAskUser: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >,
	tracks?: DesignTracksContext
) {
	return defineTool(
		'present_design_options',
		`Shows the user the options drawn by pick_design as rendered previews and waits for their pick. Pass one option per drawn entry (2–4), in the order pick_design returned them, each with a \`preview\`: for a look, the option's DESIGN.md draft, rendered as a design board with its generated \`image\` if it has one; for a layout, a complete standalone HTML sneak peek — inline CSS, no scripts, optionally a Google Fonts link with a fallback stack; images referenced by absolute path under the site are inlined, waiting for any still generating in the background, otherwise use solid color shapes, never web URLs. Each is rendered in a ${ PREVIEW_VIEWPORT.width }×${ PREVIEW_VIEWPORT.height } frame that a sneak peek must fill to the bottom: ${ FRAME_FILL_RECIPE }. A sneak peek whose content ends above the bottom of the frame is rejected. The user can also type their own answer, or pick "${ OTHER_OPTIONS }", added for you after the previews: then draw that step again. Use this only for the site design choices; ask everything else with AskUserQuestion.`,
		{
			catalog: Type.Union( [ Type.Literal( 'directions' ), Type.Literal( 'layouts' ) ], {
				description:
					'The pick_design catalog the options came from: "directions" for a look, "layouts" for a layout.',
			} ),
			question: Type.String( {
				description: 'The question shown above the options, e.g. "Which look should I build?".',
			} ),
			options: Type.Array(
				Type.Object( {
					label: Type.String( {
						description: 'Short option label: the entry name, e.g. "Noir" or "Broadsheet".',
					} ),
					description: Type.String( {
						description: 'One sentence on the feel of this option.',
					} ),
					preview: Type.String( {
						description:
							'A DESIGN.md draft (front matter and Overview) for a look, or a complete HTML sneak peek for a layout.',
					} ),
					image: Type.Optional(
						Type.String( {
							description: 'For a look: absolute path of the look image.',
						} )
					),
				} ),
				{
					minItems: 2,
					maxItems: DESIGN_OPTIONS,
					description: 'One option per drawn entry, in the order pick_design returned them.',
				}
			),
		},
		async ( args, context ) => {
			if ( args.options.length < 2 || args.options.length > DESIGN_OPTIONS ) {
				throw new Error( `Present between 2 and ${ DESIGN_OPTIONS } options.` );
			}
			const referencedImages = args.options
				.flatMap( ( option ) => [
					...( option.image ? [ option.image ] : [] ),
					...localImageReferences( option.preview ),
				] )
				.map( localImagePath );
			const images = await settleBackgroundImages( referencedImages, () =>
				context.onProgress( 'Waiting for the images to generate…' )
			);
			context.onProgress( `Rendering ${ args.options.length } previews…` );
			const directory = await resolveScreenshotDirectory();
			// Every option renders before a rejection is reported, so the
			// agent fixes all the rejected ones in one retry.
			const rendered = await Promise.allSettled(
				args.options.map( async ( option, index ) => {
					const slug =
						option.label
							.toLowerCase()
							.replace( /[^a-z0-9]+/g, '-' )
							.replace( /^-+|-+$/g, '' )
							.slice( 0, 40 ) || `option-${ index + 1 }`;
					const htmlPath = path.join( directory, `preview-${ index + 1 }-${ slug }.html` );
					let capture;
					try {
						const isDesignBoard = option.preview.trimStart().startsWith( '---' );
						const image =
							option.image && ! images.failed.has( localImagePath( option.image ) )
								? option.image
								: undefined;
						const html = isDesignBoard
							? renderDesignBoard( option.preview, image )
							: option.preview;
						await writeFile( htmlPath, await inlineLocalImages( html, images.failed ) );
						capture = await captureScreenshotBuffer(
							pathToFileURL( htmlPath ).href,
							PREVIEW_VIEWPORT,
							{ fullPage: false, format: 'png' }
						);
						await unlink( htmlPath );
						if ( ! isDesignBoard && capture.contentHeight < PREVIEW_VIEWPORT.height ) {
							throw new Error(
								`the sneak peek's content ends at ${ capture.contentHeight }px of the ${ PREVIEW_VIEWPORT.height }px frame, leaving the bottom empty. Fix it and present the options again: ${ FRAME_FILL_RECIPE }, or add the next section.`
							);
						}
					} catch ( error ) {
						throw new Error(
							`Option ${ index + 1 } ("${ option.label }"): ${
								error instanceof Error ? error.message : String( error )
							}`
						);
					}
					const file = await saveScreenshotFile( capture.buffer, {
						viewportType: `preview-${ index + 1 }`,
						format: 'png',
					} );
					return { label: option.label, description: option.description, image: file.path };
				} )
			);
			const rejected = rendered.filter( ( result ) => result.status === 'rejected' );
			if ( rejected.length ) {
				throw new Error(
					rejected
						.map( ( result ) => String( result.reason?.message ?? result.reason ) )
						.join( '\n' )
				);
			}
			const options = rendered.map(
				( result ) => ( result as PromiseFulfilledResult< Option > ).value
			);
			forgetBackgroundImages( referencedImages );
			const answers = await onAskUser( [
				{
					question: args.question,
					options: [
						...options,
						{ label: OTHER_OPTIONS, description: 'New ones, none of these again.' },
					],
					allowFreeForm: true,
				},
			] );
			const answer = answers[ args.question ];
			const picked = answer ? options.findIndex( ( option ) => option.label === answer ) : -1;
			await recordDesignTracksEvent( TRACKS_EVENTS.CODE_DESIGN_OPTION_PICKED, tracks, {
				catalog: args.catalog,
				options_count: options.length,
				answer_type: classifyAnswer( answer, picked ),
				picked: picked === -1 ? undefined : options[ picked ].label,
				pick_index: picked === -1 ? undefined : picked + 1,
			} );
			const report = images.lines.length
				? `\n\nImages generated in the background:\n${ images.lines.join( '\n' ) }${
						images.failed.size
							? '\nA failed image was shown as a solid color shape; generate it again or adapt the layout before the build.'
							: ''
				  }`
				: '';
			if ( ! answer ) {
				return textResult( `The user did not answer.${ report }` );
			}
			return textResult(
				( picked === -1
					? `The user answered: ${ answer }`
					: `The user picked option ${ picked + 1 }: ${ answer }` ) + report
			);
		}
	);
}
