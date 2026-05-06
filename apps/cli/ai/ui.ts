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
import { randomThinkingMessage } from '@studio/common/ai/thinking-messages';
import { getToolDetail, getToolDisplayName } from '@studio/common/ai/tools';
import chalk from '@studio/common/lib/chalk';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { __, _n, sprintf } from '@wordpress/i18n';
import { DEFAULT_MODEL, getAiModelLabel, type AiModelId, type AskUserQuestion } from 'cli/ai/agent';
import {
	findLastAssistant,
	type AiOutputAdapter,
	type HandleEventResult,
} from 'cli/ai/output-adapter';
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER, type AiProviderId } from 'cli/ai/providers';
import { getActiveSlashCommands } from 'cli/ai/slash-commands';
import { buildTodoUpdateLines, type TodoRenderLine } from 'cli/ai/todo-render';
import { diffTodoSnapshot, type TodoDiff, type TodoEntry } from 'cli/ai/todo-stream';
import { getWpComSites } from 'cli/lib/api';
import { openBrowser } from 'cli/lib/browser';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { getSitesRunningStatus, isSiteRunning } from 'cli/lib/site-utils';
import type { ToolResultMessage } from '@mariozechner/pi-ai';
import type { AgentRuntimeEvent } from 'cli/ai/runtimes/runtime-events';

interface TodoWriteInput {
	todos: Array< {
		content: string;
		activeForm: string;
		status: 'pending' | 'in_progress' | 'completed';
	} >;
}

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
	wpcomSiteId?: number;
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

// Faint variant of the user bubble used by `addUserMessage`, for prompts that
// were staged during an active turn and haven't been dispatched yet.
function formatQueuedPrompt( text: string ): string {
	const lines = text.split( '\n' );
	return lines
		.map( ( line, i ) => {
			const body = i === 0 ? '↳ ' + line + ' ' : '  ' + line + ' ';
			return ' ' + chalk.bgHex( '#e8eef5' ).hex( '#5a6b7d' )( body );
		} )
		.join( '\n' );
}

class PromptEditor implements Component, Focusable {
	private editor: Editor;
	private borderColorFn: ( text: string ) => string;
	private _focused = false;
	private isEmpty = true;
	activeSiteName: string | null = null;
	busyMessage: string | null = null;
	hints: string[] = [];
	statusMessage: string | null = null;
	daemonStatusMessage: string | null = null;
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

