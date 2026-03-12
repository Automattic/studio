import {
	TUI,
	ProcessTerminal,
	Editor,
	Markdown,
	Text,
	Loader,
	Container,
	CombinedAutocompleteProvider,
	matchesKey,
	isKeyRelease,
	type Component,
	type Focusable,
	type EditorTheme,
	type EditorOptions,
	type MarkdownTheme,
} from '@mariozechner/pi-tui';
import chalk from 'chalk';
import { AI_MODELS, DEFAULT_MODEL, type AiModelId, type AskUserQuestion } from 'cli/ai/agent';
import { AI_CHAT_SLASH_COMMANDS, type SlashCommandDef } from 'cli/ai/slash-commands';
import {
	diffTodoSnapshot,
	type TodoChange,
	type TodoDiff,
	type TodoEntry,
} from 'cli/ai/todo-stream';
import { getSiteUrl, readAppdata, type SiteData } from 'cli/lib/appdata';
import { openBrowser } from 'cli/lib/browser';
import { isSiteRunning } from 'cli/lib/site-utils';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TodoWriteInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';

export interface SiteInfo {
	name: string;
	path: string;
	running: boolean;
}

const FILE_PREVIEW_MAX_LINES = 10;

interface ExpandablePreview {
	textComponent: Text;
	collapsedContent: string;
	expandedContent: string;
	isExpanded: boolean;
}

class PromptEditor implements Component, Focusable {
	private editor: Editor;
	private borderColorFn: ( text: string ) => string;
	private _focused = false;
	private isEmpty = true;
	activeSiteName: string | null = null;
	hints: string[] = [];
	slashCommands: SlashCommandDef[] = [];

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
		this.editor = new Editor( tui, theme, { ...options, paddingX: 0 } );
		this.borderColorFn = theme.borderColor;
	}

	setText( text: string ): void {
		this.isEmpty = text === '';
		this.editor.setText( text );
	}

	handleInput( data: string ): void {
		this.isEmpty = false;
		this.editor.handleInput( data );
	}

	setAutocompleteProvider( provider: CombinedAutocompleteProvider ): void {
		this.editor.setAutocompleteProvider( provider );
	}

	getText(): string {
		return this.editor.getText();
	}

	invalidate(): void {
		this.editor.invalidate();
	}

	render( width: number ): string[] {
		const promptPrefix = ' ' + chalk.bold( '❯ ' );
		const promptWidth = 3; // space + ❯ + space
		const innerWidth = Math.max( 1, width - promptWidth );
		const lines = this.editor.render( innerWidth );
		const bc = this.borderColorFn;

		// The Editor renders: [top_border, ...content, bottom_border, ...autocomplete]
		// Find the bottom border index: it's the last line containing ─ (U+2500).
		// Autocomplete lines after it should pass through unchanged.
		let bottomBorderIndex = lines.length - 1;
		for ( let i = lines.length - 1; i > 0; i-- ) {
			if ( lines[ i ].includes( '─' ) ) {
				bottomBorderIndex = i;
				break;
			}
		}

		const hasAutocomplete = bottomBorderIndex < lines.length - 1;
		// Only keep lines up to (and including) the bottom border; drop editor autocomplete lines.
		const editorLines = lines.slice( 0, bottomBorderIndex + 1 );
		const emptyPrefix = ' '.repeat( promptWidth );
		const result = editorLines.map( ( line, i ) => {
			if ( i === 0 ) {
				// Top border with active site name on the right
				if ( this.activeSiteName ) {
					const label = ` ${ this.activeSiteName } `;
					const trailing = 3;
					const leading = Math.max( 0, width - 2 - label.length - trailing );
					return (
						' ' +
						bc( '─'.repeat( leading ) ) +
						chalk.hex( '#8839ef' )( label ) +
						bc( '─'.repeat( trailing ) )
					);
				}
				return ' ' + bc( '─'.repeat( width - 2 ) );
			}
			if ( i === bottomBorderIndex ) {
				return ' ' + bc( '─'.repeat( width - 2 ) );
			}
			if ( this.isEmpty && i === 1 ) {
				return promptPrefix + chalk.dim( 'Type your prompt…' );
			}
			if ( i === 1 ) {
				return promptPrefix + line;
			}
			return emptyPrefix + line;
		} );

		// Below the bottom border: show either our own suggestions or the hint bar
		if ( hasAutocomplete && this.slashCommands.length > 0 ) {
			// Filter commands by what the user typed (e.g. "/mo" filters to "model")
			const text = this.getText().trim();
			const prefix = text.startsWith( '/' ) ? text.slice( 1 ).toLowerCase() : '';
			const matching = this.slashCommands.filter( ( cmd ) =>
				cmd.name.toLowerCase().startsWith( prefix )
			);
			const maxLen = Math.max( ...matching.map( ( c ) => c.name.length ) );
			for ( const cmd of matching ) {
				result.push(
					' ' + chalk.dim( `/${ cmd.name.padEnd( maxLen ) }` ) + chalk.dim( '  ' + cmd.description )
				);
			}
		} else if ( this.hints.length > 0 ) {
			result.push( ' ' + this.hints.map( ( h ) => chalk.dim( h ) ).join( chalk.dim( ' · ' ) ) );
		}

		return result;
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
	borderColor: ( text ) => chalk.white( text ),
	selectList: {
		selectedPrefix: ( text ) => chalk.cyan( text ),
		selectedText: ( text ) => chalk.bold( text ),
		description: ( text ) => chalk.dim( text ),
		scrollInfo: ( text ) => chalk.dim( text ),
		noMatch: ( text ) => chalk.dim( text ),
	},
};

