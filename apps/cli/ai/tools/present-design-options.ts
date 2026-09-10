import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Type } from 'typebox';
import { resolveScreenshotDirectory } from 'cli/ai/screenshot-storage';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { defineTool } from './define-tool';
import { captureScreenshotBuffer, saveScreenshotFile } from './screenshot-helpers';
import { textResult } from './utils';
import type { AskUserQuestion } from 'cli/ai/types';

export const MAX_DESIGN_OPTIONS_PRESENTED = 4;

/**
 * Landscape "one screen" viewport for sneak peeks: wide enough for a desktop
 * layout, short enough to read as a card in the question grid.
 */
export const PREVIEW_VIEWPORT = { width: 1200, height: 900 } as const;

const INLINE_IMAGE_MIME_TYPES: Record< string, string > = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp',
};

// `src="/abs/path.jpg"`, `src='file:///…'`, `url(/abs/path.jpg)`, `url("…")`.
const LOCAL_IMAGE_REFERENCE =
	/(src=|url\()(["']?)((?:file:\/\/|\/)[^"')\s]+\.(?:jpe?g|png|webp))\2/gi;

/**
 * Sneak peeks reference generated images by absolute path; the preview page
 * is rendered from a `file://` temp document, so the images are inlined as
 * data URLs rather than relying on file-to-file loads. Only files inside the
 * sites root qualify, matching where generate_images may write.
 * Exported for tests.
 */
export async function inlineLocalImages( html: string ): Promise< string > {
	const references = [ ...html.matchAll( LOCAL_IMAGE_REFERENCE ) ];
	const dataUrls = new Map< string, string >();
	for ( const [ , , , reference ] of references ) {
		if ( dataUrls.has( reference ) ) {
			continue;
		}
		const filePath = path.resolve(
			reference.startsWith( 'file://' ) ? fileURLToPath( reference ) : reference
		);
		if ( ! filePath.startsWith( STUDIO_SITES_ROOT + path.sep ) ) {
			throw new Error(
				`Preview image must be inside the Studio sites directory (${ STUDIO_SITES_ROOT }): ${ reference }`
			);
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

/**
 * The one place rendered previews reach the user: the Studio UI draws this
 * question as a grid of image cards. Rendering and asking live in a single
 * tool so the model cannot attach preview images to unrelated questions.
 * Factory because it closes over `onAskUser`, like `AskUserQuestion`.
 */
export function createPresentDesignOptionsTool(
	onAskUser: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >
) {
	return defineTool(
		'present_design_options',
		'Shows the user the design options drawn by pick_design as rendered sneak peeks and waits for their pick. Pass one option per pair (2–4), each with a complete standalone HTML document: inline CSS, no scripts, optionally a Google Fonts link with a fallback stack; images referenced by absolute path under the site are inlined, otherwise use solid color shapes — never web URLs. The first 1200×900 CSS pixels of each are rendered. The user can also type their own answer. Use this only for the site design choice; ask everything else with AskUserQuestion.',
		{
			question: Type.String( {
				description: 'The question shown above the options, e.g. "Which look should I build?".',
			} ),
			options: Type.Array(
				Type.Object( {
					label: Type.String( {
						description: 'Short option label, e.g. "Broadsheet × Noir" (concept × direction).',
					} ),
					description: Type.String( {
						description: 'One sentence on the feel of this option.',
					} ),
					html: Type.String( { description: 'Complete HTML document for the sneak peek.' } ),
				} ),
				{
					minItems: 2,
					maxItems: MAX_DESIGN_OPTIONS_PRESENTED,
					description: 'One sneak peek per drawn pair, in the order pick_design returned them.',
				}
			),
		},
		async ( args, context ) => {
			if ( args.options.length < 2 || args.options.length > MAX_DESIGN_OPTIONS_PRESENTED ) {
				throw new Error( `Present between 2 and ${ MAX_DESIGN_OPTIONS_PRESENTED } options.` );
			}
			context.onProgress( `Rendering ${ args.options.length } sneak peeks…` );
			const directory = await resolveScreenshotDirectory();
			const options = await Promise.all(
				args.options.map( async ( option, index ) => {
					const slug =
						option.label
							.toLowerCase()
							.replace( /[^a-z0-9]+/g, '-' )
							.replace( /^-+|-+$/g, '' )
							.slice( 0, 40 ) || `option-${ index + 1 }`;
					const htmlPath = path.join( directory, `preview-${ index + 1 }-${ slug }.html` );
					let html: string;
					try {
						html = await inlineLocalImages( option.html );
					} catch ( error ) {
						throw new Error(
							`Option ${ index + 1 } ("${ option.label }"): ${
								error instanceof Error ? error.message : String( error )
							}`
						);
					}
					await writeFile( htmlPath, html );
					let capture;
					try {
						capture = await captureScreenshotBuffer(
							pathToFileURL( htmlPath ).href,
							PREVIEW_VIEWPORT,
							{ fullPage: false, format: 'png' }
						);
					} catch ( error ) {
						throw new Error(
							`Option ${ index + 1 } ("${ option.label }") failed to render: ${
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
			const answers = await onAskUser( [
				{ question: args.question, options, allowFreeForm: true },
			] );
			const answer = answers[ args.question ];
			if ( ! answer ) {
				return textResult( 'The user did not answer.' );
			}
			const picked = options.findIndex( ( option ) => option.label === answer );
			return textResult(
				picked === -1
					? `The user answered: ${ answer }`
					: `The user picked option ${ picked + 1 }: ${ answer }`
			);
		}
	);
}
