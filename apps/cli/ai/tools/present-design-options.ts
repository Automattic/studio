import { copyFile, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Type } from 'typebox';
import { renderDesignBoard } from 'cli/ai/design-board';
import { DESIGN_OPTIONS } from 'cli/ai/design-catalog';
import { recordDesignTracksEvent, type DesignTracksContext } from 'cli/ai/design-tracks';
import { resolveScreenshotDirectory } from 'cli/ai/screenshot-storage';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { TRACKS_EVENTS } from 'cli/lib/tracks';
import { defineTool, type ToolResult } from './define-tool';
import { captureScreenshotBuffer, saveScreenshotFile } from './screenshot-helpers';
import { textResult } from './utils';
import type { HostCapabilities } from './host-capabilities';
import type { AskUserHandler } from 'cli/ai/types';

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
// rather than relying on file-to-file loads; only the sites root qualifies.
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

type AnswerType = 'picked' | 'other_options' | 'free_form' | 'none';

function classifyAnswer( answer: string | undefined, picked: number ): AnswerType {
	if ( ! answer ) return 'none';
	if ( picked !== -1 ) return 'picked';
	if ( answer === OTHER_OPTIONS ) return 'other_options';
	return 'free_form';
}

// Rendering and asking live in one tool so the model cannot attach preview
// images to unrelated questions.
const GRID_WIDTH = 1600;

