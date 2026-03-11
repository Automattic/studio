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
import { getSiteUrl, readAppdata, type SiteData } from 'cli/lib/appdata';
import { openBrowser } from 'cli/lib/browser';
import { isSiteRunning } from 'cli/lib/site-utils';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export interface SiteInfo {
	name: string;
	path: string;
	running: boolean;
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
	private lastToolName: string | null = null;
	private hasShownResponseMarker = false;
	private turnStartTime = 0;
	private toolStartTime: number | null = null;
	private toolDotText: Text | null = null;
	private toolDotTimer: ReturnType< typeof setInterval > | null = null;
	private toolDotVisible = true;
	private toolDotLabel = '';
	private _activeSite: SiteInfo | null = null;
	private _activeSiteData: SiteData | null = null;
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
		this.editor.hints = [];
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
			this._activeSite = site;
			this._activeSiteData = this.sitePickerSiteData[ index ] ?? null;
			this.editor.activeSiteName = site.name;
			this.messages.addChild(
				new Text( chalk.hex( '#8839ef' )( ' ✻ Selected site: ' + site.name ) + '\n', 0, 0 )
			);
		}
		this.closeSitePicker();
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
		this.editor.hints = [ '↓ select site', 'esc to interrupt' ];
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

		// WordPress logo in block characters, widened to avoid vertical stretching in terminals.
		const logo = [
			'    ▄█▛▀▀▀▀█▙▖',
			' ▗▟█        ▗██▄',
			'▄███▛ ▝▜██  ▝███▙',
			'█ ▐█▙   ███  ▐█ ▐',
			'█  ▀█▄  ███▌ ▐▛ ▐',
			'▀▙▖ ▜█▄▟ ▝█▙▄▌ ▄▛',
			' ▝▜▄▝██▌  ▀██▗▟▀',
			'    ▀██▙▄▄▄█▛▘',
		].map( ( s ) => b( s ) );

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
		this.editor.hints = [ '↓ select site', 'esc to interrupt' ];
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
		this.editor.hints = [ 'esc to interrupt' ];
		this.showLoader( this.randomThinkingMessage() );
		this.currentResponseText = '';
		this.hasShownResponseMarker = false;
		this.turnStartTime = Date.now();
	}

	/**
	 * End an agent turn: hide loader, clean up response state.
	 */
	endAgentTurn(): void {
		this.hideLoader();
		this.stopToolDotBlink();
		this.toolDotText = null;
		this.interruptCallback = null;
		this.updateHints();
		this.currentMarkdown = null;
		this.currentResponseText = '';
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

	private showToolResult( message: SDKMessage & { type: 'user' }, toolName?: string ): void {
		this.stopToolDotBlink();
		const result = message.tool_use_result;
		if ( ! result || typeof result !== 'object' ) {
			this.toolDotText = null;
			return;
		}
		const typedResult = result as {
			content?: Array< { type: string; text?: string } >;
			isError?: boolean;
		};
		const isError = typedResult.isError === true;

		// Show elapsed time
		const elapsed = this.toolStartTime ? Date.now() - this.toolStartTime : 0;
		this.toolStartTime = null;
		const elapsedStr = elapsed > 0 ? chalk.dim( ` (${ ( elapsed / 1000 ).toFixed( 1 ) }s)` ) : '';
		const statusIcon = isError ? chalk.red( '⏺' ) : '⏺';
		const label = this.toolDotLabel;

		// Update the existing tool-use line in place
		if ( this.toolDotText ) {
			this.toolDotText.setText( '\n ' + statusIcon + ' ' + label + elapsedStr );
			this.toolDotText = null;
		}

		const content = typedResult.content;
		if ( ! Array.isArray( content ) ) {
			this.tui.requestRender();
			return;
		}
		const text = content
			.filter( ( block ) => block.type === 'text' && block.text )
			.map( ( block ) => block.text )
			.join( '\n' );
		if ( ! text ) {
			this.tui.requestRender();
			return;
		}
		// Use a larger limit for validation results so they're fully visible
		const maxLength = toolName === 'mcp__studio__validate_blocks' ? 2000 : 500;
		const truncated = text.length > maxLength ? text.slice( 0, maxLength ) + '…' : text;
		const resultLines = truncated.split( '\n' );
		const formatted = resultLines
			.map( ( line ) => '   ' + chalk.dim( '⎿ ' ) + chalk.dim( line ) )
			.join( '\n' );
		this.messages.addChild( new Text( formatted, 0, 0 ) );
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
						this.lastToolName = block.name;
						this.toolStartTime = Date.now();
						const input = ( block as { input?: Record< string, unknown > } ).input;
						const toolLabel = formatToolName( block.name, input );
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
				}
				// Always show the loader after processing — the agent turn is still active
				// and more messages are coming (next API call, tool execution, etc.)
				if ( ! this.loaderVisible ) {
					this.showLoader( this.randomThinkingMessage() );
				}
				return undefined;
			}
			case 'user': {
				this.showToolResult( message, this.lastToolName ?? undefined );
				this.lastToolName = null;
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