const toolDisplayNames: Record< string, string > = {
	mcp__studio__site_create: 'Create site',
	mcp__studio__site_list: 'List sites',
	mcp__studio__site_info: 'Get site info',
	mcp__studio__site_start: 'Start site',
	mcp__studio__site_stop: 'Stop site',
	mcp__studio__site_delete: 'Delete site',
	mcp__studio__wp_cli: 'Run WP-CLI',
	mcp__studio__validate_blocks: 'Validate blocks',
	mcp__studio__take_screenshot: 'Take screenshot',
	Read: 'Read',
	Write: 'Write',
	Edit: 'Edit',
	Bash: 'Run',
	Glob: 'Search',
	Grep: 'Search',
	Skill: 'Load skill',
	Task: 'Run task',
	TodoWrite: 'Update todo list',
};

function getToolDetail( name: string, input: Record< string, unknown > ): string {
	switch ( name ) {
		case 'mcp__studio__site_create':
			return typeof input.name === 'string' ? input.name : '';
		case 'mcp__studio__site_info':
		case 'mcp__studio__site_start':
		case 'mcp__studio__site_stop':
		case 'mcp__studio__site_delete':
			return typeof input.nameOrPath === 'string' ? input.nameOrPath : '';
		case 'mcp__studio__wp_cli':
			return typeof input.command === 'string' ? `wp ${ input.command }` : '';
		case 'mcp__studio__validate_blocks':
			if ( typeof input.filePath === 'string' ) {
				return input.filePath.split( '/' ).slice( -2 ).join( '/' );
			}
			return 'inline content';
		case 'mcp__studio__take_screenshot':
			return typeof input.url === 'string' ? input.url : '';
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
			return chalk.bold( displayName ) + ' ' + chalk.dim( '(' + detail + ')' );
		}
	}
	return chalk.bold( displayName );
}

interface ToolUseResultContent {
	content?: string | Array< { type: string; text?: string } >;
	isError?: boolean;
}

interface PendingTodoRender {
	diff: TodoDiff;
	toolLabel: string;
	shouldRender: boolean;
}

interface RenderableToolLine {
	text: string;
	dim?: boolean;
}

function isTodoWriteInput( input: unknown ): input is TodoWriteInput {
	if (
		! input ||
		typeof input !== 'object' ||
		! Array.isArray( ( input as TodoWriteInput ).todos )
	) {
		return false;
	}

	return ( input as TodoWriteInput ).todos.every(
		( todo ) =>
			typeof todo === 'object' &&
			todo !== null &&
			typeof todo.content === 'string' &&
			typeof todo.activeForm === 'string' &&
			( todo.status === 'pending' || todo.status === 'in_progress' || todo.status === 'completed' )
	);
}

function formatTodoAction( action: 'added' | 'completed', todo: TodoChange ): string {
	const verb = action === 'added' ? 'Added todo' : 'Completed todo';
	return `${ verb }: ${ todo.content }`;
}

/**
 * Format a single todo snapshot line for display.
 * in_progress uses activeForm (present-tense "working on it" phrasing),
 * while pending/completed use content (the canonical description).
 */
function formatTodoSnapshotLine( todo: TodoEntry ): string {
	switch ( todo.status ) {
		case 'completed':
			return `${ chalk.green( '✓' ) } ${ chalk.dim( chalk.strikethrough( todo.content ) ) }`;
		case 'in_progress':
			return `${ chalk.yellow( '◐' ) } ${ chalk.dim( todo.activeForm ) }`;
		default:
			return `${ chalk.dim( '○' ) } ${ chalk.dim( todo.content ) }`;
	}
}

export class AiChatUI {
	private tui: TUI;
	private editor: PromptEditor;
	private loader: Loader;
	private messages: Container;
	private currentResponseText = '';
	private currentMarkdown: Markdown | null = null;
	private submitResolve: ( ( text: string ) => void ) | null = null;
	private loaderVisible = false;
	private editorVisible = false;
	private interruptCallback: ( () => void ) | null = null;
	private hasShownResponseMarker = false;
	private turnStartTime = 0;
	private toolStartTime: number | null = null;
	private toolDotText: Text | null = null;
	private toolDotTimer: ReturnType< typeof setInterval > | null = null;
	private toolDotVisible = true;
	private toolDotLabel = '';
	private todoSnapshot: TodoEntry[] = [];
	private latestTodoSnapshot: TodoEntry[] = [];
	private lastRenderedTodoSignature: string | null = null;
	private pendingTodoRenders = new Map< string, PendingTodoRender >();
	private pendingTodoRenderOrder: string[] = [];
	private _activeSite: SiteInfo | null = null;
	private expandablePreview: ExpandablePreview | null = null;
	private _inAgentTurn = false;
	private _activeSiteData: SiteData | null = null;
	private pendingToolCalls = new Map<
		string,
		{ name: string; input: Record< string, unknown > }
	>();
	currentModel: AiModelId = DEFAULT_MODEL;

	private readonly thinkingMessages = [
		'Thinking…',
		'Iterating…',
		'Interpolating…',
		'Philosophising…',
		'Cogitating…',
		'Poetizing…',
		'Sketching…',
		'Scribbling…',
		'Drafting…',
		'Harmonizing…',
		'Rehearsing…',
		'Combabulating…',
		'Conjectureing…',
		'Tinkering…',
		'Polishing…',
		'Concocting…',
		'Wizarding…',
		'Enchanting…',
		'Transmuting…',
		'Summoning…',
		'Gutenberging…',
		'Hooking…',
		'Filtering…',
		'Looping…',
		'Codexing…',
		'Annotating…',
		'Ruminating…',
		'Paragraphing…',
		'Typesetting…',
		'Soloing…',
		'Compiling…',
		'Abstracting…',
		'Meandering…',
		'Daydreaming…',
		'Riffing…',
		'Wandering…',
		'Introspecting…',
		'Experiencing…',
		'Reflecting…',
		'Adventuring…',
		'Levitating…',
		'Glueing…',
		'Soaring…',
		'Gliding…',
		'Paragliding…',
		'Excavating…',
		'Planting…',
		'Stargazing…',
		'Scribing…',
		'Levitating…',
	];
	private randomThinkingMessage(): string {
		return this.thinkingMessages[ Math.floor( Math.random() * this.thinkingMessages.length ) ];
	}
	private optionPickerVisible = false;
	private optionPickerContainer: Container | null = null;
	private optionPickerItems: { label: string; description: string }[] = [];
	private optionPickerSelectedIndex = 0;
	private optionPickerResolve: ( ( label: string ) => void ) | null = null;
	private sitePickerVisible = false;
	private sitePickerContainer: Container | null = null;
	private sitePickerItems: SiteInfo[] = [];
	private sitePickerSiteData: SiteData[] = [];
	private sitePickerSelectedIndex = 0;