// The previews as one numbered grid, captured as a single image for hosts that
// show images in their conversation.
function renderOptionsGrid(
	options: { label: string; description: string; image: string }[]
): string {
	const escape = ( text: string ) =>
		text.replace( /[&<>"]/g, ( char ) => `&#${ char.charCodeAt( 0 ) };` );
	const figures = options
		.map(
			( option, index ) =>
				`<figure><img src="${ pathToFileURL( option.image ).href }" alt=""><figcaption><b>${
					index + 1
				}</b><span><strong>${ escape( option.label ) }</strong> ${ escape(
					option.description
				) }</span></figcaption></figure>`
		)
		.join( '' );
	return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;width:${ GRID_WIDTH }px;box-sizing:border-box;font:18px/1.4 system-ui,sans-serif;background:#f0f0f0;color:#1e1e1e}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}figure{margin:0;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.15)}img{display:block;width:100%;height:auto}figcaption{display:flex;gap:14px;align-items:center;padding:14px 18px}b{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:#1e1e1e;color:#fff;font-size:20px}</style></head><body><main>${ figures }</main></body></html>`;
}

// The previews as a clickable card grid for hosts with an inline HTML widget
// tool: each card embeds its preview's HTML, and a click sends the pick as the
// user's message. Such widgets cannot load local files, so images give way to
// a neutral placeholder.
function renderOptionsWidget(
	question: string,
	options: { label: string; description: string; markup: string }[]
): string {
	const escape = ( text: string ) =>
		text.replace( /[&<>"]/g, ( char ) => `&#${ char.charCodeAt( 0 ) };` );
	const cards = options
		.map(
			( option, index ) =>
				`<button class="c" data-pick="${ escape(
					`I pick option ${ index + 1 }: ${ option.label }`
				) }"><div class="f"><iframe tabindex="-1"></iframe></div><span><b>${
					index + 1
				}</b><span><strong>${ escape( option.label ) }</strong> ${ escape(
					option.description
				) }</span></span></button><script type="text/html">${ option.markup
					.replace( LOCAL_IMAGE_REFERENCE, '$1$2data:image/gif;base64,R0lGODlhAQABAAAAACw=$2' )
					.replace( /<\/script/gi, '<\\/script' ) }</script>`
		)
		.join( '' );
	return `<h2 class="sr-only">${ escape(
		question
	) }</h2><style>.g{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:4px}.c{all:unset;box-sizing:border-box;cursor:pointer;display:block;border:.5px solid var(--border-subtle,#ddd);border-radius:10px;overflow:hidden;background:var(--surface-2,#fff)}.c:hover,.c:focus-visible{outline:2px solid var(--text-accent,#3858e9);outline-offset:-2px}.f{position:relative;aspect-ratio:4/3;overflow:hidden}.f iframe{position:absolute;top:0;left:0;width:${
		PREVIEW_VIEWPORT.width
	}px;height:${
		PREVIEW_VIEWPORT.height
	}px;border:0;transform-origin:0 0;pointer-events:none}.c>span{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;font-size:13px;line-height:1.4;color:var(--text-secondary,#555)}.c strong{color:var(--text-primary,#111);font-weight:500}.c b{flex:none;display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--text-primary,#111);color:var(--surface-2,#fff);font-size:12px}.o{margin:8px 4px 4px}</style><div class="g">${ cards }</div><button class="o">${ OTHER_OPTIONS } ↗</button><script>document.querySelectorAll('.c').forEach(c=>{c.querySelector('iframe').srcdoc=c.nextElementSibling.textContent;c.onclick=()=>sendPrompt(c.dataset.pick)});const fit=()=>document.querySelectorAll('.f').forEach(f=>{f.firstChild.style.transform='scale('+f.clientWidth/${
		PREVIEW_VIEWPORT.width
	}+')'});fit();addEventListener('resize',fit);document.querySelector('.o').onclick=()=>sendPrompt('${ OTHER_OPTIONS }');</script>`;
}

export interface DesignOptionInput {
	label: string;
	description: string;
	preview: string;
	image?: string;
}

export interface RenderedDesignOption {
	label: string;
	description: string;
	image: string;
	markup: string;
}

export async function renderPreviews(
	inputs: DesignOptionInput[],
	format: 'png' | 'jpeg'
): Promise< RenderedDesignOption[] > {
	const directory = await resolveScreenshotDirectory();
	return Promise.all(
		inputs.map( async ( option, index ) => {
			const slug =
				option.label
					.toLowerCase()
					.replace( /[^a-z0-9]+/g, '-' )
					.replace( /^-+|-+$/g, '' )
					.slice( 0, 40 ) || `option-${ index + 1 }`;
			const htmlPath = path.join( directory, `preview-${ index + 1 }-${ slug }.html` );
			let capture;
			let markup;
			try {
				const isDesignBoard = option.preview.trimStart().startsWith( '---' );
				markup = isDesignBoard ? renderDesignBoard( option.preview ) : option.preview;
				const html = isDesignBoard
					? renderDesignBoard( option.preview, option.image )
					: option.preview;
				await writeFile( htmlPath, await inlineLocalImages( html ) );
				capture = await captureScreenshotBuffer( pathToFileURL( htmlPath ).href, PREVIEW_VIEWPORT, {
					fullPage: false,
					format,
					// Previews handed to the host travel in the conversation: half size.
					deviceScaleFactor: format === 'jpeg' ? 0.5 : undefined,
				} );
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
				format,
			} );
			return {
				label: option.label,
				description: option.description,
				image: file.path,
				markup,
			};
		} )
	);
}

// Hands rendered options to the host's agent to show: a clickable widget for
// hosts that render HTML inline, otherwise a grid image and a question.
export async function handOverOptions( {
	question,
	catalog,
	options,
	displayDirectory,
	note,
	view,
}: {
	question: string;
	catalog: string;
	options: RenderedDesignOption[];
	displayDirectory?: () => Promise< string | undefined >;
	note?: string;
	view?: HostCapabilities[ 'designOptionsView' ];
} ): Promise< ToolResult > {
	const directory = await resolveScreenshotDirectory();
	const gridPage = path.join( directory, `design-options-${ Date.now() }.html` );
	await writeFile( gridPage, renderOptionsGrid( options ) );
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
	const displayFolder = await displayDirectory?.().catch( () => undefined );
	const gridPath = displayFolder
		? path.join( displayFolder, path.basename( gridFile.path ) )
		: gridFile.path;
	if ( displayFolder ) {
		await copyFile( gridFile.path, gridPath );
	}
	const choices = [
		...options.map(
			( option, index ) => `${ index + 1 }. ${ option.label }: ${ option.description }`
		),
		`${ OTHER_OPTIONS }: new ones, none of these again.`,
	];
	const structuredContent = {
		question,
		catalog,
		options: options.map( ( { label, description, image } ) => ( { label, description, image } ) ),
	};
	const gridImage = {
		type: 'image' as const,
		data: grid.buffer.toString( 'base64' ),
		mimeType: 'image/jpeg',
	};
	const askInReply = [
		`1. Start your message with this line, verbatim, so the grid shows in the conversation: ![${ question }](${ gridPath })`,
		`2. Right after that text, call your AskUserQuestion tool (a question tool with clickable options; if you have none, ask in your reply and end your turn: their pick arrives as their next message) with the question "${ question }" and one option per line below, labels verbatim:`,
		...choices.map( ( choice ) => `   - ${ choice }` ),
		'',
		`Build what they pick. If they pick "${ OTHER_OPTIONS }", draw that step again with pick_design; if they describe their own, follow it.`,
	];
	if ( view === 'picker' ) {
		return {
			content: [
				gridImage,
				{
					type: 'text' as const,
					text: [
						`The ${ options.length } options (the grid above) are shown to the user right under this tool call, as a picker with rendered previews: "${ question }".`,
						...( note ? [ '', note ] : [] ),
						'',
						`Do not show or list them again and ask nothing else: end your turn now. The user's click arrives as their next message. Build what they pick. If they pick "${ OTHER_OPTIONS }", draw that step again with pick_design; if they describe their own, follow it.`,
					].join( '\n' ),
				},
			],
			structuredContent,
		};
	}
	if ( view === 'widget' ) {
		return {
			content: [
				gridImage,
				{
					type: 'text' as const,
					text: [
						`Rendered the ${ options.length } options as a clickable widget (the HTML below) and as one numbered grid image (above). The user cannot see tool results, only what you show them.`,
						...( note ? [ '', note ] : [] ),
						'',
						"Show them the widget: load mcp__visualize__show_widget (or your other tool that renders HTML inline in the conversation) if it is deferred, and call it now with the HTML below, verbatim, as the widget code, then end your turn. The widget is the question: do not also call AskUserQuestion or list the options, since clicking a card sends the user's pick as their message. The widget already follows the widget tool's design rules, so skip its read_me.",
						'',
						'Only if you have no such tool, do this instead, in this same turn:',
						...askInReply,
					].join( '\n' ),
				},
				{ type: 'text' as const, text: renderOptionsWidget( question, options ) },
			],
			structuredContent,
		};
	}
	return {
		content: [
			gridImage,
			{
				type: 'text' as const,
				text: [
					`Rendered the ${ options.length } options as one numbered grid image (above). The user cannot see tool results, only what you show them, so in this same turn:`,
					...( note ? [ '', note, '' ] : [] ),
					...askInReply,
				].join( '\n' ),
			},
		],
		structuredContent,
	};
}

export function createPresentDesignOptionsTool( {
	askUser,
	displayDirectory,
	view,
	tracks,
}: {
	// Waits for the pick; without it the previews are returned for the host's
	// agent to show and ask about in its own conversation.
	askUser?: AskUserHandler;
	displayDirectory?: () => Promise< string | undefined >;
	view?: HostCapabilities[ 'designOptionsView' ];
	tracks?: DesignTracksContext;
} ) {
	return defineTool(
		'present_design_options',
		`Shows the user the options drawn by pick_design as rendered previews and ${
			askUser
				? 'waits for their pick'
				: view === 'picker'
				? 'shows them to the user as a clickable picker under the tool call'
				: `returns them as a numbered grid image${
						view === 'widget' ? ' and a clickable widget' : ''
				  } for you to show, since the user does not see tool results: the result says how`
		}. Pass one option per drawn entry (2–4), in the order pick_design returned them, each with a \`preview\`: for a look, the option's DESIGN.md draft, rendered as a design board with its generated \`image\` if it has one; for a layout, a complete standalone HTML sneak peek — inline CSS, no scripts, optionally a Google Fonts link with a fallback stack; images referenced by absolute path under the site are inlined, otherwise use solid color shapes, never web URLs. Each is rendered in a ${
			PREVIEW_VIEWPORT.width
		}×${
			PREVIEW_VIEWPORT.height
		} frame that a sneak peek must fill to the bottom: ${ FRAME_FILL_RECIPE }. A sneak peek whose content ends above the bottom of the frame is rejected. The user can also type their own answer, or pick "${ OTHER_OPTIONS }", added for you after the previews: then draw that step again. Use this only for the site design choices; ask everything else ${
			askUser ? 'with AskUserQuestion' : 'in your reply'
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
			// Previews handed back to the host's agent travel in the conversation, so keep them light.
			const format = askUser ? 'png' : 'jpeg';
			const options = await renderPreviews( args.options, format );
			if ( ! askUser ) {
				return handOverOptions( {
					question: args.question,
					catalog: args.catalog,
					options,
					displayDirectory,
					view,
				} );
			}

			const answers = await askUser( [
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
		{ settlesPendingWork: true }
	);
}
