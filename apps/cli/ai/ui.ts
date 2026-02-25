import {
	TUI,
	ProcessTerminal,
	Editor,
	Markdown,
	Text,
	Loader,
	Container,
	type Component,
	type Focusable,
	type EditorTheme,
	type EditorOptions,
	type MarkdownTheme,
} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AskUserQuestion } from 'cli/ai/agent';

/**
 * Wraps the Editor component with left/right borders and rounded corners.
 * The Editor only renders top/bottom horizontal lines — this adds │ on the sides
 * and ╭╮╰╯ corners for a complete box.
 */
class BorderedEditor implements Component, Focusable {
	private editor: Editor;
	private borderColorFn: ( text: string ) => string;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}
	set focused( value: boolean ) {
		this._focused = value;
		this.editor.focused = value;
	}

	set onSubmit( fn: ( ( text: string ) => void ) | undefined ) {
		this.editor.onSubmit = fn;
	}

	constructor( tui: TUI, theme: EditorTheme, options?: EditorOptions ) {
		this.editor = new Editor( tui, theme, { ...options, paddingX: options?.paddingX ?? 1 } );
		this.borderColorFn = theme.borderColor;
	}

	setText( text: string ): void {
		this.editor.setText( text );
	}

	handleInput( data: string ): void {
		this.editor.handleInput( data );
	}

	invalidate(): void {
		this.editor.invalidate();
	}

	render( width: number ): string[] {
		const innerWidth = Math.max( 1, width - 2 );
		const lines = this.editor.render( innerWidth );
		const bc = this.borderColorFn;

		return lines.map( ( line, i ) => {
			if ( i === 0 ) {
				return bc( '┌' ) + line + bc( '┐' );
			}
			if ( i === lines.length - 1 ) {
				return bc( '└' ) + line + bc( '┘' );
			}
			return bc( '│' ) + line + bc( '│' );
		} );
	}
}

const markdownTheme: MarkdownTheme = {
	heading: ( text ) => chalk.bold( text ),
	link: ( text ) => chalk.cyan.underline( text ),
	linkUrl: ( text ) => chalk.dim( text ),
	code: ( text ) => chalk.yellow( text ),
	codeBlock: ( text ) => text,
	codeBlockBorder: ( text ) => chalk.dim( text ),
	quote: ( text ) => chalk.italic( text ),
	quoteBorder: ( text ) => chalk.dim( text ),
	hr: ( text ) => chalk.dim( text ),
	listBullet: ( text ) => chalk.cyan( text ),
	bold: ( text ) => chalk.bold( text ),
	italic: ( text ) => chalk.italic( text ),
	strikethrough: ( text ) => chalk.strikethrough( text ),
	underline: ( text ) => chalk.underline( text ),
};

const editorTheme: EditorTheme = {
	borderColor: ( text ) => chalk.cyan( text ),
	selectList: {
		selectedItem: ( text ) => chalk.inverse( text ),
		item: ( text ) => text,
		border: ( text ) => chalk.dim( text ),
	},
};

const toolDisplayNames: Record< string, string > = {
	mcp__studio__site_create: 'Creating site',
	mcp__studio__site_list: 'Listing sites',
	mcp__studio__site_info: 'Getting site info',
	mcp__studio__site_start: 'Starting site',
	mcp__studio__site_stop: 'Stopping site',
	mcp__studio__wp_cli: 'Running WP-CLI',
	mcp__studio__validate_blocks: 'Validating blocks',
	Read: 'Reading file',
	Write: 'Writing file',
	Edit: 'Editing file',
	Bash: 'Running command',
	Glob: 'Searching files',
	Grep: 'Searching code',
	Skill: 'Loading skill',
	Task: 'Running task',
};

function getToolDetail( name: string, input: Record< string, unknown > ): string {
	switch ( name ) {
		case 'mcp__studio__site_create':
			return typeof input.name === 'string' ? input.name : '';
		case 'mcp__studio__site_info':
		case 'mcp__studio__site_start':
		case 'mcp__studio__site_stop':
			return typeof input.nameOrPath === 'string' ? input.nameOrPath : '';
		case 'mcp__studio__wp_cli':
			return typeof input.command === 'string' ? `wp ${ input.command }` : '';
		case 'mcp__studio__validate_blocks':
			if ( typeof input.filePath === 'string' ) {
				return input.filePath.split( '/' ).slice( -2 ).join( '/' );
			}
			return 'inline content';
		case 'Read':
		case 'Write':
		case 'Edit': {
			const filePath = input.file_path ?? input.path;
			if ( typeof filePath === 'string' ) {
				const parts = filePath.split( '/' );
				return parts.slice( -2 ).join( '/' );
			}
			return '';
		}
		case 'Bash':
			return typeof input.command === 'string'
				? input.command.length > 60
					? input.command.slice( 0, 57 ) + '…'
					: input.command
				: '';
		case 'Skill':
			return typeof input.skill === 'string' ? input.skill : '';
		case 'Grep':
			return typeof input.pattern === 'string' ? input.pattern : '';
		case 'Glob':
			return typeof input.pattern === 'string' ? input.pattern : '';
		default:
			return '';
	}
}