	get activeSite(): SiteInfo | null {
		return this._activeSite;
	}

	constructor() {
		const terminal = new ProcessTerminal();
		this.tui = new TUI( terminal );

		this.messages = new Container();
		this.tui.addChild( this.messages );

		this.loader = new Loader(
			this.tui,
			( str ) => chalk.yellow( str ),
			( str ) => chalk.yellow( str ),
			'Thinking…'
		);
		// @ts-expect-error -- frames is private but has no public API to customize
		this.loader.frames = [
			'•',
			'•',
			'✦',
			'✦',
			'✷',
			'✷',
			'✸',
			'✸',
			'✹',
			'✹',
			'✺',
			'✺',
			'✹',
			'✹',
			'✸',
			'✸',
			'✷',
			'✷',
			'✦',
			'✦',
			'•',
			'•',
		];

		this.editor = new PromptEditor( this.tui, editorTheme );

		this.editor.slashCommands = AI_CHAT_SLASH_COMMANDS;
		this.editor.setAutocompleteProvider(
			new CombinedAutocompleteProvider( AI_CHAT_SLASH_COMMANDS )
		);

		this.editor.onSubmit = ( text ) => {
			const trimmed = text.trim();
			if ( trimmed && this.submitResolve ) {
				const resolve = this.submitResolve;
				this.submitResolve = null;
				resolve( trimmed );
			}
		};
		// Ctrl+C to exit, Escape to interrupt/close picker, arrow keys for picker
		this.tui.addInputListener( ( data ) => {
			// Ignore key release events (Kitty protocol sends press + release)
			if ( isKeyRelease( data ) ) {
				return { consume: true };
			}
			if ( matchesKey( data, 'ctrl+c' ) ) {
				this.stop();
				process.exit( 0 );
			}
			// Option picker navigation (must be checked before site picker)
			if ( this.optionPickerVisible ) {
				if ( matchesKey( data, 'up' ) ) {
					this.optionPickerSelectedIndex = Math.max( 0, this.optionPickerSelectedIndex - 1 );
					this.renderOptionPicker();
					return { consume: true };
				}
				if ( matchesKey( data, 'down' ) ) {
					this.optionPickerSelectedIndex = Math.min(
						this.optionPickerItems.length - 1,
						this.optionPickerSelectedIndex + 1
					);
					this.renderOptionPicker();
					return { consume: true };
				}
				if ( matchesKey( data, 'enter' ) ) {
					const selected = this.optionPickerItems[ this.optionPickerSelectedIndex ];
					this.closeOptionPicker();
					if ( selected && this.optionPickerResolve ) {
						this.optionPickerResolve( selected.label );
						this.optionPickerResolve = null;
					}
					return { consume: true };
				}
				return { consume: true };
			}
			// Down arrow to open site picker (when editor is visible and picker is not)
			if ( matchesKey( data, 'down' ) && this.editorVisible && ! this.sitePickerVisible ) {
				void this.openSitePicker();
				return { consume: true };
			}
			// Site picker navigation
			if ( this.sitePickerVisible ) {
				if ( matchesKey( data, 'up' ) ) {
					this.sitePickerSelectedIndex = Math.max( 0, this.sitePickerSelectedIndex - 1 );
					this.renderSitePicker();
					return { consume: true };
				}
				if ( matchesKey( data, 'down' ) ) {
					this.sitePickerSelectedIndex = Math.min(
						this.sitePickerItems.length - 1,
						this.sitePickerSelectedIndex + 1
					);
					this.renderSitePicker();
					return { consume: true };
				}
				if ( matchesKey( data, 'enter' ) ) {
					this.selectSite( this.sitePickerSelectedIndex );
					return { consume: true };
				}
				if ( matchesKey( data, 'space' ) ) {
					void this.openSelectedSite();
					return { consume: true };
				}
				if ( matchesKey( data, 'escape' ) ) {
					this.closeSitePicker();
					return { consume: true };
				}
				return { consume: true };
			}
			if ( matchesKey( data, 'escape' ) && this.interruptCallback ) {
				this.interruptCallback();
			}
			if ( matchesKey( data, 'ctrl+o' ) && this.expandablePreview ) {
				this.toggleExpandablePreview();
				return { consume: true };
			}
			return undefined;
		} );
	}

	private async openSitePicker(): Promise< void > {
		const appdata = await readAppdata();
		const sites: SiteData[] = appdata.sites ?? [];
		if ( sites.length === 0 ) {
			this.messages.addChild(
				new Text( chalk.dim( '  No sites found. Create one first.' ), 1, 0 )
			);
			this.tui.requestRender();
			return;
		}

		this.sitePickerSiteData = sites;
		this.sitePickerItems = await Promise.all(
			sites.map( async ( site ) => ( {
				name: site.name,
				path: site.path,
				running: await isSiteRunning( site ),
			} ) )
		);
		this.sitePickerSelectedIndex = 0;
		this.sitePickerVisible = true;
		this.updateHints();
		this.sitePickerContainer = new Container();
		this.tui.addChild( this.sitePickerContainer );
		this.renderSitePicker();
	}

