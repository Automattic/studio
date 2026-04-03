import {
	TUI,
	ProcessTerminal,
	Editor,
	Input,
	SelectList,
	type SelectItem,
	type SelectListTheme,
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
	visibleWidth,
	truncateToWidth,
	CURSOR_MARKER,
} from '@mariozechner/pi-tui';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { __, _n, sprintf } from '@wordpress/i18n';
import chalk from 'chalk';
import { AI_MODELS, DEFAULT_MODEL, type AiModelId, type AskUserQuestion } from 'cli/ai/agent';
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER, type AiProviderId } from 'cli/ai/providers';
import { AI_CHAT_SLASH_COMMANDS } from 'cli/ai/slash-commands';
import { buildTodoUpdateLines, type TodoRenderLine } from 'cli/ai/todo-render';
import { diffTodoSnapshot, type TodoDiff, type TodoEntry } from 'cli/ai/todo-stream';
import { getWpComSites } from 'cli/lib/api';
import { openBrowser } from 'cli/lib/browser';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { isSiteRunning } from 'cli/lib/site-utils';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TodoWriteInput } from '@anthropic-ai/claude-agent-sdk/sdk-tools';

const SITE_PICKER_TAB_LOCAL = 'local' as const;
const SITE_PICKER_TAB_REMOTE = 'remote' as const;
type SitePickerTab = typeof SITE_PICKER_TAB_LOCAL | typeof SITE_PICKER_TAB_REMOTE;

const sitePickerTheme: SelectListTheme = {
	selectedPrefix: ( text ) => chalk.blue( text ),
	selectedText: ( text ) => chalk.bold( text ),
	description: ( text ) => chalk.dim( text ),
	scrollInfo: ( text ) => chalk.dim( text ),
	noMatch: ( text ) => chalk.dim( text ),
};

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
	statusMessage: string | null = null;
	showBottomBar = true;

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
		const promptPrefix = ' ' + chalk.bold( '〉' );
		const promptWidth = 3; // space + 〉(2 cols)
		const innerWidth = Math.max( 1, width - promptWidth );
		const lines = this.editor.render( innerWidth );
		const bc = this.borderColorFn;
		const borderWidth = Math.max( 0, width - 2 );

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

		const autocompleteLines = lines.slice( bottomBorderIndex + 1 );
		const editorLines = lines.slice( 0, bottomBorderIndex + 1 );
		const emptyPrefix = ' '.repeat( promptWidth );
		const result = editorLines.map( ( line, i ) => {
			if ( i === 0 ) {
				// Top border with active site name on the right
				if ( this.activeSiteName && borderWidth > 4 ) {
					const label = ` ${ this.activeSiteName } `;
					const trailing = Math.min( 3, borderWidth );
					const leading = Math.max( 0, borderWidth - label.length - trailing );
					return (
						' ' +
						bc( '─'.repeat( leading ) ) +
						chalk.hex( '#8839ef' )( label ) +
						bc( '─'.repeat( trailing ) )
					);
				}
				return ' ' + bc( '─'.repeat( borderWidth ) );
			}
			if ( i === bottomBorderIndex ) {
				return ' ' + bc( '─'.repeat( borderWidth ) );
			}
			if ( this.isEmpty && i === 1 ) {
				return promptPrefix + CURSOR_MARKER;
			}
			if ( i === 1 ) {
				return promptPrefix + line;
			}
			return emptyPrefix + line;
		} );

		if ( autocompleteLines.length > 0 ) {
			return [ ...result, ...autocompleteLines.map( ( line ) => ' ' + line ) ].map( ( line ) =>
				truncateToWidth( line, width )
			);
		}

		// Below the bottom border: show hint bar (with optional status on the right)
		if ( ! this.showBottomBar ) {
			return result.map( ( line ) => truncateToWidth( line, width ) );
		}
		const activeHints = this.isEmpty
			? this.hints
			: this.hints.filter( ( h ) => h !== __( '↓ select site' ) );
		const leftPart =
			activeHints.length > 0
				? ' ' + activeHints.map( ( h ) => chalk.dim( h ) ).join( chalk.dim( ' · ' ) )
				: '';
		const rightPart = this.statusMessage ? chalk.dim( this.statusMessage ) + ' ' : '';
		if ( leftPart || rightPart ) {
			const leftLen = visibleWidth( leftPart );
			const rightLen = visibleWidth( rightPart );
			const padding = Math.max( 1, width - leftLen - rightLen );
			result.push( leftPart + ' '.repeat( padding ) + rightPart );
		}

		return result.map( ( line ) => truncateToWidth( line, width ) );
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
	mcp__studio__site_create: __( 'Create site' ),
	mcp__studio__site_list: __( 'List sites' ),
	mcp__studio__site_info: __( 'Get site info' ),
	mcp__studio__site_start: __( 'Start site' ),
	mcp__studio__site_stop: __( 'Stop site' ),
	mcp__studio__site_delete: __( 'Delete site' ),
	mcp__studio__preview_create: __( 'Create preview' ),
	mcp__studio__preview_list: __( 'List previews' ),
	mcp__studio__preview_update: __( 'Update preview' ),
	mcp__studio__preview_delete: __( 'Delete preview' ),
	mcp__studio__wp_cli: __( 'Run WP-CLI' ),
	mcp__studio__validate_blocks: __( 'Validate blocks' ),
	mcp__studio__take_screenshot: __( 'Take screenshot' ),
	Read: __( 'Read' ),
	Write: __( 'Write' ),
	Edit: __( 'Edit' ),
	Bash: __( 'Run' ),
	Glob: __( 'Search' ),
	Grep: __( 'Search' ),
	Skill: __( 'Load skill' ),
	Task: __( 'Run task' ),
	TodoWrite: __( 'Update todo list' ),
};