function formatToolName( name: string, input?: Record< string, unknown > ): string {
	const displayName = toolDisplayNames[ name ] ?? name;
	if ( input ) {
		const detail = getToolDetail( name, input );
		if ( detail ) {
			return `${ displayName }: ${ detail }`;
		}
	}
	return displayName;
}

export class AiChatUI {
	private tui: TUI;
	private editor: BorderedEditor;
	private loader: Loader;
	private messages: Container;
	private currentResponseText = '';
	private currentMarkdown: Markdown | null = null;
	private submitResolve: ( ( text: string ) => void ) | null = null;
	private loaderVisible = false;
	private editorVisible = false;
	private interruptCallback: ( () => void ) | null = null;

	constructor() {
		const terminal = new ProcessTerminal();
		this.tui = new TUI( terminal );

		this.messages = new Container();
		this.tui.addChild( this.messages );

		this.loader = new Loader(
			this.tui,
			( str ) => chalk.cyan( str ),
			( str ) => chalk.dim( str ),
			'Thinking…'
		);

		this.editor = new BorderedEditor( this.tui, editorTheme );
		this.editor.onSubmit = ( text ) => {
			const trimmed = text.trim();
			if ( trimmed && this.submitResolve ) {
				const resolve = this.submitResolve;
				this.submitResolve = null;
				resolve( trimmed );
			}
		};

		// Ctrl+C to exit, Escape to interrupt agent
		this.tui.addInputListener( ( data ) => {
			if ( data === '\x03' ) {
				this.stop();
				process.exit( 0 );
			}
			if ( data === '\x1b' && this.interruptCallback ) {
				this.interruptCallback();
			}
			return undefined;
		} );
	}

	start(): void {
		this.tui.start();
	}

	set onInterrupt( fn: ( () => void ) | null ) {
		this.interruptCallback = fn;
	}

	stop(): void {
		this.loader.stop();
		this.tui.stop();
	}

	waitForInput(): Promise< string > {
		this.editor.setText( '' );
		this.hideLoader();
		this.showEditor();
		return new Promise( ( resolve ) => {
			this.submitResolve = resolve;
		} );
	}

	private addSpacer(): void {
		this.messages.addChild( new Text( '', 0, 0 ) );
	}

	addUserMessage( text: string ): void {
		this.addSpacer();
		this.messages.addChild( new Text( chalk.bold.cyan( '> ' ) + text, 0, 0 ) );
		this.tui.requestRender();
	}

	setLoaderMessage( message: string ): void {
		if ( this.loaderVisible ) {
			this.loader.setMessage( message );
		}
	}

	private showLoader(): void {
		if ( ! this.loaderVisible ) {
			this.tui.addChild( this.loader );
			this.loader.start();
			this.loaderVisible = true;
			this.tui.requestRender();
		}
	}

	private hideLoader(): void {
		if ( this.loaderVisible ) {
			this.loader.stop();
			this.tui.removeChild( this.loader );
			this.loaderVisible = false;
			this.tui.requestRender();
		}
	}

	private showEditor(): void {
		if ( ! this.editorVisible ) {
			this.tui.addChild( this.editor );
			this.tui.setFocus( this.editor );
			this.editorVisible = true;
			this.tui.requestRender();
		}
	}

	private hideEditor(): void {
		if ( this.editorVisible ) {
			this.tui.removeChild( this.editor );
			this.editorVisible = false;
			this.tui.requestRender();
		}
	}

	/**
	 * Begin an agent turn: hide editor, show loader, prepare response area.
	 */
	beginAgentTurn(): void {
		this.hideEditor();
		this.showLoader();
		this.currentResponseText = '';
		this.addSpacer();
		this.currentMarkdown = new Markdown( '', 1, 0, markdownTheme );
		this.messages.addChild( this.currentMarkdown );
	}

	/**
	 * End an agent turn: hide loader, clean up response state.
	 */
	endAgentTurn(): void {
		this.hideLoader();
		this.interruptCallback = null;
		this.currentMarkdown = null;
		this.currentResponseText = '';
	}

	showError( message: string ): void {
		this.messages.addChild( new Text( chalk.red( message ), 0, 0 ) );
		this.tui.requestRender();
	}

	showInfo( message: string ): void {
		this.messages.addChild( new Text( chalk.dim( message ), 0, 0 ) );
		this.tui.requestRender();
	}