	private renderSitePicker(): void {
		if ( ! this.sitePickerContainer ) {
			return;
		}
		// Clear previous children
		while (
			( this.sitePickerContainer as Container & { children?: unknown[] } ).children?.length
		) {
			this.sitePickerContainer.removeChild(
				( this.sitePickerContainer as Container & { children: Component[] } ).children[ 0 ]
			);
		}

		const header = chalk.dim( '  Select a site:' );
		const items = this.sitePickerItems.map( ( site, i ) => {
			const status = site.running ? chalk.green( '●' ) + ' ' : '  ';
			if ( i === this.sitePickerSelectedIndex ) {
				return `  ${ chalk.blue( '❯' ) } ${ status }${ chalk.bold( site.name ) }`;
			}
			return `    ${ status }${ site.name }`;
		} );

		const text = [
			header,
			...items,
			chalk.dim( '  ↑↓ navigate · enter select · space open in browser · esc cancel' ),
		].join( '\n' );
		this.sitePickerContainer.addChild( new Text( text, 0, 0 ) );
		this.tui.requestRender();
	}

	private selectSite( index: number ): void {
		const site = this.sitePickerItems[ index ];
		if ( site ) {
			this.setActiveSite( site );
			this._activeSiteData = this.sitePickerSiteData[ index ] ?? null;
		}
		this.closeSitePicker();
	}

	private setActiveSite( site: SiteInfo ): void {
		this._activeSite = site;
		this.editor.activeSiteName = site.name;
		this.messages.addChild(
			new Text( chalk.hex( '#8839ef' )( ' ✻ Selected site: ' + site.name ) + '\n', 0, 0 )
		);
		this.tui.requestRender();
	}

	private clearActiveSite(): void {
		this._activeSite = null;
		this._activeSiteData = null;
		this.editor.activeSiteName = null;
		this.messages.addChild( new Text( chalk.dim( ' ✻ Site deselected' ) + '\n', 0, 0 ) );
		this.tui.requestRender();
	}

	private async findSiteFromAppdata( nameOrPath: string ): Promise< SiteInfo | null > {
		const appdata = await readAppdata();
		const site = appdata.sites.find(
			( s ) => s.name.toLowerCase() === nameOrPath.toLowerCase() || s.path === nameOrPath
		);
		if ( ! site ) {
			return null;
		}
		// Keep _activeSiteData in sync for /browser command
		this._activeSiteData = site;
		return {
			name: site.name,
			path: site.path,
			running: await isSiteRunning( site ),
		};
	}

	private isSameSite( a: SiteInfo | null, b: SiteInfo ): boolean {
		return !! a && ( a.name.toLowerCase() === b.name.toLowerCase() || a.path === b.path );
	}

	private async autoSelectSiteFromToolResult(
		toolName: string,
		toolInput: Record< string, unknown > | null
	): Promise< void > {
		switch ( toolName ) {
			case 'mcp__studio__site_create': {
				// site_create tool input has { name: string }
				const name = toolInput?.name;
				if ( typeof name === 'string' ) {
					const site = await this.findSiteFromAppdata( name );
					if ( site ) {
						site.running = true; // site_create auto-starts the site
						this.setActiveSite( site );
					}
				}
				break;
			}
			case 'mcp__studio__site_start': {
				const nameOrPath = toolInput?.nameOrPath;
				if ( typeof nameOrPath === 'string' ) {
					const site = await this.findSiteFromAppdata( nameOrPath );
					if ( site ) {
						site.running = true;
						if ( this.isSameSite( this._activeSite, site ) ) {
							this._activeSite = site; // Update running status in-place
						} else {
							this.setActiveSite( site );
						}
					}
				}
				break;
			}
			case 'mcp__studio__wp_cli': {
				const nameOrPath = toolInput?.nameOrPath;
				if ( typeof nameOrPath === 'string' ) {
					if (
						! this._activeSite ||
						! this.isSameSite( this._activeSite, {
							name: nameOrPath,
							path: nameOrPath,
							running: true,
						} )
					) {
						const site = await this.findSiteFromAppdata( nameOrPath );
						if ( site ) {
							this.setActiveSite( site );
						}
					}
				}
				break;
			}
			case 'mcp__studio__site_stop': {
				const nameOrPath = toolInput?.nameOrPath;
				if (
					typeof nameOrPath === 'string' &&
					this._activeSite &&
					this.isSameSite( this._activeSite, {
						name: nameOrPath,
						path: nameOrPath,
						running: false,
					} )
				) {
					this._activeSite = { ...this._activeSite, running: false };
				}
				break;
			}
			case 'mcp__studio__site_delete': {
				const nameOrPath = toolInput?.nameOrPath;
				if (
					typeof nameOrPath === 'string' &&
					this._activeSite &&
					this.isSameSite( this._activeSite, {
						name: nameOrPath,
						path: nameOrPath,
						running: false,
					} )
				) {
					this.clearActiveSite();
				}
				break;
			}
		}
	}

	private async openSelectedSite(): Promise< void > {
		const siteData = this.sitePickerSiteData[ this.sitePickerSelectedIndex ];
		if ( ! siteData ) {
			return;
		}
		const url = getSiteUrl( siteData );
		if ( url ) {
			await openBrowser( url );
		}
	}

	async openActiveSiteInBrowser(): Promise< boolean > {
		if ( ! this._activeSiteData ) {
			return false;
		}
		// Re-read appdata to get the current site state (port/domain may have changed)
		const appdata = await readAppdata();
		const freshSiteData = appdata.sites?.find( ( s ) => s.name === this._activeSite?.name );
		const siteData = freshSiteData ?? this._activeSiteData;
		const url = getSiteUrl( siteData );
		if ( url ) {
			await openBrowser( url );
			return true;
		}
		return false;
	}

	private closeSitePicker(): void {
		if ( this.sitePickerContainer ) {
			this.tui.removeChild( this.sitePickerContainer );
			this.sitePickerContainer = null;
		}
		this.sitePickerVisible = false;
		this.sitePickerItems = [];
		this.sitePickerSiteData = [];
		this.updateHints();
		this.tui.requestRender();
	}

