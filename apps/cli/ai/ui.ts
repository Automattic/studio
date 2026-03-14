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
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER, type AiProviderId } from 'cli/ai/providers';
import { AI_CHAT_SLASH_COMMANDS, type SlashCommandDef } from 'cli/ai/slash-commands';
import {
	diffTodoSnapshot,
	type TodoChange,
	type TodoDiff,
	type TodoEntry,
} from 'cli/ai/todo-stream';
import { getWpComSites } from 'cli/lib/api';
import { getAuthToken, getSiteUrl, readAppdata, type SiteData } from 'cli/lib/appdata';
import { openBrowser } from 'cli/lib/browser';
import { isSiteRunning } from 'cli/lib/site-utils';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TodoWriteInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';

const SITE_PICKER_TAB_LOCAL = 'local' as const;
const SITE_PICKER_TAB_REMOTE = 'remote' as const;
type SitePickerTab = typeof SITE_PICKER_TAB_LOCAL | typeof SITE_PICKER_TAB_REMOTE;

export interface SiteInfo {
	name: string;
	path: string;
	running: boolean;
	remote?: boolean;
	url?: string;
}

const DEFAULT_COLLAPSE_THRESHOLD_LINES = 5;

interface ExpandablePreview {
	textComponent: Text;
	collapsedContent: string;
	expandedContent: string;
	isExpanded: boolean;
}

function formatToolOutputLines( lines: string[] ): string {
	return lines
		.map( ( line, index ) => `${ index === 0 ? '   ' + chalk.dim( '⎿ ' ) : '     ' }${ line }` )
		.join( '\n' );
}

