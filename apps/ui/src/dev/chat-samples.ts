import { USAGE_CAP_ERROR_PREFIX } from '@studio/common/ai/json-events';
import type { SessionEntry } from '@/data/core';

interface ToolCall {
	name: string;
	args?: Record< string, unknown >;
	result?: string;
	isError?: boolean;
	details?: unknown;
}

export interface ChatSample {
	title: string;
	entries: SessionEntry[];
	running?: boolean;
	pendingQuestions?: string[];
}

const START = Date.parse( '2026-10-24T09:00:00Z' );

// Builds a transcript the way the agent writes it: entries a few seconds
// apart, tool results following their calls.
function transcript( build: ( t: ReturnType< typeof writer > ) => void ): SessionEntry[] {
	const t = writer();
	build( t );
	return t.entries;
}

function writer() {
	const entries: SessionEntry[] = [];
	let clock = START;
	let callCount = 0;
	const add = ( entry: Record< string, unknown >, seconds = 1 ) => {
		clock += seconds * 1000;
		entries.push( {
			id: `e${ entries.length }`,
			parentId: null,
			timestamp: new Date( clock ).toISOString(),
			...entry,
		} as unknown as SessionEntry );
	};
	const custom = ( customType: string, data: unknown, seconds = 1 ) =>
		add( { type: 'custom', customType, data }, seconds );

	return {
		entries,
		prompt: ( text: string, extra: Record< string, unknown > = {} ) =>
			custom( 'studio.user_prompt', { text, source: 'prompt', ...extra } ),
		/** Strings are text blocks, objects tool calls; a call with a `result` gets it paired. */
		assistant: ( ...blocks: Array< string | ToolCall > ) => {
			const calls = blocks.map( ( block ) =>
				typeof block === 'string' ? block : { ...block, id: `call-${ ++callCount }` }
			);
			add(
				{
					type: 'message',
					message: {
						role: 'assistant',
						content: calls.map( ( block ) =>
							typeof block === 'string'
								? { type: 'text', text: block }
								: { type: 'toolCall', id: block.id, name: block.name, arguments: block.args ?? {} }
						),
					},
				},
				4
			);
			for ( const call of calls ) {
				if ( typeof call !== 'string' && call.result !== undefined ) {
					add( {
						type: 'message',
						message: {
							role: 'toolResult',
							toolCallId: call.id,
							content: [ { type: 'text', text: call.result } ],
							isError: call.isError,
							details: call.details,
						},
					} );
				}
			}
		},
		question: ( question: string, options: unknown[], extra: Record< string, unknown > = {} ) =>
			custom( 'studio.agent_question', { question, options, ...extra } ),
		progress: ( message: string ) => custom( 'studio.tool_progress', { message } ),
		images: ( paths: string[] ) =>
			custom( 'studio.chat_artifact', {
				version: 1,
				id: `artifact-${ entries.length }`,
				widgets: paths.map( ( path ) => ( {
					type: 'media',
					widgetProps: {
						mediaKind: 'image',
						alt: 'Screenshot',
						source: { type: 'local', path, name: path, mimeType: 'image/svg+xml' },
					},
				} ) ),
			} ),
		closed: ( status = 'success', errorMessage?: string ) =>
			custom( 'studio.turn_closed', { status, errorMessage }, 3 ),
	};
}

// A stand-in for a site screenshot, served by the playground's
// `readLocalMediaFile`.
export function sampleImage( path: string ): string {
	const [ background, accent ] = path.includes( 'mobile' )
		? [ '#f4efe6', '#c0603a' ]
		: [ '#eef2ec', '#4f7a5a' ];
	const [ width, height ] = path.includes( 'mobile' ) ? [ 390, 640 ] : [ 1280, 800 ];
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${ width }" height="${ height }"><rect width="100%" height="100%" fill="${ background }"/><rect x="8%" y="8%" width="40%" height="6%" rx="8" fill="${ accent }"/><rect x="8%" y="20%" width="84%" height="40%" rx="12" fill="${ accent }" opacity=".35"/><rect x="8%" y="66%" width="60%" height="4%" rx="6" fill="${ accent }" opacity=".6"/><rect x="8%" y="74%" width="48%" height="4%" rx="6" fill="${ accent }" opacity=".4"/></svg>`;
}

const ATTACHMENT_PREVIEW = `data:image/svg+xml,${ encodeURIComponent( sampleImage( 'mobile' ) ) }`;