function getToolDetail( name: string, input: Record< string, unknown > ): string {
	switch ( name ) {
		case 'mcp__studio__site_create':
			return typeof input.name === 'string' ? input.name : '';
		case 'mcp__studio__site_info':
		case 'mcp__studio__site_start':
		case 'mcp__studio__site_stop':
		case 'mcp__studio__site_delete':
		case 'mcp__studio__preview_create':
		case 'mcp__studio__preview_list':
			return typeof input.nameOrPath === 'string' ? input.nameOrPath : '';
		case 'mcp__studio__preview_update':
		case 'mcp__studio__preview_delete':
			return typeof input.host === 'string' ? input.host : '';
		case 'mcp__studio__wp_cli':
			return typeof input.command === 'string' ? `wp ${ input.command }` : '';
		case 'mcp__studio__validate_blocks':
			if ( typeof input.filePath === 'string' ) {
				return input.filePath.split( '/' ).slice( -2 ).join( '/' );
			}
			return __( 'inline content' );
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
	private siteSelectedCallback: ( ( site: SiteInfo ) => void ) | null = null;
	private replayMode = false;
	private replayTimestampMs: number | null = null;
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
	private optionPickerContainer: Container | null = null;
	private optionPickerSelectList: SelectList | null = null;
	private optionPickerVisible = false;
	private optionPickerResolve: ( ( label: string ) => void ) | null = null;
	private optionPickerOtherActive = false;
	private optionPickerHasFreeForm = false;
	private optionPickerItemCount = 0;
	private optionPickerInput: Input | null = null;
	private static readonly OTHER_VALUE = '__other__';
	private static readonly OPTION_PICKER_THEME: SelectListTheme = {
		selectedPrefix: ( text: string ) => chalk.blue( text ),
		selectedText: ( text: string ) => chalk.blue( text ),
		description: ( text: string ) => chalk.dim( text ),
		scrollInfo: ( text: string ) => chalk.dim( text ),
		noMatch: ( text: string ) => chalk.dim( text ),
	};
	private sitePickerVisible = false;
	private sitePickerContainer: Container | null = null;
	private sitePickerItems: SiteInfo[] = [];
	private sitePickerSiteData: SiteData[] = [];
	private sitePickerSelectList: SelectList | null = null;
	private sitePickerItemMap: Map< string, SiteInfo > = new Map();
	private sitePickerTab: SitePickerTab = SITE_PICKER_TAB_LOCAL;
	private sitePickerRemoteItems: SiteInfo[] = [];
	private sitePickerRemoteLoading = false;
	private sitePickerQuery = '';

	get activeSite(): SiteInfo | null {
		return this._activeSite;
	}

	private refreshPromptChrome(): void {
		this.editor.invalidate();
	}

	set onSiteSelected( fn: ( ( site: SiteInfo ) => void ) | null ) {
		this.siteSelectedCallback = fn;
	}

	private nowMs(): number {
		return this.replayTimestampMs ?? Date.now();
	}

	setReplayTimestamp( timestamp?: string ): void {
		if ( ! this.replayMode ) {
			return;
		}

		if ( ! timestamp ) {
			this.replayTimestampMs = null;
			return;
		}

		const parsedTimestamp = Date.parse( timestamp );
		this.replayTimestampMs = Number.isNaN( parsedTimestamp ) ? null : parsedTimestamp;
	}

	prepareForReplay(): void {
		this.replayMode = true;
		this.replayTimestampMs = null;
		this.hideLoader();
		this.currentMarkdown = null;
		this.currentResponseText = '';
	}

	finishReplay(): void {
		this.replayMode = false;
		this.replayTimestampMs = null;
		this.hideLoader();
		this.currentMarkdown = null;
		this.currentResponseText = '';
	}

	showAgentQuestion(
		question: string,
		_options: Array< { label: string; description: string } >
	): void {
		this.hideLoader();
		this.currentMarkdown = null;
		this.currentResponseText = '';
		this.messages.addChild( new Text( '\n' + chalk.bold( question ), 0, 0 ) );
		this.tui.requestRender();
	}

	constructor() {
		const terminal = new ProcessTerminal();
		this.tui = new TUI( terminal, true );

		this.messages = new Container();
		this.tui.addChild( this.messages );

		this.loader = new Loader(
			this.tui,
			( str ) => chalk.yellow( str ),
			( str ) => chalk.yellow( str ),
			__( 'Thinking…' )
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
			if ( this.optionPickerSelectList ) {
				// When "Other" is active, let the inline input handle most keys
				if ( this.optionPickerOtherActive && this.optionPickerInput ) {
					if ( matchesKey( data, 'up' ) ) {
						this.deactivateOptionPickerOther();
						this.optionPickerSelectList.handleInput( data );
						this.renderOptionPicker();
						return { consume: true };
					}
					// Forward everything else to the inline input
					this.optionPickerInput.handleInput( data );
					this.renderOptionPicker();
					return { consume: true };
				}

				// If user starts typing while on a regular option, jump to "Other" (only if free-form is enabled)
				if (
					this.optionPickerHasFreeForm &&
					! matchesKey( data, 'up' ) &&
					! matchesKey( data, 'down' ) &&
					! matchesKey( data, 'enter' ) &&
					! matchesKey( data, 'escape' ) &&
					data.length === 1 &&
					data >= ' '
				) {
					this.optionPickerSelectList.setSelectedIndex( this.optionPickerItemCount - 1 );
					this.activateOptionPickerOther();
					this.optionPickerInput?.handleInput( data );
					this.renderOptionPicker();
					return { consume: true };
				}

				// Let SelectList handle up/down/enter/escape
				this.optionPickerSelectList.handleInput( data );
				// onSelect may have closed the picker — bail if so
				if ( ! this.optionPickerSelectList ) {
					return { consume: true };
				}
				// Check if we landed on "Other" after navigation
				if ( this.optionPickerHasFreeForm ) {
					const selected = this.optionPickerSelectList.getSelectedItem();
					if ( selected?.value === AiChatUI.OTHER_VALUE ) {
						this.activateOptionPickerOther();
					}
				}
				this.renderOptionPicker();
				return { consume: true };
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
			if ( this.sitePickerVisible && this.sitePickerSelectList ) {
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
				// Forward remaining input (up/down/enter) to SelectList
				this.sitePickerSelectList.handleInput( data );
				this.renderSitePicker();
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
		const config = await readCliConfig();
		const sites: SiteData[] = config.sites ?? [];
		if ( sites.length === 0 ) {
			this.messages.addChild(
				new Text( chalk.dim( '  ' + __( 'No sites found. Create one first.' ) ), 1, 0 )
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
		this.sitePickerVisible = true;
		this.editor.showBottomBar = false;
		this.sitePickerContainer = new Container();
		this.tui.addChild( this.sitePickerContainer );
		this.rebuildSitePickerList();
		this.renderSitePicker();
	}

	private async switchToRemoteSites(): Promise< void > {
		this.resetSitePickerTab( SITE_PICKER_TAB_REMOTE );
		this.sitePickerRemoteLoading = true;
		this.sitePickerRemoteItems = [];
		this.renderSitePicker();

		const token = await readAuthToken();
		if ( ! token ) {
			this.showSitePickerError( __( 'Not logged in. Use /login first.' ) );
			return;
		}

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
			this.rebuildSitePickerList();
			this.renderSitePicker();
		} catch {
			this.showSitePickerError( __( 'Failed to load WordPress.com sites. Please try again.' ) );
		}
	}

	private showSitePickerError( message: string ): void {
		this.resetSitePickerTab( SITE_PICKER_TAB_LOCAL );
		this.sitePickerRemoteItems = [];
		this.rebuildSitePickerList();
		this.renderSitePicker();
		this.messages.addChild( new Text( `\n${ chalk.dim( message ) }\n`, 1, 0 ) );
		this.tui.requestRender();
	}

	private resetSitePickerTab( tab: SitePickerTab ): void {
		this.sitePickerTab = tab;
		this.sitePickerQuery = '';
		this.sitePickerRemoteLoading = false;
	}

	private switchToLocalSites(): void {
		this.resetSitePickerTab( SITE_PICKER_TAB_LOCAL );
		this.rebuildSitePickerList();
		this.renderSitePicker();
	}

	private setSitePickerQuery( query: string ): void {
		this.sitePickerQuery = query;
		this.rebuildSitePickerList();
		this.renderSitePicker();
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

	private siteInfoToSelectItem( site: SiteInfo ): SelectItem {
		if ( site.remote ) {
			return {
				value: site.url ?? site.name,
				label: site.name,
				description: site.url?.replace( /^https?:\/\//, '' ),
			};
		}
		const status = site.running ? `${ chalk.green( '●' ) } ` : '  ';
		return {
			value: site.path,
			label: `${ status }${ site.name }`,
		};
	}

	private rebuildSitePickerList(): void {
		const allItems =
			this.sitePickerTab === SITE_PICKER_TAB_REMOTE
				? this.sitePickerRemoteItems
				: this.sitePickerItems;
		const filtered = this.sitePickerQuery
			? allItems.filter( ( site ) => {
					const query = this.sitePickerQuery.toLowerCase();
					return (
						site.name.toLowerCase().includes( query ) ||
						( site.url && site.url.toLowerCase().includes( query ) )
					);
			  } )
			: allItems;
		const selectItems = filtered.map( ( site ) => this.siteInfoToSelectItem( site ) );
		this.sitePickerItemMap = new Map(
			filtered.map( ( site, i ) => [ selectItems[ i ].value, site ] )
		);
		const maxVisible = Math.max( 5, ( process.stdout.rows ?? 24 ) - 4 );
		this.sitePickerSelectList = new SelectList( selectItems, maxVisible, sitePickerTheme );
		this.sitePickerSelectList.onSelect = ( item ) => {
			const site = this.sitePickerItemMap.get( item.value );
			if ( site ) {
				this.selectFilteredSite( site );
			}
		};
		this.sitePickerSelectList.onCancel = () => {
			this.closeSitePicker();
		};
	}

	private renderSitePicker(): void {
		if ( ! this.sitePickerContainer ) {
			return;
		}
		this.sitePickerContainer.clear();

		const isLocal = this.sitePickerTab === SITE_PICKER_TAB_LOCAL;
		const localTab = isLocal ? chalk.bold( __( '[Local]' ) ) : chalk.dim( __( 'Local' ) );
		const remoteTab = isLocal ? chalk.dim( 'WordPress.com' ) : chalk.bold( '[WordPress.com]' );
		const pad = ' ';
		const header = `${ pad }${ localTab }  ${ remoteTab }`;

		const searchLine = this.sitePickerQuery
			? `${ pad }${ chalk.dim( __( 'Search:' ) ) } ${ this.sitePickerQuery }`
			: '';

		const hints = isLocal
			? `${ pad }${ __(
					'↑↓ navigate · → remote sites · enter select · tab open in browser · esc cancel'
			  ) }`
			: `${ pad }${ __(
					'↑↓ navigate · ← local sites · enter select · tab open in browser · esc cancel'
			  ) }`;

		const lines = [ header, '' ];
		if ( searchLine ) {
			lines.push( searchLine, '' );
		}

		if ( ! isLocal && this.sitePickerRemoteLoading ) {
			lines.push( chalk.dim( `${ pad }  ${ __( 'Loading WordPress.com sites…' ) }` ) );
		} else if ( this.sitePickerSelectList ) {
			const termWidth = process.stdout.columns ?? 80;
			lines.push(
				...this.sitePickerSelectList.render( termWidth - pad.length ).map( ( line ) => pad + line )
			);
		}

		lines.push( '' );
		lines.push( chalk.dim( hints ) );

		const text = lines.join( '\n' );
		this.sitePickerContainer.addChild( new Text( text, 0, 0 ) );
		this.tui.requestRender();
	}

	setActiveSite( site: SiteInfo, options: { announce?: boolean; emitEvent?: boolean } = {} ): void {
		const { announce = true, emitEvent = true } = options;
		this._activeSite = site;
		this.editor.activeSiteName = site.name;
		this.refreshPromptChrome();
		const label = site.remote
			? sprintf(
					/* translators: %s: site name */
					__( ' ✻ Selected site: %s (WordPress.com)' ),
					site.name
			  )
			: sprintf(
					/* translators: %s: site name */
					__( ' ✻ Selected site: %s' ),
					site.name
			  );
		if ( announce ) {
			this.messages.addChild( new Text( `${ chalk.hex( '#5b8db8' )( label ) }\n`, 0, 0 ) );
		}
		if ( emitEvent ) {
			this.siteSelectedCallback?.( site );
		}
		this.tui.requestRender();
	}

	private clearActiveSite(): void {
		this._activeSite = null;
		this._activeSiteData = null;
		this.editor.activeSiteName = null;
		this.refreshPromptChrome();
		this.messages.addChild( new Text( chalk.dim( __( ' ✻ Site deselected' ) ) + '\n', 0, 0 ) );
		this.tui.requestRender();
	}

	private async findSiteFromAppdata( nameOrPath: string ): Promise< SiteInfo | null > {
		const config = await readCliConfig();
		const site = config.sites.find(
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

	private async selectLocalSiteFromTool(
		nameOrPath: string,
		options: { running?: boolean } = {}
	): Promise< void > {
		const site = await this.findSiteFromAppdata( nameOrPath );
		if ( ! site ) {
			return;
		}

		if ( typeof options.running === 'boolean' ) {
			site.running = options.running;
		}

		if ( this.isSameSite( this._activeSite, site ) ) {
			this._activeSite = site;
			this.editor.activeSiteName = site.name;
			this.refreshPromptChrome();
			this.tui.requestRender();
			return;
		}

		this.setActiveSite( site );
	}

	private async autoSelectSiteFromToolResult(
		toolName: string,
		toolInput: Record< string, unknown > | null
	): Promise< void > {
		switch ( toolName ) {
			case 'mcp__studio__site_create': {
				const name = toolInput?.name;
				if ( typeof name === 'string' ) {
					await this.selectLocalSiteFromTool( name, { running: true } );
				}
				break;
			}
			case 'mcp__studio__site_info':
			case 'mcp__studio__site_start': {
				const nameOrPath = toolInput?.nameOrPath;
				if ( typeof nameOrPath === 'string' ) {
					await this.selectLocalSiteFromTool( nameOrPath, {
						running: toolName === 'mcp__studio__site_start' ? true : undefined,
					} );
				}
				break;
			}
			case 'mcp__studio__wp_cli':
			case 'mcp__studio__preview_create':
			case 'mcp__studio__preview_list':
			case 'mcp__studio__preview_update':
			case 'mcp__studio__validate_blocks': {
				const nameOrPath = toolInput?.nameOrPath;
				if ( typeof nameOrPath === 'string' ) {
					await this.selectLocalSiteFromTool( nameOrPath );
				}
				break;
			}
			case 'mcp__studio__site_stop': {
				const nameOrPath = toolInput?.nameOrPath;
				if ( typeof nameOrPath === 'string' ) {
					await this.selectLocalSiteFromTool( nameOrPath, { running: false } );
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
		const selectedItem = this.sitePickerSelectList?.getSelectedItem();
		const site = selectedItem ? this.sitePickerItemMap.get( selectedItem.value ) : undefined;
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
		if ( ! this._activeSite && ! this._activeSiteData ) {
			return false;
		}
		// Re-read appdata to get the current site state (port/domain may have changed)
		const config = await readCliConfig();
		const activeSiteName = this._activeSite?.name ?? this._activeSiteData?.name;
		const freshSiteData = config.sites?.find( ( site ) => site.name === activeSiteName );
		const siteData = freshSiteData ?? this._activeSiteData;
		if ( siteData ) {
			this._activeSiteData = siteData;
		}
		if ( ! siteData ) {
			return false;
		}

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
		this.sitePickerSelectList = null;
		this.sitePickerItemMap = new Map();
		this.resetSitePickerTab( SITE_PICKER_TAB_LOCAL );
		this.editor.showBottomBar = true;
		this.updateHints();
		this.tui.requestRender();
	}

	private renderOptionPicker(): void {
		if ( ! this.optionPickerContainer || ! this.optionPickerSelectList ) {
			return;
		}
		this.optionPickerContainer.clear();

		const width = ( process.stdout.columns ?? 80 ) - 1;
		const lines = this.optionPickerSelectList.render( width );

		// When "Other" is active, replace the last line with the inline input
		if ( this.optionPickerOtherActive && this.optionPickerInput && lines.length > 0 ) {
			const inputText = this.optionPickerInput.getValue();
			const cursor = chalk.inverse( ' ' );
			const display = inputText
				? chalk.blue( inputText ) + cursor
				: chalk.dim( __( 'Type your answer…' ) ) + cursor;
			lines[ lines.length - 1 ] = `${ chalk.blue( '→' ) } ${ display }`;
		}

		this.optionPickerContainer.addChild( new Text( lines.join( '\n' ), 1, 0 ) );
		this.tui.requestRender();
	}

	private activateOptionPickerOther(): void {
		if ( this.optionPickerOtherActive ) {
			return;
		}
		this.optionPickerOtherActive = true;
		this.optionPickerInput = new Input();
		this.optionPickerInput.onSubmit = ( value: string ) => {
			const trimmed = value.trim();
			if ( trimmed && this.optionPickerResolve ) {
				const resolve = this.optionPickerResolve;
				this.optionPickerResolve = null;
				this.closeOptionPicker();
				resolve( trimmed );
			}
		};
	}

	private deactivateOptionPickerOther(): void {
		this.optionPickerOtherActive = false;
		this.optionPickerInput = null;
	}

	private closeOptionPicker(): void {
		if ( this.optionPickerContainer ) {
			this.tui.removeChild( this.optionPickerContainer );
			this.optionPickerContainer = null;
		}
		this.optionPickerVisible = false;
		this.optionPickerSelectList = null;
		this.optionPickerHasFreeForm = false;
		this.optionPickerItemCount = 0;
		this.deactivateOptionPickerOther();
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
			chalk.dim.italic( __( 'Code is Poetry' ) ),
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
					return ' ' + chalk.bgHex( '#ddeeff' ).black( '〉' + line + ' ' );
				}
				return ' ' + chalk.bgHex( '#ddeeff' ).black( '  ' + line + ' ' );
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
		const hints: string[] = [];
		if ( ! this._inAgentTurn ) {
			hints.push( __( '↓ select site' ) );
		}
		if ( this.activeExpandablePreview ) {
			hints.push(
				this.activeExpandablePreview.isExpanded ? __( 'ctrl+o collapse' ) : __( 'ctrl+o expand' )
			);
		}
		hints.push( __( 'esc to interrupt' ) );
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
		this.turnStartTime = this.nowMs();
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

	showOnboarding(): void {
		const b = chalk.bold;

		const lines = [
			' ' +
				chalk.blue( '⏺' ) +
				__( " Hello, I'm " ) +
				b( __( 'WordPress Studio' ) ) +
				__( ', your local WordPress agent and builder.' ),
			'',
			' ' +
				__( 'To get started, run ' ) +
				b( '/login' ) +
				__( ' to connect your WordPress.com account.' ),
			' ' +
				__( 'If you want to use your own Anthropic API key you can run ' ) +
				b( '/api-key' ) +
				__( '.' ),
		];

		this.messages.addChild( new Text( '\n' + lines.join( '\n' ) + '\n', 0, 0 ) );
		this.tui.requestRender();
	}

	showCapabilities(): void {
		const b = chalk.bold;
		const d = chalk.dim;
		const separator = d( ' ─'.padEnd( 80, '─' ) );

		const lines = [
			' ' +
				chalk.blue( '⏺' ) +
				__( " Great, you're connected now! Let me tell you what I can do:" ),
			'',
			'  ' + b( __( 'Site Management' ) ),
			'',
			'  - ' +
				b( __( 'Create' ) ) +
				__( ' new WordPress sites instantly (fully configured, ready to use)' ),
			'  - ' + b( __( 'Start / stop' ) ) + __( ' existing sites' ),
			'  - ' + b( __( 'List' ) ) + __( ' all your local sites and their status' ),
			'',
			'  ' + b( __( 'Design & Development' ) ),
			'',
			'  - ' + b( __( 'Build' ) ) + __( ' block themes with striking, memorable designs' ),
			'  - ' +
				__( 'Write custom ' ) +
				b( __( 'CSS, PHP, and JavaScript' ) ) +
				__( ' for themes and plugins' ),
			'  - ' +
				__( 'Create ' ) +
				b( __( 'pages and posts' ) ) +
				__( ' with valid Gutenberg block content' ),
			'  - ' + __( 'Install and activate ' ) + b( __( 'plugins' ) ) + __( ' via WP-CLI' ),
			'',
			'  ' + b( __( 'Content' ) ),
			'',
			'  - ' +
				__( 'Generate and import ' ) +
				b( __( 'page content' ) ) +
				__( ' using core blocks' ),
			'  - ' +
				__( 'Set up ' ) +
				b( __( 'navigation menus, site options, post types, taxonomies, and settings' ) ),
			'  - ' + __( "Create realistic placeholder content tailored to your site's purpose" ),
			'  - ' +
				__( 'Upload ' ) +
				b( __( 'images and videos' ) ) +
				__( ' to your site, using local media files or remote URLs' ),
			'',
			'  ' + b( __( 'Preview & Publishing' ) ),
			'',
			'  - ' +
				__( 'Take ' ) +
				b( __( 'screenshots' ) ) +
				__( ' (desktop + mobile) to verify the design is well crafted' ),
			'  - ' + b( __( 'Validate' ) ) + __( " all block content to ensure it's editor-compatible" ),
			'  - ' + b( __( 'Push' ) ) + __( ' your local site to the cloud in WordPress.com' ),
			'',
			separator,
			'',
			__( '  Just tell me what you want to build — for example:' ),
			'',
			'  ' + d( chalk.italic( __( '"Create a portfolio site for a photographer"' ) ) ),
			'  ' + d( chalk.italic( __( '"Build a landing page for a SaaS product"' ) ) ),
			'  ' + d( chalk.italic( __( '"Make a blog for a coffee shop"' ) ) ),
			'',
			'  ' +
				__(
					"I'll ask a few quick questions about the name and layout, then build the whole thing for"
				),
			'  ' +
				__( 'you. The more precise you are about what you want, the better the result will be.' ),
		];
		this.messages.addChild( new Text( '\n' + lines.join( '\n' ) + '\n', 0, 0 ) );
		this.tui.requestRender();
	}

	showSuccess( message: string ): void {
		this.messages.addChild( new Text( '\n ' + chalk.green( '⏺' ) + ' ' + message + '\n', 0, 0 ) );
		this.tui.requestRender();
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
				sprintf(
					/* translators: %d: number of hidden lines */
					__( '... %d more lines · ctrl+o to expand' ),
					lines.length - DEFAULT_COLLAPSE_THRESHOLD_LINES
				)
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
		if ( this.replayMode ) {
			this.tui.requestRender();
			return;
		}
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
		const elapsed = this.toolStartTime ? this.nowMs() - this.toolStartTime : 0;
		this.toolStartTime = null;
		const elapsedSeconds = Math.max( elapsed, 0 ) / 1000;
		const elapsedStr =
			elapsed > 0 || this.replayMode ? chalk.dim( ` (${ elapsedSeconds.toFixed( 1 ) }s)` ) : '';
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
		const lines: TodoRenderLine[] = buildTodoUpdateLines( pendingTodoRender.diff.snapshot );
		if ( lines.length === 0 ) {
			return;
		}
		const rendered = formatToolOutputLines(
			lines.map( ( line ) => ( line.dim ? chalk.dim( line.text ) : line.text ) )
		);
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

	private consumeLatestPendingToolCall(): {
		id: string;
		name: string;
		input: Record< string, unknown >;
	} | null {
		let latestPendingToolCall: {
			id: string;
			name: string;
			input: Record< string, unknown >;
		} | null = null;

		for ( const [ id, toolCall ] of this.pendingToolCalls.entries() ) {
			latestPendingToolCall = { id, ...toolCall };
		}

		if ( latestPendingToolCall ) {
			this.pendingToolCalls.delete( latestPendingToolCall.id );
		}

		return latestPendingToolCall;
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
			this.messages.addChild( new Text( '\n' + chalk.bold( q.question ), 1, 0 ) );
			this.tui.requestRender();

			if ( q.options.length > 0 ) {
				// Use SelectList for option-based questions.
				// When allowFreeForm is true, append an "Other" option with inline input.
				this.hideEditor();
				const selectItems: SelectItem[] = q.options.map( ( opt, i ) => ( {
					value: opt.label,
					label: `${ i + 1 }. ${ opt.label }`,
					description: opt.description,
				} ) );
				this.optionPickerHasFreeForm = q.allowFreeForm === true;
				if ( this.optionPickerHasFreeForm ) {
					selectItems.push( {
						value: AiChatUI.OTHER_VALUE,
						label: __( 'Other (type my own)' ),
					} );
				}

				this.optionPickerItemCount = selectItems.length;
				const selectList = new SelectList(
					selectItems,
					selectItems.length,
					AiChatUI.OPTION_PICKER_THEME
				);

				this.optionPickerSelectList = selectList;
				this.optionPickerVisible = true;
				this.optionPickerContainer = new Container();
				this.tui.addChild( this.optionPickerContainer );
				this.optionPickerContainer.addChild( this.optionPickerSelectList );
				this.tui.requestRender();

				const selected = await new Promise< string >( ( resolve ) => {
					this.optionPickerResolve = resolve;
					selectList.onSelect = ( item: SelectItem ) => {
						if ( item.value === AiChatUI.OTHER_VALUE ) {
							// "Other" selected via enter without typing — activate input
							this.activateOptionPickerOther();
							this.renderOptionPicker();
							return;
						}
						this.optionPickerResolve = null;
						this.closeOptionPicker();
						resolve( item.value );
					};
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
		| { sessionId: string; maxTurnsReached: true; numTurns: number }
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
						this.toolStartTime = this.nowMs();
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
				if ( ! this.replayMode && ! this.loaderVisible ) {
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
					const fallbackToolCall = toolCall ?? this.consumeLatestPendingToolCall();
					this.showToolResult( message, fallbackToolCall?.name, fallbackToolCall?.input );
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
					const thinkingSec = Math.round( ( this.nowMs() - this.turnStartTime ) / 1000 );
					if ( ! this.hasShownResponseMarker ) {
						this.messages.addChild(
							new Text( '\n ' + chalk.blue( '⏺' ) + ' ' + __( 'Done' ), 0, 0 )
						);
					}
					this.showInfo(
						sprintf(
							/* translators: 1: seconds spent thinking, 2: number of turns */
							_n(
								'Thought for %1$ds · %2$d turn',
								'Thought for %1$ds · %2$d turns',
								message.num_turns
							),
							thinkingSec,
							message.num_turns
						)
					);
					return { sessionId: message.session_id, success: true };
				}

				// User-initiated interruption: show friendly message instead of error
				if ( this.wasInterrupted ) {
					const thinkingSec = Math.round( ( this.nowMs() - this.turnStartTime ) / 1000 );
					this.messages.addChild(
						new Text(
							'\n ' + chalk.yellow( '⏺' ) + ' ' + chalk.yellow( __( 'Interrupted' ) ),
							0,
							0
						)
					);
					this.showInfo(
						sprintf(
							/* translators: %d: number of seconds */
							__( 'Ran for %ds before interruption' ),
							thinkingSec
						)
					);
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
					};
				} else if ( message.subtype ) {
					parts.push( `(${ message.subtype })` );
				}
				if ( 'permission_denials' in message && message.permission_denials?.length ) {
					for ( const denial of message.permission_denials ) {
						parts.push(
							sprintf(
								/* translators: %s: tool name */
								__( 'Permission denied: %s' ),
								denial.tool_name
							)
						);
					}
				}
				this.showError( parts.length > 0 ? parts.join( '\n' ) : __( 'Unknown error' ) );
				return { sessionId: message.session_id, success: false };
			}
		}
		return undefined;
	}
}