	private renderOptionPicker(): void {
		if ( ! this.optionPickerContainer ) {
			return;
		}
		while (
			( this.optionPickerContainer as Container & { children?: unknown[] } ).children?.length
		) {
			this.optionPickerContainer.removeChild(
				( this.optionPickerContainer as Container & { children: Component[] } ).children[ 0 ]
			);
		}

		const items = this.optionPickerItems.map( ( opt, i ) => {
			if ( i === this.optionPickerSelectedIndex ) {
				return `  ${ chalk.blue( '❯' ) } ${ i + 1 }. ${ chalk.blue( opt.label ) }`;
			}
			return `    ${ i + 1 }. ${ opt.label }`;
		} );

		const text = items.join( '\n' );
		this.optionPickerContainer.addChild( new Text( text, 0, 0 ) );
		this.tui.requestRender();
	}

	private closeOptionPicker(): void {
		if ( this.optionPickerContainer ) {
			this.tui.removeChild( this.optionPickerContainer );
			this.optionPickerContainer = null;
		}
		this.optionPickerVisible = false;
		this.optionPickerItems = [];
		this.tui.requestRender();
	}

	start(): void {
		this.tui.start();
	}

	showWelcome(): void {
		const version = typeof __STUDIO_CLI_VERSION__ === 'string' ? __STUDIO_CLI_VERSION__ : '';
		const cwd = process.cwd();
		const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
		const displayCwd = home && cwd.startsWith( home ) ? '~' + cwd.slice( home.length ) : cwd;

		const b = chalk.blue;

		// W logo in block characters
		const logo = [
			'  ▗▟▛▀▀▜▙▖',
			' ▟▌     ▗█▙',
			'▟██▘▝██ ▝██▙',
			'▌▐█▖ ▐█▌ ▐▌▐',
			'▌ ▜▙ ▐██ ▐▘▐',
			'▜▖▝█▄▌▝█▄▌▗▛',
			' ▜▖▜█  ▜█▗▛',
			'  ▝▜█▄▄▟▛▘',
		].map( ( s ) => b( s.padEnd( 12, ' ' ) ) );

		const info = [
			chalk.bold( 'WordPress Studio' ) + ( version ? chalk.dim( ` v${ version }` ) : '' ),
			chalk.dim( `${ AI_MODELS[ this.currentModel ] } · ${ displayCwd }` ),
			'',
			chalk.dim.italic( 'Code is Poetry' ),
		];

		// Lay out logo on the left, info on the right (vertically centered)
		const gap = 4;
		const infoStartRow = Math.max( 0, Math.floor( ( logo.length - info.length ) / 2 ) );

		const lines = logo.map( ( logoLine, i ) => {
			const infoIndex = i - infoStartRow;
			const infoText = infoIndex >= 0 && infoIndex < info.length ? info[ infoIndex ] : '';
			return ' ' + logoLine + ' '.repeat( gap ) + infoText;
		} );

		this.messages.addChild( new Text( '\n' + lines.join( '\n' ) + '\n', 0, 0 ) );
		this.tui.requestRender();
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

	addUserMessage( text: string ): void {
		const lines = text.split( '\n' );
		const formatted = lines
			.map( ( line, i ) => {
				if ( i === 0 ) {
					return ' ' + chalk.bgHex( '#eeeeee' ).black( '❯ ' + line + ' ' );
				}
				return ' ' + chalk.bgHex( '#eeeeee' ).black( '   ' + line + ' ' );
			} )
			.join( '\n' );
		this.messages.addChild( new Text( '\n' + formatted, 0, 0 ) );
		this.tui.requestRender();
	}

	setLoaderMessage( message: string ): void {
		if ( ! message ) {
			return;
		}
		this.messages.addChild( new Text( '   ' + chalk.dim( '⎿ ' ) + chalk.dim( message ), 0, 0 ) );
		this.tui.requestRender();
	}

	private showLoader( message?: string ): void {
		if ( ! this.loaderVisible ) {
			// Ensure editor is removed first so loader appears above it
			const wasEditorVisible = this.editorVisible;
			if ( wasEditorVisible ) {
				this.tui.removeChild( this.editor );
			}
			this.tui.addChild( this.loader );
			if ( wasEditorVisible ) {
				this.tui.addChild( this.editor );
			}
			this.loader.start();
			this.loaderVisible = true;
		}
		if ( message ) {
			this.loader.setMessage( message + '\n' );
		}
		this.tui.requestRender();
	}

	private hideLoader(): void {
		if ( this.loaderVisible ) {
			this.loader.stop();
			this.tui.removeChild( this.loader );
			this.loaderVisible = false;
			this.tui.requestRender();
		}
	}

	private updateHints(): void {
		if ( this.sitePickerVisible ) {
			this.editor.hints = [];
			return;
		}
		const hints: string[] = [];
		if ( ! this._inAgentTurn ) {
			hints.push( '↓ select site' );
		}
		if ( this.expandablePreview && ! this.expandablePreview.isExpanded ) {
			hints.push( 'ctrl+o expand' );
		} else if ( this.expandablePreview?.isExpanded ) {
			hints.push( 'ctrl+o collapse' );
		}
		hints.push( 'esc to interrupt' );
		this.editor.hints = hints;
	}

	private showEditor(): void {
		if ( ! this.editorVisible ) {
			this.tui.addChild( this.editor );
			this.tui.setFocus( this.editor );
			this.editorVisible = true;
			this.updateHints();
			this.tui.requestRender();
		}
	}

	private hideEditor(): void {
		if ( this.editorVisible ) {
			this.tui.removeChild( this.editor );
			this.editorVisible = false;
			this.updateHints();
			this.tui.requestRender();
		}
	}

	/**
	 * Begin an agent turn: hide editor, show loader, prepare response area.
	 */
	beginAgentTurn(): void {
		this.editor.setText( '' );
		this._inAgentTurn = true;
		this.updateHints();
		this.showLoader( this.randomThinkingMessage() );
		this.currentResponseText = '';
		this.hasShownResponseMarker = false;
		this.turnStartTime = Date.now();
		this.todoSnapshot = [];
		this.latestTodoSnapshot = [];
		this.lastRenderedTodoSignature = null;
		this.pendingTodoRenders.clear();
		this.pendingTodoRenderOrder = [];
	}

	/**
	 * End an agent turn: hide loader, clean up response state.
	 * todoSnapshot, latestTodoSnapshot, and lastRenderedTodoSignature are deliberately
	 * preserved across turns so the next turn's diff is computed against the latest
	 * known state, rendering only genuinely new changes.
	 */
	endAgentTurn(): void {
		this.hideLoader();
		this.stopToolDotBlink();
		this.toolDotText = null;
		this.interruptCallback = null;
		this._inAgentTurn = false;
		this.pendingToolCalls.clear();
		this.updateHints();
		this.currentMarkdown = null;
		this.currentResponseText = '';
		this.pendingTodoRenders.clear();
		this.pendingTodoRenderOrder = [];
	}

	showError( message: string ): void {
		this.messages.addChild(
			new Text( '\n ' + chalk.red( '⏺' ) + ' ' + chalk.red( message ) + '\n', 0, 0 )
		);
		this.tui.requestRender();
	}

	showInfo( message: string ): void {
		this.messages.addChild( new Text( '\n' + chalk.dim( message ) + '\n', 1, 0 ) );
		this.tui.requestRender();
	}

	private showFilePreview( toolName: string, input: Record< string, unknown > ): void {
		let preview: { collapsed: string; expanded: string } | null = null;

		if ( toolName === 'Write' && typeof input.content === 'string' ) {
			preview = this.generateWritePreview( input.content );
		} else if (
			toolName === 'Edit' &&
			typeof input.old_string === 'string' &&
			typeof input.new_string === 'string'
		) {
			preview = this.generateEditPreview( input.old_string, input.new_string );
		}

		if ( ! preview ) {
			return;
		}

		const textComponent = new Text( preview.collapsed, 0, 0 );
		this.messages.addChild( textComponent );

		if ( preview.collapsed !== preview.expanded ) {
			this.expandablePreview = {
				textComponent,
				collapsedContent: preview.collapsed,
				expandedContent: preview.expanded,
				isExpanded: false,
			};
			this.updateHints();
		} else {
			this.expandablePreview = null;
		}

		this.tui.requestRender();
	}

	private generateWritePreview( content: string ): { collapsed: string; expanded: string } {
		const lines = content.split( '\n' );
		const totalLines = lines.length;
		const numWidth = String( totalLines ).length;

		const formatLines = ( lineList: string[] ) => {
			return lineList
				.map( ( line, i ) => {
					const lineNum = chalk.dim( String( i + 1 ).padStart( numWidth ) );
					return '   ' + chalk.dim( '⎿ ' ) + lineNum + ' ' + chalk.green( line );
				} )
				.join( '\n' );
		};

		if ( totalLines <= FILE_PREVIEW_MAX_LINES ) {
			const formatted = formatLines( lines );
			return { collapsed: formatted, expanded: formatted };
		}

		const collapsed =
			formatLines( lines.slice( 0, FILE_PREVIEW_MAX_LINES ) ) +
			'\n   ' +
			chalk.dim(
				'⎿ ... ' + ( totalLines - FILE_PREVIEW_MAX_LINES ) + ' more lines · ctrl+o to expand'
			);
		const expanded = formatLines( lines );

		return { collapsed, expanded };
	}

	private generateEditPreview(
		oldStr: string,
		newStr: string
	): { collapsed: string; expanded: string } {
		const oldLines = oldStr.split( '\n' );
		const newLines = newStr.split( '\n' );

		const diffLines: string[] = [];
		for ( const line of oldLines ) {
			diffLines.push( '   ' + chalk.dim( '⎿ ' ) + chalk.red( '- ' + line ) );
		}
		for ( const line of newLines ) {
			diffLines.push( '   ' + chalk.dim( '⎿ ' ) + chalk.green( '+ ' + line ) );
		}

		const totalDiffLines = diffLines.length;

		if ( totalDiffLines <= FILE_PREVIEW_MAX_LINES ) {
			const formatted = diffLines.join( '\n' );
			return { collapsed: formatted, expanded: formatted };
		}

		const collapsed =
			diffLines.slice( 0, FILE_PREVIEW_MAX_LINES ).join( '\n' ) +
			'\n   ' +
			chalk.dim(
				'⎿ ... ' + ( totalDiffLines - FILE_PREVIEW_MAX_LINES ) + ' more lines · ctrl+o to expand'
			);
		const expanded = diffLines.join( '\n' );

		return { collapsed, expanded };
	}

	private toggleExpandablePreview(): void {
		if ( ! this.expandablePreview ) {
			return;
		}

		const preview = this.expandablePreview;
		preview.isExpanded = ! preview.isExpanded;
		preview.textComponent.setText(
			preview.isExpanded ? preview.expandedContent : preview.collapsedContent
		);
		this.updateHints();
		this.tui.requestRender();
	}

	private stopToolDotBlink(): void {
		if ( this.toolDotTimer ) {
			clearInterval( this.toolDotTimer );
			this.toolDotTimer = null;
		}
		// Ensure the dot is visible when we stop
		if ( this.toolDotText && ! this.toolDotVisible ) {
			this.toolDotVisible = true;
			this.toolDotText.setText( '\n ' + '⏺' + ' ' + this.toolDotLabel );
		}
	}

	private showToolUse( toolLabel: string ): void {
		this.showLoader( this.randomThinkingMessage() );
		this.stopToolDotBlink();
		this.toolDotLabel = toolLabel;
		this.toolDotText = new Text( '\n ' + '⏺' + ' ' + toolLabel, 0, 0 );
		this.messages.addChild( this.toolDotText );
		this.toolDotVisible = true;
		this.toolDotTimer = setInterval( () => {
			if ( ! this.toolDotText ) {
				return;
			}
			this.toolDotVisible = ! this.toolDotVisible;
			const dot = this.toolDotVisible ? '⏺' : ' ';
			this.toolDotText.setText( '\n ' + dot + ' ' + toolLabel );
			this.tui.requestRender();
		}, 500 );
	}

	private getToolResultContent(
		message: SDKMessage & { type: 'user' }
	): ToolUseResultContent | null {
		const result = message.tool_use_result;
		if ( ! result || typeof result !== 'object' ) {
			return null;
		}

		return result as ToolUseResultContent;
	}

	private finalizeToolUseLine( isError: boolean, label: string ): void {
		const elapsed = this.toolStartTime ? Date.now() - this.toolStartTime : 0;
		this.toolStartTime = null;
		const elapsedStr = elapsed > 0 ? chalk.dim( ` (${ ( elapsed / 1000 ).toFixed( 1 ) }s)` ) : '';
		const statusIcon = isError ? chalk.red( '⏺' ) : '⏺';

		if ( this.toolDotText ) {
			this.toolDotText.setText( '\n ' + statusIcon + ' ' + label + elapsedStr );
			this.toolDotText = null;
			return;
		}

		if ( isError ) {
			this.messages.addChild( new Text( '\n ' + statusIcon + ' ' + label + elapsedStr, 0, 0 ) );
		}
	}

	private renderTodoUpdate( pendingTodoRender: PendingTodoRender ): void {
		const lines: RenderableToolLine[] = [
			...pendingTodoRender.diff.added.map( ( todo ) => ( {
				text: formatTodoAction( 'added', todo ),
			} ) ),
			...pendingTodoRender.diff.completed.map( ( todo ) => ( {
				text: formatTodoAction( 'completed', todo ),
			} ) ),
			...( pendingTodoRender.diff.snapshot.length > 0
				? [
						{ text: 'Todo list:', dim: true } as RenderableToolLine,
						...pendingTodoRender.diff.snapshot.map( ( todo ) => ( {
							text: formatTodoSnapshotLine( todo ),
						} ) ),
				  ]
				: [] ),
		];
		const formatted = lines
			.map(
				( line ) => '   ' + chalk.dim( '⎿ ' ) + ( line.dim ? chalk.dim( line.text ) : line.text )
			)
			.join( '\n' );
		this.messages.addChild( new Text( formatted, 0, 0 ) );
	}

	private syncLatestTodoSnapshot(): void {
		let latestPendingSnapshot: TodoEntry[] | null = null;
		for ( const toolUseId of this.pendingTodoRenderOrder ) {
			const pendingTodoRender = this.pendingTodoRenders.get( toolUseId );
			if ( pendingTodoRender ) {
				latestPendingSnapshot = pendingTodoRender.diff.snapshot;
			}
		}
		this.latestTodoSnapshot = latestPendingSnapshot ?? this.todoSnapshot;
	}

	private consumePendingTodoRender( toolUseId: string ): PendingTodoRender | null {
		const pendingTodoRender = this.pendingTodoRenders.get( toolUseId ) ?? null;
		this.pendingTodoRenders.delete( toolUseId );
		this.pendingTodoRenderOrder = this.pendingTodoRenderOrder.filter( ( id ) => id !== toolUseId );
		return pendingTodoRender;
	}

	private renderToolResultText(
		content: string | Array< { type: string; text?: string } >,
		toolName?: string
	): void {
		let text: string;
		if ( typeof content === 'string' ) {
			text = content;
		} else {
			text = content
				.filter( ( block ) => block.type === 'text' && block.text )
				.map( ( block ) => block.text )
				.join( '\n' );
		}
		if ( ! text ) {
			return;
		}

		const maxLength = toolName === 'mcp__studio__validate_blocks' ? 2000 : 500;
		const truncated = text.length > maxLength ? text.slice( 0, maxLength ) + '…' : text;
		const resultLines = truncated.split( '\n' );
		const formatted = resultLines
			.map( ( line ) => '   ' + chalk.dim( '⎿ ' ) + chalk.dim( line ) )
			.join( '\n' );
		this.messages.addChild( new Text( formatted, 0, 0 ) );
	}

	private showToolResult(
		message: SDKMessage & { type: 'user' },
		toolName?: string,
		toolInput?: Record< string, unknown > | null
	): void {
		this.stopToolDotBlink();
		const typedResult = this.getToolResultContent( message );
		if ( ! typedResult ) {
			this.toolDotText = null;
			return;
		}
		const isError = typedResult.isError === true;

		// Auto-select the site that was operated on
		if ( ! isError && toolName && toolInput ) {
			void this.autoSelectSiteFromToolResult( toolName, toolInput );
		}

		const label = this.toolDotLabel;

		this.finalizeToolUseLine( isError, label );

		const content = typedResult.content;
		if ( content === undefined ) {
			this.tui.requestRender();
			return;
		}
		this.renderToolResultText( content, toolName );
		this.tui.requestRender();
	}

	private showTodoToolResult( message: SDKMessage & { type: 'user' }, toolUseId: string ): void {
		this.stopToolDotBlink();
		const typedResult = this.getToolResultContent( message );
		const pendingTodoRender = this.consumePendingTodoRender( toolUseId );

		if ( ! typedResult || ! pendingTodoRender ) {
			this.toolDotText = null;
			return;
		}

		const isError = typedResult.isError === true;

		if ( isError ) {
			// Errors always finalize the tool-use line (showToolUse may or may not have been called)
			this.finalizeToolUseLine( true, pendingTodoRender.toolLabel );
			this.syncLatestTodoSnapshot();
			if ( typedResult.content !== undefined ) {
				this.renderToolResultText( typedResult.content, 'TodoWrite' );
			}
			this.tui.requestRender();
			return;
		}

		this.todoSnapshot = pendingTodoRender.diff.snapshot;
		this.syncLatestTodoSnapshot();

		if ( ! pendingTodoRender.shouldRender ) {
			// No showToolUse was called for suppressed renders, so don't touch toolStartTime
			this.tui.requestRender();
			return;
		}

		this.finalizeToolUseLine( false, pendingTodoRender.toolLabel );
		this.lastRenderedTodoSignature = pendingTodoRender.diff.signature;
		this.renderTodoUpdate( pendingTodoRender );
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
			// Display the question
			this.messages.addChild( new Text( '\n' + chalk.bold( q.question ), 0, 0 ) );
			this.tui.requestRender();

			if ( q.options.length > 0 ) {
				// Use arrow-key option picker
				this.hideEditor();
				this.optionPickerItems = q.options;
				this.optionPickerSelectedIndex = 0;
				this.optionPickerVisible = true;
				this.optionPickerContainer = new Container();
				this.tui.addChild( this.optionPickerContainer );
				this.renderOptionPicker();

				const selected = await new Promise< string >( ( resolve ) => {
					this.optionPickerResolve = resolve;
				} );

				answers[ q.question ] = selected;
			} else {
				// Free-form text input
				const answer = await this.waitForInput();
				answers[ q.question ] = answer;
			}
		}

		// Resume the agent turn with a fresh markdown block for subsequent text
		this.showLoader( this.randomThinkingMessage() );
		return answers;
	}