	addToHistory( text: string ): void {
		this.editor.addToHistory( text );
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
				// Top border with active site name and optional busy indicator
				if ( this.activeSiteName && borderWidth > 4 ) {
					const busySuffix = this.busyMessage ? ` ${ this.busyMessage }` : '';
					const label = ` ${ this.activeSiteName }${ busySuffix } `;
					const trailing = Math.min( 3, borderWidth );
					const labelWidth = visibleWidth( label );
					const leading = Math.max( 0, borderWidth - labelWidth - trailing );
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
		const rightSegments: string[] = [];
		if ( this.daemonStatusMessage ) {
			rightSegments.push( chalk.green( this.daemonStatusMessage ) );
		}
		if ( this.statusMessage ) {
			rightSegments.push( chalk.dim( this.statusMessage ) );
		}
		const rightPart =
			rightSegments.length > 0 ? rightSegments.join( chalk.dim( ' · ' ) ) + ' ' : '';
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

function formatToolName( name: string, input?: Record< string, unknown > ): string {
	const displayName = chalk.bold( getToolDisplayName( name ) );
	const detail = getToolDetail( name, input );
	if ( detail ) {
		return displayName + ' ' + chalk.dim( '(' + detail + ')' );
	}
	return displayName;
}

interface ToolUseResultContent {
	// Pi `ToolResultMessage` content is always an array of text/image blocks;
	// we render text and ignore image blocks for the terminal preview.
	content?: Array< { type: string; text?: string } >;
	isError?: boolean;
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

export class AiChatUI implements AiOutputAdapter {
	private tui: TUI;
	private editor: PromptEditor;
	private loader: Loader;
	private messages: Container;
	private queuedContainer: Container;
	private queuedPrompts: string[] = [];
	private currentResponseText = '';
	private currentMarkdown: Markdown | null = null;
	private submitResolve: ( ( text: string ) => void ) | null = null;
	private loaderVisible = false;
	private editorVisible = false;
	private interruptCallback: ( () => void ) | null = null;
	private wasInterrupted = false;
	private interruptionNoticeShown = false;
	private usageCapReached = false;
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
	currentSessionId: string | undefined;
	private numTurns = 0;

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

	set activeSite( site: SiteInfo | null ) {
		this._activeSite = site;
		this.editor.activeSiteName = site?.name ?? null;
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

	clearTranscript(): void {
		this.hideLoader();
		this.currentMarkdown = null;
		this.currentResponseText = '';
		this.messages.clear();
		if ( this.queuedPrompts.length > 0 ) {
			this.queuedPrompts = [];
			this.renderQueuedContainer();
		}
		this.tui.requestRender();
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

		// Always mounted just after `messages` and (once shown) just before the
		// editor, so staged follow-up prompts render in that gap regardless of
		// whether the loader is currently visible.
		this.queuedContainer = new Container();
		this.tui.addChild( this.queuedContainer );

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
			new CombinedAutocompleteProvider( getActiveSlashCommands(), process.cwd() )
		);

		this.editor.onSubmit = ( text ) => {
			const trimmed = text.trim();
			if ( ! trimmed ) {
				return;
			}
			this.editor.addToHistory( trimmed );
			if ( this.submitResolve ) {
				const resolve = this.submitResolve;
				this.submitResolve = null;
				resolve( trimmed );
				return;
			}
			// No waiter → we're mid-turn. Stage the prompt so it fires after
			// the current run ends; `waitForInput` drains the head.
			if ( this._inAgentTurn ) {
				this.queuedPrompts.push( trimmed );
				this.editor.setText( '' );
				this.renderQueuedContainer();
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
			if ( matchesKey( data, 'escape' ) && this.requestInterrupt() ) {
				return { consume: true };
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
			// Backspace on an empty editor pops the most recent queued prompt.
			// Mirrors the × discard affordance in the GUI — lightweight undo
			// for staged follow-ups without adding a new keybinding.
			if (
				matchesKey( data, 'backspace' ) &&
				this.editorVisible &&
				this.queuedPrompts.length > 0 &&
				this.editor.getText() === ''
			) {
				this.queuedPrompts.pop();
				this.renderQueuedContainer();
				return { consume: true };
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
		const runningStatus = await getSitesRunningStatus( sites );
		this.sitePickerItems = sites.map( ( site ) => ( {
			name: site.name,
			path: site.path,
			running: runningStatus.get( site.id ) ?? false,
		} ) );
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
				wpcomSiteId: site.id,
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
					__( ' Selected site: %s (WordPress.com)' ),
					site.name
			  )
			: sprintf(
					/* translators: %s: site name */
					__( ' Selected site: %s' ),
					site.name
			  );
		if ( announce ) {
			this.messages.addChild( new Text( `\n${ chalk.hex( '#8839ef' )( label ) }\n`, 0, 0 ) );
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
		// Tool names arrive in two flavors depending on the runtime:
		//   - Anthropic (Claude Agent SDK): `mcp__studio__site_create` (the SDK
		//     auto-prefixes MCP-server tool names).
		//   - OpenAI (pi-agent-core): `site_create` (registered by bare name).
		// Strip the prefix so the switch below stays single-source.
		const bareName = toolName.startsWith( 'mcp__studio__' )
			? toolName.slice( 'mcp__studio__'.length )
			: toolName;
		switch ( bareName ) {
			case 'site_create': {
				const name = toolInput?.name;
				if ( typeof name === 'string' ) {
					await this.selectLocalSiteFromTool( name, { running: true } );
				}
				break;
			}
			case 'site_info':
			case 'site_start': {
				const nameOrPath = toolInput?.nameOrPath;
				if ( typeof nameOrPath === 'string' ) {
					await this.selectLocalSiteFromTool( nameOrPath, {
						running: bareName === 'site_start' ? true : undefined,
					} );
				}
				break;
			}
			case 'wp_cli':
			case 'preview_create':
			case 'preview_list':
			case 'preview_update':
			case 'validate_blocks': {
				const nameOrPath = toolInput?.nameOrPath;
				if ( typeof nameOrPath === 'string' ) {
					await this.selectLocalSiteFromTool( nameOrPath );
				}
				break;
			}
			case 'site_stop': {
				const nameOrPath = toolInput?.nameOrPath;
				if ( typeof nameOrPath === 'string' ) {
					await this.selectLocalSiteFromTool( nameOrPath, { running: false } );
				}
				break;
			}
			case 'site_delete': {
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

	private cancelOptionPicker(): void {
		const resolve = this.optionPickerResolve;
		this.optionPickerResolve = null;
		this.closeOptionPicker();
		resolve?.( '' );
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
		const logoLines = [
			'    ▄█▛▀▀▀▀█▙▖',
			' ▗▟█        ▗██▄',
			'▄███▛ ▝▜██  ▝███▙',
			'█ ▐█▙   ███  ▐█ ▐',
			'█  ▀█▄  ███▌ ▐▛ ▐',
			'▀▙▖ ▜█▄▟ ▝█▙▄▌ ▄▛',
			' ▝▜▄▝██▌  ▀██▗▟▀',
			'    ▀██▙▄▄▄█▛▘',
		];
		const logo = logoLines.map( ( s ) => b( s ) );
		const logoWidth = Math.max( ...logoLines.map( ( s ) => s.length ) );

		// Lay out logo on the left, info on the right (vertically centered)
		const gap = 4;
		const leading = 1;
		const termWidth = process.stdout.columns ?? 80;
		const availableInfoWidth = Math.max( 0, termWidth - leading - logoWidth - gap );

		// Truncate the cwd with a leading ellipsis (preserving the meaningful
		// suffix) when the terminal is too narrow, otherwise the welcome wraps
		// and visually breaks the logo layout.
		const baseInfo = `${ getAiModelLabel( this.currentModel ) } · ${
			AI_PROVIDERS[ this.currentProvider ]
		}`;
		const sep = ' · ';
		let secondLine: string;
		if ( baseInfo.length + sep.length + displayCwd.length <= availableInfoWidth ) {
			secondLine = `${ baseInfo }${ sep }${ displayCwd }`;
		} else {
			const pathBudget = availableInfoWidth - baseInfo.length - sep.length;
			if ( pathBudget >= 4 ) {
				secondLine = `${ baseInfo }${ sep }…${ displayCwd.slice( -( pathBudget - 1 ) ) }`;
			} else {
				secondLine = baseInfo;
			}
		}

		const info = [
			chalk.bold( 'WordPress Studio' ) + ( version ? chalk.dim( ` v${ version }` ) : '' ),
			chalk.dim( secondLine ),
			'',
			chalk.dim.italic( __( 'Code is Poetry' ) ),
		];

		const infoStartRow = Math.max( 0, Math.floor( ( logo.length - info.length ) / 2 ) );

		const lines = logo.map( ( logoLine, i ) => {
			const infoIndex = i - infoStartRow;
			const infoText = infoIndex >= 0 && infoIndex < info.length ? info[ infoIndex ] : '';
			return ' '.repeat( leading ) + logoLine + ' '.repeat( gap ) + infoText;
		} );

		this.messages.addChild( new Text( '\n' + lines.join( '\n' ) + '\n', 0, 0 ) );
		this.tui.requestRender();
	}

	set onInterrupt( fn: ( () => void ) | null ) {
		this.interruptCallback = fn;
		this.updateHints();
	}

	private requestInterrupt(): boolean {
		if ( ! this.interruptCallback ) {
			return false;
		}

		if ( this.wasInterrupted ) {
			return true;
		}

		this.wasInterrupted = true;
		this.closeSitePicker();
		this.cancelOptionPicker();
		if ( this.submitResolve ) {
			const resolve = this.submitResolve;
			this.submitResolve = null;
			resolve( '' );
		}
		this.showInterruptedNotice();
		this.interruptCallback();
		this.updateHints();
		return true;
	}

	private showInterruptedNotice(): void {
		if ( this.interruptionNoticeShown ) {
			return;
		}

		this.interruptionNoticeShown = true;
		this.hideLoader();
		this.stopToolDotBlink();
		this.toolDotText = null;
		this.currentMarkdown = null;
		this.currentResponseText = '';

		const thinkingSec = Math.round( ( this.nowMs() - this.turnStartTime ) / 1000 );
		this.messages.addChild(
			new Text( '\n ' + chalk.yellow( '⏺' ) + ' ' + chalk.yellow( __( 'Interrupted' ) ), 0, 0 )
		);
		this.showInfo(
			sprintf(
				/* translators: %d: number of seconds */
				__( 'Ran for %ds before interruption' ),
				thinkingSec
			)
		);
	}

	stop(): void {
		this.loader.stop();
		this.tui.stop();
	}

	waitForInput(): Promise< string > {
		this.hideLoader();
		this.showEditor();
		if ( this.queuedPrompts.length > 0 ) {
			const next = this.queuedPrompts.shift()!;
			this.renderQueuedContainer();
			return Promise.resolve( next );
		}
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

	private renderQueuedContainer(): void {
		this.queuedContainer.clear();
		for ( const prompt of this.queuedPrompts ) {
			this.queuedContainer.addChild( new Text( '\n' + formatQueuedPrompt( prompt ), 0, 0 ) );
		}
		this.updateHints();
		this.tui.requestRender();
	}

	private lastProgressText: Text | null = null;

	setLoaderMessage( message: string, update?: boolean ): void {
		if ( ! message ) {
			return;
		}
		const formatted = '   ' + chalk.dim( '⎿ ' ) + chalk.dim( message );
		if ( update && this.lastProgressText ) {
			this.lastProgressText.setText( formatted );
		} else {
			this.lastProgressText = new Text( formatted, 0, 0 );
			this.messages.addChild( this.lastProgressText );
		}
		this.tui.requestRender();
	}

	private showLoader( message?: string ): void {
		if ( ! this.loaderVisible ) {
			// Re-attach trailing children in order so the final stack is
			// [..., loader, queuedContainer, editor?] — loader just above the
			// staged follow-ups, which sit just above the editor.
			const wasEditorVisible = this.editorVisible;
			if ( wasEditorVisible ) {
				this.tui.removeChild( this.editor );
			}
			this.tui.removeChild( this.queuedContainer );
			this.tui.addChild( this.loader );
			this.tui.addChild( this.queuedContainer );
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
			this.lastProgressText = null;
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
		if ( this.queuedPrompts.length > 0 ) {
			hints.push( __( 'backspace to unqueue' ) );
		}
		if ( this.interruptCallback ) {
			hints.push( __( 'esc to interrupt' ) );
		}
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
		this._inAgentTurn = true;
		this.updateHints();
		this.showLoader( randomThinkingMessage() );
		this.currentResponseText = '';
		this.hasShownResponseMarker = false;
		this.wasInterrupted = false;
		this.interruptionNoticeShown = false;
		this.usageCapReached = false;
		this.turnStartTime = this.nowMs();
		this.numTurns = 0;
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

	/**
	 * Returns true when the current/last turn surfaced the AI usage cap
	 * message to the user. Lets callers suppress redundant downstream
	 * errors (e.g. the SDK's "process exited with code 1" that follows
	 * the upstream 429).
	 */
	hasErrorBeenSurfaced(): boolean {
		return this.usageCapReached;
	}

	showOnboarding(): void {
		const text =
			' ' +
			chalk.blue( '⏺' ) +
			' ' +
			sprintf(
				/* translators: %s: product name (WordPress Studio) */
				__( "Hello, I'm %s, your local WordPress agent and builder." ),
				chalk.bold( 'WordPress Studio' )
			);

		this.messages.addChild( new Text( '\n' + text + '\n', 0, 0 ) );
		this.tui.requestRender();
	}

	showCapabilities(): void {
		const b = chalk.bold;
		const d = chalk.dim;
		const separator = d( ' ─'.padEnd( 80, '─' ) );

		const lines = [
			' ' +
				chalk.blue( '⏺' ) +
				' ' +
				__( "Great, you're connected now! Let me tell you what I can do:" ),
			'',
			'  ' + b( __( 'Local Sites Management' ) ),
			'',
			'  - ' +
				sprintf(
					/* translators: %s: bold "Create" */
					__( '%s new local WordPress sites instantly (fully configured, ready to use)' ),
					b( __( 'Create' ) )
				),
			'  - ' +
				sprintf(
					/* translators: %s: bold "Start / stop" */
					__( '%s existing local sites' ),
					b( __( 'Start / stop' ) )
				),
			'  - ' +
				sprintf(
					/* translators: %s: bold "List" */
					__( '%s all your local sites and their status' ),
					b( __( 'List' ) )
				),
			'',
			'  ' + b( __( 'Design & Development' ) ),
			'',
			'  - ' +
				sprintf(
					/* translators: %s: bold "Build" */
					__( '%s block themes with striking, memorable designs' ),
					b( __( 'Build' ) )
				),
			'  - ' +
				sprintf(
					/* translators: %s: bold "CSS, PHP, and JavaScript" */
					__( 'Write custom %s for themes and plugins' ),
					b( __( 'CSS, PHP, and JavaScript' ) )
				),
			'  - ' +
				sprintf(
					/* translators: %s: bold "pages and posts" */
					__( 'Create %s with valid Gutenberg block content' ),
					b( __( 'pages and posts' ) )
				),
			'  - ' +
				sprintf(
					/* translators: %s: bold "plugins" */
					__( 'Install and activate %s via WP-CLI' ),
					b( __( 'plugins' ) )
				),
			'',
			'  ' + b( __( 'Content' ) ),
			'',
			'  - ' +
				sprintf(
					/* translators: %s: bold "page content" */
					__( 'Generate and import %s using core blocks' ),
					b( __( 'page content' ) )
				),
			'  - ' +
				sprintf(
					/* translators: %s: bold "navigation menus, site options, post types, taxonomies, and settings" */
					__( 'Set up %s' ),
					b( __( 'navigation menus, site options, post types, taxonomies, and settings' ) )
				),
			'  - ' + __( "Create realistic placeholder content tailored to your site's purpose" ),
			'  - ' +
				sprintf(
					/* translators: %s: bold "images and videos" */
					__( 'Upload %s to your site, using local media files or remote URLs' ),
					b( __( 'images and videos' ) )
				),
			'',
			'  ' + b( __( 'Preview & Publishing' ) ),
			'',
			'  - ' +
				sprintf(
					/* translators: %s: bold "screenshots" */
					__( 'Take %s (desktop + mobile) to verify the design is well crafted' ),
					b( __( 'screenshots' ) )
				),
			'  - ' +
				sprintf(
					/* translators: %s: bold "Validate" */
					__( "%s all block content to ensure it's editor-compatible" ),
					b( __( 'Validate' ) )
				),
			'  - ' +
				sprintf(
					/* translators: %s: bold "Push" */
					__( '%s your local site to the cloud in WordPress.com' ),
					b( __( 'Push' ) )
				),
			'  - ' +
				sprintf(
					/* translators: %s: bold "Generate preview sites" */
					__( '%s with shareable URLs for quick feedback' ),
					b( __( 'Generate preview sites' ) )
				),
			'',
			separator,
			'',
			'  ' + __( 'Just tell me what you want to build — for example:' ),
			'',
			'  ' + d( chalk.italic( __( '"Create a portfolio site for a photographer"' ) ) ),
			'  ' + d( chalk.italic( __( '"Build a landing page for a SaaS product"' ) ) ),
			'  ' + d( chalk.italic( __( '"Make a blog for a coffee shop"' ) ) ),
			'',
			'  ' +
				__(
					"I'll ask a few quick questions about the name and layout, then build the whole thing for you. The more precise you are about what you want, the better the result will be."
				),
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

	showProgress( message: string ): void {
		this.messages.addChild( new Text( '\n ' + '⏺' + ' ' + message + '\n', 0, 0 ) );
		this.tui.requestRender();
	}

	setStatusMessage( message: string | null ): void {
		this.editor.statusMessage = message;
		this.tui.requestRender();
	}

	setDaemonStatus( state: { running: boolean; pid?: number } ): void {
		this.editor.daemonStatusMessage = state.running ? __( 'Remote session active' ) : null;
		this.tui.requestRender();
	}

	private busyTimer: ReturnType< typeof setInterval > | null = null;
	private busyFrameIndex = 0;
	private static readonly BUSY_FRAMES = [ '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏' ];

	setBusy( active: boolean ): void {
		if ( this.busyTimer ) {
			clearInterval( this.busyTimer );
			this.busyTimer = null;
		}

		if ( active ) {
			this.busyFrameIndex = 0;
			this.editor.busyMessage = AiChatUI.BUSY_FRAMES[ 0 ];
			this.tui.requestRender();
			this.busyTimer = setInterval( () => {
				this.busyFrameIndex = ( this.busyFrameIndex + 1 ) % AiChatUI.BUSY_FRAMES.length;
				this.editor.busyMessage = AiChatUI.BUSY_FRAMES[ this.busyFrameIndex ];
				this.tui.requestRender();
			}, 80 );
		} else {
			this.editor.busyMessage = null;
			this.tui.requestRender();
		}
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
		this.showLoader( randomThinkingMessage() );
		this.stopToolDotBlink();
		this.lastProgressText = null;
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

	private getToolResultContent( result: ToolResultMessage ): ToolUseResultContent | null {
		const blocks: Array< { type: string; text?: string } > = [];
		for ( const block of result.content ) {
			if ( block.type === 'text' && typeof block.text === 'string' ) {
				blocks.push( { type: 'text', text: block.text } );
			}
		}
		if ( blocks.length === 0 && ! result.isError ) {
			return null;
		}
		return {
			content: blocks.length > 0 ? blocks : undefined,
			isError: result.isError,
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
		result: ToolResultMessage,
		toolName?: string,
		toolInput?: Record< string, unknown > | null
	): void {
		this.stopToolDotBlink();
		const typedResult = this.getToolResultContent( result );
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

	private showTodoToolResult( result: ToolResultMessage, toolUseId: string ): void {
		this.stopToolDotBlink();
		const typedResult = this.getToolResultContent( result );
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
					selectList.onCancel = () => {
						this.cancelOptionPicker();
					};
				} );

				if ( ! selected ) {
					return answers;
				}
				answers[ q.question ] = selected;
			} else {
				// Free-form text input
				const answer = await this.waitForInput();
				if ( ! answer ) {
					return answers;
				}
				answers[ q.question ] = answer;
			}
		}

		// Resume the agent turn with a fresh markdown block for subsequent text
		this.showLoader( randomThinkingMessage() );
		return answers;
	}

	/**
	 * Process a runtime event and update the UI.
	 * Returns session result when the agent turn is complete.
	 */
	handleEvent( event: AgentRuntimeEvent ): HandleEventResult | undefined {
		if ( this.wasInterrupted && event.type !== 'agent_end' ) {
			return undefined;
		}

		switch ( event.type ) {
			case 'compaction_start':
				this.showLoader( __( 'Compacting conversation history…' ) );
				return undefined;
			case 'compaction_end':
				this.hideLoader();
				if ( ! event.errorMessage ) {
					this.showInfo( __( 'Conversation history compacted' ) );
				}
				return undefined;
			case 'message_end': {
				const message = event.message;
				if ( message.role !== 'assistant' ) {
					return undefined;
				}

				// Detect the AI usage cap response from the WordPress.com proxy.
				// On wpcom a 429 is always a cap issue — pi-ai surfaces it via
				// `stopReason: 'error'` with the upstream body in `errorMessage`.
				if (
					message.stopReason === 'error' &&
					this.currentProvider === 'wpcom' &&
					/API Error:\s*429|status code 429|"status":\s*429/i.test( message.errorMessage ?? '' )
				) {
					this.hideLoader();
					this.usageCapReached = true;
					this.showError(
						__(
							'AI usage cap reached. You can continue using Studio Code by switching to your own Anthropic API key.'
						)
					);
					this.showInfo(
						__( 'Use /provider to switch to Anthropic · API key, or try again later.' )
					);
					this.currentMarkdown = null;
					this.currentResponseText = '';
					return undefined;
				}

				for ( const block of message.content ) {
					if ( block.type === 'text' ) {
						this.hideLoader();
						if ( ! this.currentMarkdown ) {
							this.currentResponseText = '';
							this.hasShownResponseMarker = false;
						}
						if ( ! this.hasShownResponseMarker ) {
							this.hasShownResponseMarker = true;
							this.currentMarkdown = new Markdown( '\n', 1, 0, markdownTheme );
							this.messages.addChild( this.currentMarkdown );
						}
						if ( this.currentResponseText && ! this.currentResponseText.endsWith( '\n' ) ) {
							this.currentResponseText += '\n';
						}
						this.currentResponseText += block.text;
						this.currentMarkdown!.setText(
							'\n' + chalk.blue( '⏺' ) + ' ' + this.currentResponseText
						);
						this.tui.requestRender();
					} else if ( block.type === 'toolCall' ) {
						this.toolStartTime = this.nowMs();
						const input = ( block.arguments ?? {} ) as Record< string, unknown >;
						this.pendingToolCalls.set( block.id, { name: block.name, input } );
						const toolLabel = formatToolName( block.name, input );
						if ( block.name === 'TodoWrite' && isTodoWriteInput( input ) ) {
							const diff = diffTodoSnapshot( this.latestTodoSnapshot, input.todos );
							const shouldRender =
								diff.hasVisibleChanges && diff.signature !== this.lastRenderedTodoSignature;
							this.pendingTodoRenders.set( block.id, {
								diff,
								toolLabel,
								shouldRender,
							} );
							this.pendingTodoRenderOrder.push( block.id );
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
				if ( ! this.replayMode && ! this.loaderVisible ) {
					this.showLoader( randomThinkingMessage() );
				}
				return undefined;
			}
			case 'turn_end': {
				this.numTurns += 1;
				// Render tool results emitted by this turn. Pi already routes
				// them via individual `tool_execution_end` events, but the
				// turn-end batch is the canonical post-tool boundary —
				// closing the markdown block here mirrors the old `'user'`
				// branch behavior.
				for ( const toolResult of event.toolResults ) {
					const toolCallId = toolResult.toolCallId;
					const toolCall = this.pendingToolCalls.get( toolCallId );
					if ( toolCall ) {
						this.pendingToolCalls.delete( toolCallId );
					}
					if ( this.pendingTodoRenders.has( toolCallId ) ) {
						this.showTodoToolResult( toolResult, toolCallId );
					} else if (
						! this.pendingTodoRenders.has( toolCallId ) &&
						this.pendingTodoRenderOrder.length > 0 &&
						toolCall?.name === 'TodoWrite'
					) {
						this.showTodoToolResult( toolResult, this.pendingTodoRenderOrder[ 0 ] );
					} else {
						this.showToolResult( toolResult, toolCall?.name, toolCall?.input );
					}
				}
				if ( event.toolResults.length > 0 ) {
					this.currentMarkdown = null;
					this.currentResponseText = '';
				}
				return undefined;
			}
			case 'agent_end': {
				this.hideLoader();
				const sessionId = this.currentSessionId ?? '';

				if ( this.usageCapReached ) {
					return { type: 'result', sessionId, success: false };
				}

				if ( this.wasInterrupted ) {
					this.showInterruptedNotice();
					return {
						type: 'result',
						sessionId,
						success: false,
						interrupted: true,
					};
				}

				const lastAssistant = findLastAssistant( event.messages );
				const isError =
					lastAssistant?.stopReason === 'error' || lastAssistant?.stopReason === 'aborted';

				if ( isError ) {
					const errorText = lastAssistant?.errorMessage?.trim();
					const fallbackText = lastAssistant?.content
						.filter( ( block ): block is { type: 'text'; text: string } => block.type === 'text' )
						.map( ( block ) => block.text )
						.join( '\n' )
						.trim();
					this.showError( errorText || fallbackText || __( 'Unknown error' ) );
					return { type: 'result', sessionId, success: false };
				}

				const thinkingSec = Math.round( ( this.nowMs() - this.turnStartTime ) / 1000 );
				if ( ! this.hasShownResponseMarker ) {
					this.messages.addChild(
						new Text( '\n ' + chalk.blue( '⏺' ) + ' ' + __( 'Done' ), 0, 0 )
					);
				}
				this.showInfo(
					sprintf(
						/* translators: 1: seconds spent thinking, 2: number of turns */
						_n( 'Thought for %1$ds · %2$d turn', 'Thought for %1$ds · %2$d turns', this.numTurns ),
						thinkingSec,
						this.numTurns
					)
				);
				return { type: 'result', sessionId, success: true };
			}
			default:
				// agent_start / turn_start / message_start / message_update /
				// tool_execution_* — UI doesn't act on these directly; pi
				// events drive incremental state but the visible transitions
				// happen at message_end / turn_end / agent_end.
				return undefined;
		}
	}
}