const MARKDOWN = `# Menu page plan

Here is the plan for the **Bistro Lune** menu page, with *seasonal* dishes, ~~weekly~~ monthly prices and a [reservation link](https://wordpress.org/). The theme lives in \`wp-content/themes/bistro-lune/\`.

## Sections

1. A hero with the dinner hours
2. The menu, grouped by course:
   - Starters
   - Mains
3. A reservations band

### Checklist

- [x] Keep the palette warm
- [ ] Confirm the final copy

> Prices change weekly, so they come from a pattern rather than the page content.

\`\`\`php
<?php
function bistro_lune_menu_price( $cents ) {
	return sprintf( '€%.2f', $cents / 100 );
}
\`\`\`

\`\`\`studio-example
An unknown language still reads as plain, copyable text.
\`\`\`

| Course | Dishes | Price |
| :--- | :---: | ---: |
| Starters | 4 | €9 |
| Mains | 6 | €21 |

| File | Purpose |
| --- | --- |
| \`a-very-long-filename-that-must-stay-readable-without-widening-the-conversation.php\` | A wide table scrolls inside the message |

https://example.com/a/deliberately/long/path/that/should/wrap/within/the/message/without/widening/the/chat

---

That's everything. Shall I start with the hero?`;

export const chatSamples: ChatSample[] = [
	{
		title: 'Prompt with attachments, Markdown reply',
		entries: transcript( ( t ) => {
			t.prompt(
				'Plan a menu page for the bistro. Keep it warm and simple, list the courses, and show me the code you would use for prices.',
				{
					attachments: [
						{
							kind: 'image',
							id: 'sketch',
							name: 'menu-sketch.svg',
							mimeType: 'image/svg+xml',
							size: 1200,
							previewDataUrl: ATTACHMENT_PREVIEW,
						},
						{ kind: 'file', name: 'menu-2026.pdf', mimeType: 'application/pdf', size: 20480 },
					],
				}
			);
			t.assistant( MARKDOWN );
			t.closed();
		} ),
	},
	{
		title: 'Tool calls: read, edit with a diff, commands, an error',
		entries: transcript( ( t ) => {
			t.prompt( 'Tidy the header and set the tagline.' );
			t.assistant( 'Let me read the header first.', {
				name: 'Read',
				args: { path: 'wp-content/themes/bistro-lune/parts/header.html' },
				result:
					'<!-- wp:group {"className":"site-header"} -->\n<div class="wp-block-group site-header">…</div>\n<!-- /wp:group -->',
			} );
			t.assistant( {
				name: 'Edit',
				args: {
					path: 'wp-content/themes/bistro-lune/parts/header.html',
					edits: [ { oldText: 'site-header', newText: 'site-header is-sticky' } ],
				},
				result: 'Successfully replaced 1 block(s).',
				details: {
					diff: '@@ -1,3 +1,3 @@\n-<!-- wp:group {"className":"site-header"} -->\n+<!-- wp:group {"className":"site-header is-sticky"} -->\n <div class="wp-block-group site-header">…</div>',
				},
			} );
			t.assistant(
				{
					name: 'wp_cli',
					args: { command: 'option update blogdescription "Seasonal French cooking"' },
					result: "Success: Updated 'blogdescription' option.",
				},
				{
					name: 'wp_cli',
					args: { command: 'theme mod set header_sticky 1' },
					result: "Error: 'mod' is not a registered subcommand of 'theme'.",
					isError: true,
				},
				{
					name: 'Bash',
					args: { command: 'ls wp-content/themes/bistro-lune/parts' },
					result: 'footer.html\nheader.html',
				}
			);
			t.assistant(
				'The header is now sticky and the tagline reads **Seasonal French cooking**. The `theme mod` command failed, but the block attribute already covers it.'
			);
			t.closed();
		} ),
	},
	{
		title: 'Running turn with a tool in progress',
		running: true,
		entries: transcript( ( t ) => {
			t.prompt( 'Add a footer with the address.' );
			t.assistant( 'Let me look at the footer part.', {
				name: 'Read',
				args: { path: 'wp-content/themes/bistro-lune/parts/footer.html' },
			} );
			t.progress( 'Reading the footer template…' );
		} ),
	},
	{
		title: 'Streaming an incomplete reply',
		running: true,
		entries: transcript( ( t ) => {
			t.prompt( 'Describe the homepage.' );
			t.assistant(
				'The **homepage** is ready. I’m still working on `navigation\n\n```css\n.hero {\n  padding: 2rem;'
			);
		} ),
	},
	{
		title: 'Pending questions',
		pendingQuestions: [ 'Which page should I add next?', 'How should the gallery be laid out?' ],
		entries: transcript( ( t ) => {
			t.prompt( 'Ask me what to build next.' );
			t.assistant( 'Two quick questions before I start.', { name: 'AskUserQuestion' } );
			t.question( 'Which page should I add next?', [
				{ label: 'Reservations', description: 'A booking form with opening hours.' },
				{ label: 'Gallery', description: 'Photos of the dining room and dishes.' },
				{ label: 'Private events', description: 'Menus and contact for groups.' },
			] );
			t.question( 'How should the gallery be laid out?', [
				{ label: 'Masonry', description: 'Mixed heights in columns.' },
				{ label: 'Grid', description: 'Even squares.' },
			] );
		} ),
	},
	{
		title: 'Pending image picker',
		pendingQuestions: [ 'Which look should I build?' ],
		entries: transcript( ( t ) => {
			t.prompt( 'Show me some looks.' );
			t.assistant( 'Here are three looks.', { name: 'present_design_options' } );
			t.question( 'Which look should I build?', [
				{ label: 'Garden', description: 'Green and calm.', image: '/shots/desktop.svg' },
				{ label: 'Terracotta', description: 'Warm and earthy.', image: '/shots/mobile.svg' },
				{ label: 'Plain', description: 'No image for this one.' },
			] );
		} ),
	},
	{
		title: 'Answered questions, one typed in the composer',
		entries: transcript( ( t ) => {
			t.prompt( 'Ask me what to build next.' );
			t.assistant( 'Two quick questions before I start.', { name: 'AskUserQuestion' } );
			t.question(
				'Which page should I add next?',
				[
					{ label: 'Reservations', description: 'A booking form with opening hours.' },
					{ label: 'Gallery', description: 'Photos of the dining room and dishes.' },
				],
				{ selectedLabel: 'Gallery' }
			);
			t.question(
				'How should the gallery be laid out?',
				[
					{ label: 'Masonry', description: 'Mixed heights in columns.' },
					{ label: 'Grid', description: 'Even squares.' },
				],
				{ selectedLabel: 'A single slideshow, please' }
			);
			t.assistant( 'A **Gallery** page as a single slideshow. I will build it now.' );
			t.closed();
		} ),
	},
	{
		title: 'Screenshots',
		entries: transcript( ( t ) => {
			t.prompt( 'Show me the site.' );
			t.assistant( 'Here is the current home page on desktop and mobile.' );
			t.images( [ '/shots/desktop.svg', '/shots/mobile.svg' ] );
			t.closed();
		} ),
	},
	{
		title: 'Preview annotations',
		entries: transcript( ( t ) => {
			t.prompt( '2 annotations submitted', {
				visualAnnotations: [
					{
						comment: 'Make this heading larger.',
						tag: 'h1',
						elementLabel: 'Heading',
						nearbyText: 'Bistro Lune',
					},
					{
						comment: 'Use the accent color here.',
						tag: 'a',
						elementLabel: 'Button',
						nearbyText: 'Book a table',
					},
				],
			} );
			t.assistant( 'I enlarged the heading and switched the button to the accent color.' );
			t.closed();
		} ),
	},
	{
		title: 'Markers: error, interrupted, usage cap, access required, blocked',
		entries: transcript( ( t ) => {
			t.prompt( 'Publish it to WordPress.com.' );
			t.closed( 'error', 'The AI provider is overloaded (529). Try again in a moment.' );
			t.prompt( 'Add a footer with the address.' );
			t.assistant( 'Let me look at the footer part.', {
				name: 'Read',
				args: { path: 'parts/footer.html' },
				result: '<!-- wp:group -->…',
			} );
			t.closed( 'interrupted' );
			t.prompt( 'Try again.' );
			t.closed( 'error', USAGE_CAP_ERROR_PREFIX );
			t.prompt( 'Try once more.' );
			t.closed( 'error', 'studio_code_ai_access_required' );
			t.prompt( 'And again.' );
			t.closed( 'error', 'studio_code_ai_disabled' );
		} ),
	},
];