	/**
	 * Process an SDK message and update the UI.
	 * Returns session result when the agent turn is complete.
	 */
	handleMessage(
		message: SDKMessage
	):
		| { sessionId: string; success: boolean; maxTurnsReached?: undefined }
		| { sessionId: string; maxTurnsReached: true; numTurns: number; costUsd: number }
		| undefined {
		switch ( message.type ) {
			case 'assistant': {
				for ( const block of message.message.content ) {
					if ( block.type === 'text' ) {
						this.hideLoader();
						// Lazily create a new markdown block if needed (e.g. after askUser closed the previous one)
						if ( ! this.currentMarkdown ) {
							this.currentResponseText = '';
							this.hasShownResponseMarker = false;
						}
						if ( ! this.hasShownResponseMarker ) {
							this.hasShownResponseMarker = true;
							this.currentMarkdown = new Markdown( '\n', 1, 0, markdownTheme );
							this.messages.addChild( this.currentMarkdown );
						}
						// Add a line break between consecutive assistant messages
						if ( this.currentResponseText && ! this.currentResponseText.endsWith( '\n' ) ) {
							this.currentResponseText += '\n';
						}
						this.currentResponseText += block.text;
						this.currentMarkdown!.setText(
							'\n' + chalk.blue( '⏺' ) + ' ' + this.currentResponseText
						);
						this.tui.requestRender();
					} else if ( block.type === 'tool_use' ) {
						this.toolStartTime = Date.now();
						const typedBlock = block as {
							id: string;
							name: string;
							input?: Record< string, unknown >;
						};
						const input = typedBlock.input;
						this.pendingToolCalls.set( typedBlock.id, {
							name: typedBlock.name,
							input: input ?? {},
						} );
						const toolLabel = formatToolName( block.name, input );
						if ( block.name === 'TodoWrite' && isTodoWriteInput( input ) ) {
							const diff = diffTodoSnapshot( this.latestTodoSnapshot, input.todos );
							const shouldRender =
								diff.hasVisibleChanges && diff.signature !== this.lastRenderedTodoSignature;
							this.pendingTodoRenders.set( typedBlock.id, {
								diff,
								toolLabel,
								shouldRender,
							} );
							this.pendingTodoRenderOrder.push( typedBlock.id );
							this.latestTodoSnapshot = diff.snapshot;
							if ( shouldRender ) {
								this.showToolUse( toolLabel );
							}
						} else {
							this.showToolUse( toolLabel );
						}
						if ( ( block.name === 'Write' || block.name === 'Edit' ) && input ) {
							this.showFilePreview( block.name, input );
						}
					}
				}
				// Always show the loader after processing — the agent turn is still active
				// and more messages are coming (next API call, tool execution, etc.)
				if ( ! this.loaderVisible ) {
					this.showLoader( this.randomThinkingMessage() );
				}
				return undefined;
			}
			case 'user': {
				const toolCallId = message.parent_tool_use_id;
				const toolCall = toolCallId ? this.pendingToolCalls.get( toolCallId ) : null;
				if ( toolCallId ) {
					this.pendingToolCalls.delete( toolCallId );
				}
				// Direct ID match, or fallback for SDK-internal tools (e.g. TodoWrite)
				// where parent_tool_use_id may be null.
				if ( toolCallId && this.pendingTodoRenders.has( toolCallId ) ) {
					this.showTodoToolResult( message, toolCallId );
				} else if ( ! toolCallId && this.pendingTodoRenderOrder.length > 0 ) {
					this.showTodoToolResult( message, this.pendingTodoRenderOrder[ 0 ] );
				} else {
					this.showToolResult( message, toolCall?.name, toolCall?.input );
				}
				return undefined;
			}
			case 'result': {
				this.hideLoader();
				if ( message.subtype === 'success' ) {
					const thinkingSec = Math.round( ( Date.now() - this.turnStartTime ) / 1000 );
					if ( ! this.hasShownResponseMarker ) {
						this.messages.addChild( new Text( '\n ' + chalk.blue( '⏺' ) + ' Done', 0, 0 ) );
					}
					this.showInfo(
						`Thought for ${ thinkingSec }s · ${
							message.num_turns
						} turns · $${ message.total_cost_usd.toFixed( 4 ) }`
					);
					return { sessionId: message.session_id, success: true };
				}

				// Build detailed error message
				const parts: string[] = [];
				if ( 'errors' in message && message.errors?.length ) {
					parts.push( ...message.errors );
				}
				if ( message.subtype === 'error_max_turns' ) {
					return {
						sessionId: message.session_id,
						maxTurnsReached: true,
						numTurns: message.num_turns,
						costUsd: message.total_cost_usd,
					};
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