class PromptEditor implements Component, Focusable {
	private editor: Editor;
	private borderColorFn: ( text: string ) => string;
	private _focused = false;
	private isEmpty = true;
	activeSiteName: string | null = null;
	hints: string[] = [];
	slashCommands: SlashCommandDef[] = [];
	slashCommandSelectedIndex = -1;
	statusMessage: string | null = null;

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
		this.editor.handleInput( data );
		this.isEmpty = this.editor.getText() === '';
		this.slashCommandSelectedIndex = -1;
	}

	setAutocompleteProvider( provider: CombinedAutocompleteProvider ): void {
		this.editor.setAutocompleteProvider( provider );
	}

	getText(): string {
		return this.editor.getText();
	}

	getMatchingSlashCommands(): SlashCommandDef[] {
		const text = this.getText().trim();
		if ( ! text.startsWith( '/' ) ) {
			return [];
		}
		const prefix = text.slice( 1 ).toLowerCase();
		return this.slashCommands.filter( ( cmd ) => cmd.name.toLowerCase().startsWith( prefix ) );
	}

	get isSlashMenuVisible(): boolean {
		return this.getMatchingSlashCommands().length > 0;
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

		// Below the bottom border: show suggestions or hint bar (with optional status on the right)
		if ( hasAutocomplete && this.slashCommands.length > 0 ) {
			const matching = this.getMatchingSlashCommands();
			const maxLen = Math.max( ...matching.map( ( c ) => c.name.length ) );
			for ( let i = 0; i < matching.length; i++ ) {
				const cmd = matching[ i ];
				const isSelected = i === this.slashCommandSelectedIndex;
				const label = `/${ cmd.name.padEnd( maxLen ) }  ${ cmd.description }`;
				result.push( ' ' + ( isSelected ? chalk.blue( label ) : chalk.dim( label ) ) );
			}
		} else {
			const activeHints = this.isEmpty
				? this.hints
				: this.hints.filter( ( h ) => h !== '↓ select site' );
			const leftPart =
				activeHints.length > 0
					? ' ' + activeHints.map( ( h ) => chalk.dim( h ) ).join( chalk.dim( ' · ' ) )
					: '';
			const rightPart = this.statusMessage ? chalk.dim( this.statusMessage ) + ' ' : '';
			if ( leftPart || rightPart ) {
				// eslint-disable-next-line no-control-regex
				const stripAnsi = ( s: string ) => s.replace( /\x1b\[[0-9;]*m/g, '' );
				const leftLen = stripAnsi( leftPart ).length;
				const rightLen = stripAnsi( rightPart ).length;
				const padding = Math.max( 1, width - leftLen - rightLen );
				result.push( leftPart + ' '.repeat( padding ) + rightPart );
			}
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
	mcp__figma__get_design_context: 'Figma design',
	mcp__figma__get_screenshot: 'Figma screenshot',
	mcp__figma__get_variable_defs: 'Figma variables',
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
		case 'mcp__figma__get_design_context':
		case 'mcp__figma__get_screenshot':
		case 'mcp__figma__get_variable_defs': {
			if ( typeof input.url !== 'string' ) {
				return '';
			}
			try {
				const segments = new URL( input.url ).pathname.split( '/' ).filter( Boolean );
				return segments[ 2 ] ? decodeURIComponent( segments[ 2 ] ).replace( /-/g, ' ' ) : '';
			} catch {
				return '';
			}
		}
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

interface MessageContentWithType {
	type: string;
}

interface ToolResultBlock extends MessageContentWithType {
	type: 'tool_result';
	content?: unknown;
	is_error?: boolean;
}

interface StdoutStderrToolResult {
	stdout?: unknown;
	stderr?: unknown;
	is_error?: unknown;
	noOutputExpected?: unknown;
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

function isMessageContentWithType( value: unknown ): value is MessageContentWithType {
	return typeof value === 'object' && value !== null && 'type' in value;
}

function isToolResultBlock( value: unknown ): value is ToolResultBlock {
	return isMessageContentWithType( value ) && value.type === 'tool_result';
}

function isStdoutStderrToolResult( value: unknown ): value is StdoutStderrToolResult {
	return (
		typeof value === 'object' &&
		value !== null &&
		( 'stdout' in value || 'stderr' in value || 'noOutputExpected' in value )
	);
}

function normalizeToolResultContent(
	content: unknown
): ToolUseResultContent[ 'content' ] | undefined {
	if ( typeof content === 'string' ) {
		return content;
	}

	if ( Array.isArray( content ) ) {
		return content.filter( isMessageContentWithType ).map( ( block ) => {
			if ( 'text' in block && typeof block.text === 'string' ) {
				return { type: block.type, text: block.text };
			}
			return { type: block.type };
		} );
	}

	if ( content === undefined || content === null ) {
		return undefined;
	}

	return String( content );
}

function normalizeToolUseResult( result: unknown ): ToolUseResultContent | null {
	if ( ! result || typeof result !== 'object' ) {
		return null;
	}

	if ( 'content' in result || 'isError' in result || 'is_error' in result ) {
		const typedResult = result as {
			content?: unknown;
			isError?: unknown;
			is_error?: unknown;
		};
		return {
			content: normalizeToolResultContent( typedResult.content ),
			isError: typedResult.isError === true || typedResult.is_error === true,
		};
	}

	if ( isStdoutStderrToolResult( result ) ) {
		const stdout = typeof result.stdout === 'string' ? result.stdout : '';
		const stderr = typeof result.stderr === 'string' ? result.stderr : '';
		const parts = [ stdout, stderr ? `stderr: ${ stderr }` : '' ].filter( Boolean );
		return {
			content: parts.join( '\n' ) || undefined,
			isError: result.is_error === true,
		};
	}

	return null;
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
	private wasInterrupted = false;
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
	private activeExpandablePreview: ExpandablePreview | null = null;
	private _inAgentTurn = false;
	private _activeSiteData: SiteData | null = null;
	private pendingToolCalls = new Map<
		string,
		{ name: string; input: Record< string, unknown > }
	>();
	currentModel: AiModelId = DEFAULT_MODEL;
	currentProvider: AiProviderId = DEFAULT_AI_PROVIDER;

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
	private sitePickerTab: SitePickerTab = SITE_PICKER_TAB_LOCAL;
	private sitePickerRemoteItems: SiteInfo[] = [];
	private sitePickerRemoteLoading = false;
	private sitePickerQuery = '';

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
			// Slash command menu navigation
			if ( this.editorVisible && this.editor.isSlashMenuVisible ) {
				const matching = this.editor.getMatchingSlashCommands();
				if ( matchesKey( data, 'down' ) ) {
					this.editor.slashCommandSelectedIndex = Math.min(
						matching.length - 1,
						this.editor.slashCommandSelectedIndex + 1
					);
					this.tui.requestRender();
					return { consume: true };
				}
				if ( matchesKey( data, 'up' ) ) {
					this.editor.slashCommandSelectedIndex = Math.max(
						-1,
						this.editor.slashCommandSelectedIndex - 1
					);
					this.tui.requestRender();
					return { consume: true };
				}
				if (
					( matchesKey( data, 'tab' ) || matchesKey( data, 'enter' ) ) &&
					this.editor.slashCommandSelectedIndex >= 0 &&
					this.editor.slashCommandSelectedIndex < matching.length
				) {
					const cmd = matching[ this.editor.slashCommandSelectedIndex ];
					this.editor.slashCommandSelectedIndex = -1;
					if ( matchesKey( data, 'enter' ) ) {
						// Submit the command directly
						this.editor.setText( '' );
						if ( this.submitResolve ) {
							const resolve = this.submitResolve;
							this.submitResolve = null;
							resolve( `/${ cmd.name }` );
						}
					} else {
						// Tab: fill in the command text without submitting
						this.editor.setText( `/${ cmd.name }` );
						this.tui.requestRender();
					}
					return { consume: true };
				}
				// Tab to autocomplete when there's only one match (no selection needed)
				if ( matchesKey( data, 'tab' ) && matching.length === 1 ) {
					this.editor.setText( `/${ matching[ 0 ].name }` );
					this.editor.slashCommandSelectedIndex = -1;
					this.tui.requestRender();
					return { consume: true };
				}
			}
			// Down arrow to open site picker (only when prompt is empty)
			if (
				matchesKey( data, 'down' ) &&
				this.editorVisible &&
				! this.sitePickerVisible &&
				this.editor.getText().trim() === ''
			) {
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
					const filtered = this.getFilteredSitePickerItems();
					this.sitePickerSelectedIndex = Math.min(
						filtered.length - 1,
						this.sitePickerSelectedIndex + 1
					);
					this.renderSitePicker();
					return { consume: true };
				}
				if ( matchesKey( data, 'enter' ) ) {
					const filtered = this.getFilteredSitePickerItems();
					const selectedItem = filtered[ this.sitePickerSelectedIndex ];
					if ( selectedItem ) {
						this.selectFilteredSite( selectedItem );
					}
					return { consume: true };
				}
				if ( matchesKey( data, 'tab' ) ) {
					void this.openSelectedSite();
					return { consume: true };
				}
				if ( matchesKey( data, 'right' ) && this.sitePickerTab === SITE_PICKER_TAB_LOCAL ) {
					void this.switchToRemoteSites();
					return { consume: true };
				}
				if ( matchesKey( data, 'left' ) && this.sitePickerTab === SITE_PICKER_TAB_REMOTE ) {
					this.switchToLocalSites();
					return { consume: true };
				}
				if ( matchesKey( data, 'escape' ) ) {
					if ( this.sitePickerQuery ) {
						this.setSitePickerQuery( '' );
					} else {
						this.closeSitePicker();
					}
					return { consume: true };
				}
				if ( matchesKey( data, 'backspace' ) ) {
					if ( this.sitePickerQuery ) {
						this.setSitePickerQuery( this.sitePickerQuery.slice( 0, -1 ) );
					}
					return { consume: true };
				}
				// Printable character — append to search query
				if ( data.length === 1 && data >= ' ' && data <= '~' ) {
					this.setSitePickerQuery( `${ this.sitePickerQuery }${ data }` );
					return { consume: true };
				}
				return { consume: true };
			}
			if ( matchesKey( data, 'escape' ) && this.interruptCallback ) {
				this.wasInterrupted = true;
				this.interruptCallback();
			}
			if ( matchesKey( data, 'ctrl+o' ) && this.activeExpandablePreview ) {
				this.toggleExpandablePreview();
				return { consume: true };
			}
			return undefined;
		} );
	}

	private async openSitePicker(): Promise< void > {
		const appdata = await readAppdata();
		const sites: SiteData[] = appdata.sites ?? [];

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

	private async switchToRemoteSites(): Promise< void > {
		let token: Awaited< ReturnType< typeof getAuthToken > >;
		try {
			token = await getAuthToken();
		} catch {
			this.showSitePickerError( 'Not logged in. Use /login first.' );
			return;
		}

		this.resetSitePickerTab( SITE_PICKER_TAB_REMOTE );
		this.sitePickerRemoteLoading = true;
		this.sitePickerRemoteItems = [];
		this.renderSitePicker();

		try {
			const sites = await getWpComSites( token.accessToken );
			this.sitePickerRemoteItems = sites.map( ( site ) => ( {
				name: site.name,
				path: '',
				running: false,
				remote: true,
				url: site.url,
			} ) );
			this.sitePickerRemoteLoading = false;
			this.sitePickerSelectedIndex = 0;
			this.renderSitePicker();
		} catch {
			this.showSitePickerError( 'Failed to load WordPress.com sites. Please try again.' );
		}
	}

	private showSitePickerError( message: string ): void {
		this.resetSitePickerTab( SITE_PICKER_TAB_LOCAL );
		this.sitePickerRemoteItems = [];
		this.renderSitePicker();
		this.messages.addChild( new Text( `\n${ chalk.dim( message ) }\n`, 1, 0 ) );
		this.tui.requestRender();
	}

	private resetSitePickerTab( tab: SitePickerTab ): void {
		this.sitePickerTab = tab;
		this.sitePickerSelectedIndex = 0;
		this.sitePickerQuery = '';
		this.sitePickerRemoteLoading = false;
	}

	private switchToLocalSites(): void {
		this.resetSitePickerTab( SITE_PICKER_TAB_LOCAL );
		this.renderSitePicker();
	}

	private setSitePickerQuery( query: string ): void {
		this.sitePickerQuery = query;
		this.sitePickerSelectedIndex = 0;
		this.renderSitePicker();
	}

	private getFilteredSitePickerItems(): SiteInfo[] {
		const allItems =
			this.sitePickerTab === SITE_PICKER_TAB_REMOTE
				? this.sitePickerRemoteItems
				: this.sitePickerItems;
		if ( ! this.sitePickerQuery ) {
			return allItems;
		}
		const query = this.sitePickerQuery.toLowerCase();
		return allItems.filter(
			( site ) =>
				site.name.toLowerCase().includes( query ) ||
				( site.url && site.url.toLowerCase().includes( query ) )
		);
	}

	private selectFilteredSite( site: SiteInfo ): void {
		if ( site.remote ) {
			this._activeSiteData = null;
		} else {
			const originalIndex = this.sitePickerItems.indexOf( site );
			this._activeSiteData =
				originalIndex >= 0 ? this.sitePickerSiteData[ originalIndex ] ?? null : null;
		}
		this.setActiveSite( site );
		this.closeSitePicker();
	}

	private sitePickerPageSize(): number {
		// Reserve 4 lines for header, search, scroll info, and hints; use at least 5 visible items
		return Math.max( 5, ( process.stdout.rows ?? 24 ) - 4 );
	}

	private formatSiteRow( site: SiteInfo, index: number ): string {
		const selected = index === this.sitePickerSelectedIndex;
		const prefix = selected ? `  ${ chalk.blue( '❯' ) } ` : '    ';
		if ( site.remote ) {
			const nameColumnWidth = 30;
			const prefixWidth = 4; // "  ❯ " or "    "
			const gap = 2;
			const termWidth = process.stdout.columns ?? 80;
			const urlColumnWidth = termWidth - prefixWidth - nameColumnWidth - gap;
			const truncatedName =
				site.name.length > nameColumnWidth
					? site.name.slice( 0, nameColumnWidth - 1 ) + '…'
					: site.name.padEnd( nameColumnWidth );
			const name = selected ? chalk.bold( truncatedName ) : truncatedName;
			const displayUrl = site.url ? site.url.replace( /^https?:\/\//, '' ) : '';
			let url = '';
			if ( displayUrl && urlColumnWidth > 3 ) {
				const truncatedUrl =
					displayUrl.length > urlColumnWidth
						? displayUrl.slice( 0, urlColumnWidth - 1 ) + '…'
						: displayUrl;
				url = `  ${ chalk.dim( truncatedUrl ) }`;
			}
			return `${ prefix }${ name }${ url }`;
		}
		const name = selected ? chalk.bold( site.name ) : site.name;
		const status = site.running ? `${ chalk.green( '●' ) } ` : '  ';
		return `${ prefix }${ status }${ name }`;
	}

	// Returns the visible rows and scroll info for the current picker tab.
	// Three modes: local list, remote loading, remote list.
	private getSitePickerRows(): { items: string[]; scrollInfo: string } {
		if ( ! ( this.sitePickerTab === SITE_PICKER_TAB_LOCAL ) && this.sitePickerRemoteLoading ) {
			return { items: [ chalk.dim( '  Loading WordPress.com sites…' ) ], scrollInfo: '' };
		}
		const filtered = this.getFilteredSitePickerItems();
		if ( filtered.length === 0 ) {
			const emptyMessage =
				this.sitePickerTab === SITE_PICKER_TAB_REMOTE && ! this.sitePickerQuery
					? '  No WordPress.com sites found.'
					: '  No matching sites.';
			return { items: [ chalk.dim( emptyMessage ) ], scrollInfo: '' };
		}
		const { start, end } = this.getVisibleWindow( filtered.length );
		const items = filtered
			.slice( start, end )
			.map( ( site, vi ) => this.formatSiteRow( site, start + vi ) );
		const scrollInfo = this.getScrollInfo( filtered.length, start, end );
		return { items, scrollInfo };
	}

	// Container doesn't expose a public clearChildren API, so we reach into
	// the internal children array and remove items one at a time.
	private clearContainer( container: Container ): void {
		while ( ( container as Container & { children?: unknown[] } ).children?.length ) {
			container.removeChild( ( container as Container & { children: Component[] } ).children[ 0 ] );
		}
	}

	private renderSitePicker(): void {
		if ( ! this.sitePickerContainer ) {
			return;
		}
		this.clearContainer( this.sitePickerContainer );

		const isLocal = this.sitePickerTab === SITE_PICKER_TAB_LOCAL;
		const localTab = isLocal ? chalk.bold( '[Local]' ) : chalk.dim( 'Local' );
		const remoteTab = isLocal ? chalk.dim( 'WordPress.com' ) : chalk.bold( '[WordPress.com]' );
		const header = `  ${ localTab }  ${ remoteTab }`;

		const { items, scrollInfo } = this.getSitePickerRows();

		const searchLine = this.sitePickerQuery
			? `  ${ chalk.dim( 'Search:' ) } ${ this.sitePickerQuery }`
			: '';

		const hints = isLocal
			? '  ↑↓ navigate · → remote sites · enter select · tab open in browser · esc cancel'
			: '  ↑↓ navigate · ← local sites · enter select · tab open in browser · esc cancel';

		const lines = [ header ];
		if ( searchLine ) {
			lines.push( searchLine );
		}
		lines.push( ...items );
		if ( scrollInfo ) {
			lines.push( chalk.dim( `  ${ scrollInfo }` ) );
		}
		lines.push( '' );
		lines.push( chalk.dim( hints ) );

		const text = lines.join( '\n' );
		this.sitePickerContainer.addChild( new Text( text, 0, 0 ) );
		this.tui.requestRender();
	}

	private getVisibleWindow( totalItems: number ): { start: number; end: number } {
		const pageSize = this.sitePickerPageSize();
		if ( totalItems <= pageSize ) {
			return { start: 0, end: totalItems };
		}
		// Keep the selected item visible with some padding from the edges
		let start = this.sitePickerSelectedIndex - Math.floor( pageSize / 2 );
		start = Math.max( 0, Math.min( start, totalItems - pageSize ) );
		return { start, end: start + pageSize };
	}

	private getScrollInfo( totalItems: number, start: number, end: number ): string {
		const pageSize = this.sitePickerPageSize();
		if ( totalItems <= pageSize ) {
			return '';
		}
		const parts: string[] = [];
		if ( start > 0 ) {
			parts.push( `↑ ${ start } more` );
		}
		if ( end < totalItems ) {
			parts.push( `↓ ${ totalItems - end } more` );
		}
		return parts.join( '  ' );
	}

	private setActiveSite( site: SiteInfo ): void {
		this._activeSite = site;
		this.editor.activeSiteName = site.name;
		const suffix = site.remote ? ' (WordPress.com)' : '';
		const label = ` ✻ Selected site: ${ site.name }${ suffix }`;
		this.messages.addChild( new Text( `${ chalk.hex( '#5b8db8' )( label ) }\n`, 0, 0 ) );
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
		if ( ! a ) {
			return false;
		}
		// Remote sites have no stable path, so never match them against local sites
		if ( a.remote !== b.remote ) {
			return false;
		}
		return a.path === b.path || a.name.toLowerCase() === b.name.toLowerCase();
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
		const filtered = this.getFilteredSitePickerItems();
		const site = filtered[ this.sitePickerSelectedIndex ];
		if ( ! site ) {
			return;
		}
		if ( site.remote && site.url ) {
			await openBrowser( site.url );
			return;
		}
		if ( ! site.running ) {
			return;
		}
		const originalIndex = this.sitePickerItems.indexOf( site );
		const siteData = originalIndex >= 0 ? this.sitePickerSiteData[ originalIndex ] : undefined;
		if ( ! siteData ) {
			return;
		}
		const url = getSiteUrl( siteData );
		if ( url ) {
			await openBrowser( url );
		}
	}

	async openActiveSiteInBrowser(): Promise< boolean > {
		if ( this._activeSite?.remote && this._activeSite?.url ) {
			await openBrowser( this._activeSite.url );
			return true;
		}
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
		this.sitePickerRemoteItems = [];
		this.resetSitePickerTab( SITE_PICKER_TAB_LOCAL );
		this.updateHints();
		this.tui.requestRender();
	}

	private renderOptionPicker(): void {
		if ( ! this.optionPickerContainer ) {
			return;
		}
		this.clearContainer( this.optionPickerContainer );

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
			chalk.dim(
				`${ AI_MODELS[ this.currentModel ] } · ${
					AI_PROVIDERS[ this.currentProvider ]
				} · ${ displayCwd }`
			),
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
					return ' ' + chalk.bgHex( '#ddeeff' ).black( '❯ ' + line + ' ' );
				}
				return ' ' + chalk.bgHex( '#ddeeff' ).black( '   ' + line + ' ' );
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
		if ( this.activeExpandablePreview ) {
			hints.push( this.activeExpandablePreview.isExpanded ? 'ctrl+o collapse' : 'ctrl+o expand' );
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
		this.wasInterrupted = false;
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

	setStatusMessage( message: string | null ): void {
		this.editor.statusMessage = message;
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

		this.addExpandablePreview( preview );
	}

	private addExpandablePreview( preview: { collapsed: string; expanded: string } ): void {
		const textComponent = new Text( preview.collapsed, 0, 0 );
		this.messages.addChild( textComponent );

		if ( preview.collapsed !== preview.expanded ) {
			this.activeExpandablePreview = {
				textComponent,
				collapsedContent: preview.collapsed,
				expandedContent: preview.expanded,
				isExpanded: false,
			};
			this.updateHints();
		}

		this.tui.requestRender();
	}

	private generateExpandablePreview( lines: string[] ): { collapsed: string; expanded: string } {
		const expanded = formatToolOutputLines( lines );

		if ( lines.length <= DEFAULT_COLLAPSE_THRESHOLD_LINES ) {
			return { collapsed: expanded, expanded };
		}

		const collapsed =
			formatToolOutputLines( lines.slice( 0, DEFAULT_COLLAPSE_THRESHOLD_LINES ) ) +
			'\n     ' +
			chalk.dim(
				'... ' +
					( lines.length - DEFAULT_COLLAPSE_THRESHOLD_LINES ) +
					' more lines · ctrl+o to expand'
			);

		return { collapsed, expanded };
	}

	private generateWritePreview( content: string ): { collapsed: string; expanded: string } {
		const lines = content.split( '\n' );
		const totalLines = lines.length;
		const numWidth = String( totalLines ).length;

		return this.generateExpandablePreview(
			lines.map( ( line, i ) => {
				const lineNum = chalk.dim( String( i + 1 ).padStart( numWidth ) );
				return lineNum + ' ' + chalk.green( line );
			} )
		);
	}

	private generateEditPreview(
		oldStr: string,
		newStr: string
	): { collapsed: string; expanded: string } {
		const oldLines = oldStr.split( '\n' );
		const newLines = newStr.split( '\n' );

		const diffLines: string[] = [];
		for ( const line of oldLines ) {
			diffLines.push( chalk.red( '- ' + line ) );
		}
		for ( const line of newLines ) {
			diffLines.push( chalk.green( '+ ' + line ) );
		}

		return this.generateExpandablePreview( diffLines );
	}

	private toggleExpandablePreview(): void {
		const preview = this.activeExpandablePreview;
		if ( ! preview ) {
			return;
		}

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
		const toolUseResult = normalizeToolUseResult( message.tool_use_result );
		if (
			toolUseResult &&
			( toolUseResult.content !== undefined || toolUseResult.isError === true )
		) {
			return toolUseResult;
		}

		const contentBlocks = Array.isArray( message.message.content ) ? message.message.content : [];
		const toolResultBlock = contentBlocks.find( isToolResultBlock );
		if ( ! toolResultBlock ) {
			return null;
		}

		return {
			content: normalizeToolResultContent( toolResultBlock.content ),
			isError: toolResultBlock.is_error === true,
		};
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
		const formatted = lines.map( ( line ) => ( line.dim ? chalk.dim( line.text ) : line.text ) );
		const rendered = formatToolOutputLines( formatted );
		this.messages.addChild( new Text( rendered, 0, 0 ) );
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
		this.addExpandablePreview(
			this.generateExpandablePreview( resultLines.map( ( line ) => chalk.dim( line ) ) )
		);
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
				// Close the current markdown block so the next assistant text
				// creates a fresh visual block (mirrors askUser / endAgentTurn).
				this.currentMarkdown = null;
				this.currentResponseText = '';
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

				// User-initiated interruption: show friendly message instead of error
				if ( this.wasInterrupted ) {
					const thinkingSec = Math.round( ( Date.now() - this.turnStartTime ) / 1000 );
					this.messages.addChild(
						new Text( '\n ' + chalk.yellow( '⏺' ) + ' ' + chalk.yellow( 'Interrupted' ), 0, 0 )
					);
					this.showInfo( `Ran for ${ thinkingSec }s before interruption` );
					return { sessionId: message.session_id, success: false };
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