	private showToolResult( message: SDKMessage & { type: 'user' } ): void {
		const result = message.tool_use_result;
		if ( ! result || typeof result !== 'object' ) {
			return;
		}
		const typedResult = result as {
			content?: Array< { type: string; text?: string } >;
			isError?: boolean;
		};
		const content = typedResult.content;
		if ( ! Array.isArray( content ) ) {
			return;
		}
		const text = content
			.filter( ( block ) => block.type === 'text' && block.text )
			.map( ( block ) => block.text )
			.join( '\n' );
		if ( ! text ) {
			return;
		}
		const maxLength = 500;
		const truncated = text.length > maxLength ? text.slice( 0, maxLength ) + '…' : text;
		const prefix = typedResult.isError ? chalk.red( '✗ ' ) : chalk.dim( '↳ ' );
		this.messages.addChild( new Text( prefix + chalk.dim( truncated ), 1, 0 ) );
		this.tui.requestRender();
	}

	/**
	 * Display questions from the agent and collect user answers.
	 * Called via canUseTool when the agent uses AskUserQuestion.
	 */
	async askUser( questions: AskUserQuestion[] ): Promise< Record< string, string > > {
		this.hideLoader();

		// Close off the current markdown block so questions appear after the text so far
		this.currentMarkdown = null;
		this.currentResponseText = '';

		const answers: Record< string, string > = {};

		for ( const q of questions ) {
			// Display the question and options
			this.addSpacer();
			let questionText = chalk.bold.yellow( '? ' ) + chalk.bold( q.question );
			if ( q.options.length > 0 ) {
				questionText += '\n';
				questionText += q.options
					.map(
						( opt, i ) =>
							chalk.dim( `  ${ i + 1 }. ` ) + opt.label + chalk.dim( ` — ${ opt.description }` )
					)
					.join( '\n' );
			}
			this.messages.addChild( new Text( questionText, 0, 0 ) );
			this.tui.requestRender();

			// Collect answer via the editor
			const answer = await this.waitForInput();
			this.hideEditor();

			// Show the user's answer
			this.messages.addChild( new Text( chalk.bold.cyan( '> ' ) + answer, 0, 0 ) );

			// If user typed a number, map to option label
			const num = parseInt( answer, 10 );
			if ( ! isNaN( num ) && num >= 1 && num <= q.options.length ) {
				answers[ q.question ] = q.options[ num - 1 ].label;
			} else {
				answers[ q.question ] = answer;
			}
		}

		// Resume the agent turn with a fresh markdown block for subsequent text
		this.showLoader();
		return answers;
	}

	/**
	 * Process an SDK message and update the UI.
	 * Returns session result when the agent turn is complete.
	 */
	handleMessage( message: SDKMessage ): { sessionId: string; success: boolean } | undefined {
		switch ( message.type ) {
			case 'assistant': {
				for ( const block of message.message.content ) {
					if ( block.type === 'text' ) {
						this.hideLoader();
						// Lazily create a new markdown block if needed (e.g. after askUser closed the previous one)
						if ( ! this.currentMarkdown ) {
							this.currentResponseText = '';
							this.currentMarkdown = new Markdown( '', 1, 0, markdownTheme );
							this.messages.addChild( this.currentMarkdown );
						}
						// Add a line break between consecutive assistant messages
						if ( this.currentResponseText && ! this.currentResponseText.endsWith( '\n' ) ) {
							this.currentResponseText += '\n';
						}
						this.currentResponseText += block.text;
						this.currentMarkdown.setText( this.currentResponseText );
						this.tui.requestRender();
					} else if ( block.type === 'tool_use' ) {
						this.showLoader();
						const input = ( block as { input?: Record< string, unknown > } ).input;
						this.loader.setMessage( formatToolName( block.name, input ) );
					}
				}
				// Always show the loader after processing — the agent turn is still active
				// and more messages are coming (next API call, tool execution, etc.)
				if ( ! this.loaderVisible ) {
					this.showLoader();
					this.loader.setMessage( 'Thinking…' );
				}
				return undefined;
			}
			case 'user': {
				this.showToolResult( message );
				return undefined;
			}
			case 'result': {
				this.hideLoader();
				if ( message.subtype === 'success' ) {
					this.showInfo(
						`${ message.num_turns } turns · $${ message.total_cost_usd.toFixed( 4 ) }`
					);
					return { sessionId: message.session_id, success: true };
				}

				// Build detailed error message
				const parts: string[] = [];
				if ( 'errors' in message && message.errors?.length ) {
					parts.push( ...message.errors );
				}
				if ( message.subtype === 'error_max_turns' ) {
					parts.push(
						'Reached the maximum number of turns. Use --max-turns to increase the limit.'
					);
				} else if ( message.subtype ) {
					parts.push( `(${ message.subtype })` );
				}
				if ( 'permission_denials' in message && message.permission_denials?.length ) {
					for ( const denial of message.permission_denials ) {
						parts.push( `Permission denied: ${ denial.tool_name }` );
					}
				}
				this.showError( parts.length > 0 ? parts.join( '\n' ) : 'Unknown error' );
				return { sessionId: message.session_id, success: false };
			}
		}
		return undefined;
	}
}
