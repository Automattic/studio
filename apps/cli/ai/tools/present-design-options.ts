import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Type } from 'typebox';
import { renderDesignBoard } from 'cli/ai/design-board';
import { DESIGN_OPTIONS } from 'cli/ai/design-catalog';
import { recordDesignTracksEvent, type DesignTracksContext } from 'cli/ai/design-tracks';
import { resolveScreenshotDirectory } from 'cli/ai/screenshot-storage';
import { TRACKS_EVENTS } from 'cli/lib/tracks';
import { defineTool, type ToolResult, READ_ONLY } from './define-tool';
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

// The preview page is a `file://` document, so referenced images are inlined
// rather than relying on file-to-file loads. They can live anywhere, such as
// where an agent's own image tool saved them.
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

type AnswerType = 'picked' | 'other_options' | 'free_form' | 'none';

function classifyAnswer( answer: string | undefined, picked: number ): AnswerType {
	if ( ! answer ) return 'none';
	if ( picked !== -1 ) return 'picked';
	if ( answer === OTHER_OPTIONS ) return 'other_options';
	return 'free_form';
}

const GRID_WIDTH = 1600;

function escapeHtml( text: string ): string {
	return text.replace( /[&<>"]/g, ( char ) => `&#${ char.charCodeAt( 0 ) };` );
}

// Without a way to ask, the previews go back to the agent: for a picker the host
// shows, or as one numbered grid image for it to show and ask about.
async function handOverOptions(
	question: string,
	options: { label: string; description: string; image: string; buffer: Buffer }[],
	imageLink: ( file: string ) => string,
	picker: boolean
): Promise< ToolResult > {
	const figures = options
		.map(
			( option, index ) =>
				`<figure><img src="${ pathToFileURL( option.image ).href }" alt=""><figcaption><b>${
					index + 1
				}</b><span><strong>${ escapeHtml( option.label ) }</strong> ${ escapeHtml(
					option.description
				) }</span></figcaption></figure>`
		)
		.join( '' );
	const gridPage = path.join(
		await resolveScreenshotDirectory(),
		`design-options-${ Date.now() }.html`
	);
	await writeFile(
		gridPage,
		`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;width:${ GRID_WIDTH }px;box-sizing:border-box;font:18px/1.4 system-ui,sans-serif;background:#f0f0f0;color:#1e1e1e}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}figure{margin:0;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.15)}img{display:block;width:100%;height:auto}figcaption{display:flex;gap:14px;align-items:center;padding:14px 18px}b{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:#1e1e1e;color:#fff;font-size:20px}</style></head><body><main>${ figures }</main></body></html>`
	);
	const grid = await captureScreenshotBuffer(
		pathToFileURL( gridPage ).href,
		{ width: GRID_WIDTH, height: 600 },
		{ fullPage: true, format: 'jpeg' }
	);
	await unlink( gridPage );
	const gridFile = await saveScreenshotFile( grid.buffer, {
		viewportType: 'design-options',
		format: 'jpeg',
	} );
	const nextStep = `Continue with what they pick. If they pick "${ OTHER_OPTIONS }", draw that step again with pick_design; if they describe their own, follow it.`;
	const gridImage = {
		type: 'image' as const,
		data: grid.buffer.toString( 'base64' ),
		mimeType: 'image/jpeg',
	};
	if ( picker ) {
		return {
			content: [
				gridImage,
				{
					type: 'text',
					text: `The ${ options.length } options (the grid above) are shown to the user under this tool call as a clickable picker with their previews. Do not show or list them again, and ask nothing else: end your turn now. The user's pick arrives as their next message.\n\n${ nextStep }`,
				},
			],
			_meta: {
				question,
				options: options.map( ( { label, description, buffer } ) => ( {
					label,
					description,
					image: `data:image/jpeg;base64,${ buffer.toString( 'base64' ) }`,
				} ) ),
			},
		};
	}
	return {
		content: [
			gridImage,
			{
				type: 'text',
				text: [
					`Rendered the ${ options.length } options as one numbered grid image (above). The user does not see tool results, only your reply, so in this same turn:`,
					`1. Show the grid: start your reply with ![${ question }](${ imageLink(
						gridFile.path
					) })`,
					`2. Ask "${ question }" with one option per line below, label and description verbatim. Use your own question tool if you have one, such as AskUserQuestion (if it takes fewer options, leave out "${ OTHER_OPTIONS }": the user can still ask in their own words). Otherwise ask in your reply and end your turn: the user's pick arrives as their next message.`,
					...options.map(
						( option, index ) => `   ${ index + 1 }. ${ option.label }: ${ option.description }`
					),
					`   - ${ OTHER_OPTIONS }: new ones, none of these again.`,
					'',
					nextStep,
				].join( '\n' ),
			},
		],
	};
}

// Rendering and asking live in one tool so the model cannot attach preview
// images to unrelated questions.
export function createPresentDesignOptionsTool( {
	onAskUser,
	tracks,
	imageLink = ( file ) => file,
	picker = false,
}: {
	// Asks the user in Studio's own UI and waits for the pick. Without it, the
	// options go back to the agent to show.
	onAskUser?: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >;
	tracks?: DesignTracksContext;
	// How a local image is linked in the agent's reply so the host shows it to the user.
	imageLink?: ( file: string ) => string;
	// The host shows the options under the tool call as a clickable picker (an MCP App).
	picker?: boolean;
} = {} ) {
	// Previews sent to a picker travel in the conversation, so keep them light.
	const previewFormat = picker ? 'jpeg' : 'png';
	return defineTool(
		'present_design_options',
		`Shows the user the options drawn by pick_design as rendered previews and ${
			onAskUser
				? 'waits for their pick'
				: picker
				? 'shows them to the user under this call as a clickable picker'
				: 'returns them as one numbered grid image for you to show and ask about, since the user does not see tool results'
		}. Pass one option per drawn entry (2–4), in the order pick_design returned them, each with a \`preview\`: for a look, the option's DESIGN.md draft, rendered as a design board with its generated \`image\` if it has one; for a layout, a complete standalone HTML sneak peek — inline CSS, no scripts, optionally a Google Fonts link with a fallback stack; images referenced by absolute path under the site are inlined, otherwise use solid color shapes, never web URLs. Each is rendered in a ${
			PREVIEW_VIEWPORT.width
		}×${
			PREVIEW_VIEWPORT.height
		} frame that a sneak peek must fill to the bottom: ${ FRAME_FILL_RECIPE }. A sneak peek whose content ends above the bottom of the frame is rejected. The user can also type their own answer, or pick "${ OTHER_OPTIONS }", added for you after the previews: then draw that step again. Use this only for the site design choices; ask everything else ${
			onAskUser ? 'with AskUserQuestion' : 'in your reply'
		}.`,
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
			context.onProgress( `Rendering ${ args.options.length } previews…` );
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
					let capture;
					try {
						const isDesignBoard = option.preview.trimStart().startsWith( '---' );
						const html = isDesignBoard
							? renderDesignBoard( option.preview, option.image )
							: option.preview;
						// The BOM makes the browser read the file as UTF-8 even when the
						// sneak peek does not declare a charset.
						await writeFile( htmlPath, `\ufeff${ await inlineLocalImages( html ) }` );
						capture = await captureScreenshotBuffer(
							pathToFileURL( htmlPath ).href,
							PREVIEW_VIEWPORT,
							{
								fullPage: false,
								format: previewFormat,
								deviceScaleFactor: picker ? 0.5 : undefined,
							}
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
						format: previewFormat,
					} );
					return {
						label: option.label,
						description: option.description,
						image: file.path,
						buffer: capture.buffer,
					};
				} )
			);
			if ( ! onAskUser ) {
				return handOverOptions( args.question, options, imageLink, picker );
			}
			const answers = await onAskUser( [
				{
					question: args.question,
					options: [
						...options.map( ( { label, description, image } ) => ( {
							label,
							description,
							image,
						} ) ),
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
			if ( ! answer ) {
				return textResult( 'The user did not answer.' );
			}
			return textResult(
				picked === -1
					? `The user answered: ${ answer }`
					: `The user picked option ${ picked + 1 }: ${ answer }`
			);
		},
		{ settlesPendingWork: true, annotations: READ_ONLY }
	);
}
