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
	getCapabilities,
	Image,
	Spacer,
} from '@earendil-works/pi-tui';
import { stripMediaWidgetPayloadLines } from '@studio/common/ai/chat-artifacts';
import { DEFAULT_MODEL, getAiModelLabel, type AiModelId } from '@studio/common/ai/models';
import { findLastAssistant } from '@studio/common/ai/session-events';
import { randomThinkingMessage } from '@studio/common/ai/thinking-messages';
import { getToolDetail, getToolDisplayName, getToolResultPreview } from '@studio/common/ai/tools';
import chalk from '@studio/common/lib/chalk';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	DescriptionAwareAutocompleteProvider,
	dimUnhighlighted,
} from 'cli/ai/description-autocomplete';
import { buildOptionPickerLines } from 'cli/ai/option-picker';
import { type AiOutputAdapter } from 'cli/ai/output-adapter';
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER, type AiProviderId } from 'cli/ai/providers';
import { getActiveSlashCommands } from 'cli/ai/slash-commands';
import { getWpComSites } from 'cli/lib/api';
import { openBrowser } from 'cli/lib/browser';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { notifyTerminal } from 'cli/lib/notify';
import { getSitesRunningStatus, isSiteRunning } from 'cli/lib/site-utils';
import { formatTosNoticeLines } from 'cli/lib/tos-notice';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { AskUserQuestion, SiteInfo } from 'cli/ai/types';

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
		description: ( text ) => dimUnhighlighted( text ),
		scrollInfo: ( text ) => chalk.dim( text ),
		noMatch: ( text ) => chalk.dim( text ),
	},
};

function formatToolName( name: string, input?: Record< string, unknown > ): string {
	const displayName = chalk.bold( getToolDisplayName( name, input ) );
	const detail = getToolDetail( name, input );
	if ( detail ) {
		return displayName + ' ' + chalk.dim( detail );
	}
	return displayName;
}

interface ToolUseResultContent {
	// Text blocks of a pi `ToolResultMessage`; image blocks render separately.
	content: Array< { type: string; text?: string } >;
	isError?: boolean;
}

interface ToolRenderState {
	container: Container;
	rowText: Text;
	progressText: Text | null;
	progressLines: string[];
}

interface PendingToolCall {
	name: string;
	input: Record< string, unknown >;
	label: string;
	startedAtMs: number;
	render: ToolRenderState | null;
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
	private _activeSite: SiteInfo | null = null;
	private activeExpandablePreview: ExpandablePreview | null = null;
	private _inAgentTurn = false;
	private _activeSiteData: SiteData | null = null;
	private siteSelectedCallback: ( ( site: SiteInfo ) => void ) | null = null;
	private replayMode = false;
	private replayTimestampMs: number | null = null;
	private pendingToolCalls = new Map< string, PendingToolCall >();
	currentModel: AiModelId = DEFAULT_MODEL;
	currentProvider: AiProviderId = DEFAULT_AI_PROVIDER;
	private numTurns = 0;

	private optionPickerContainer: Container | null = null;
	private optionPickerSelectList: SelectList | null = null;
	private optionPickerVisible = false;
	private optionPickerResolve: ( ( label: string ) => void ) | null = null;
	private optionPickerOtherActive = false;
	private optionPickerHasFreeForm = false;
	private optionPickerItemCount = 0;
	private optionPickerInput: Input | null = null;
	private optionPickerItems: SelectItem[] = [];
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
		this.pendingToolCalls.clear();
		this.fallbackProgressText = null;
	}

	finishReplay(): void {
		this.replayMode = false;
		this.replayTimestampMs = null;
		this.hideLoader();
		this.currentMarkdown = null;
		this.currentResponseText = '';
		this.pendingToolCalls.clear();
		this.fallbackProgressText = null;
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
			new DescriptionAwareAutocompleteProvider( getActiveSlashCommands(), process.cwd() )
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
		switch ( toolName ) {
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
						running: toolName === 'site_start' ? true : undefined,
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
		// Custom multi-line rendering (full labels + wrapped descriptions);
		// SelectList is kept only for keyboard navigation and selection state.
		const lines = buildOptionPickerLines(
			this.optionPickerItems,
			this.optionPickerSelectList.getSelectedItem()?.value,
			width
		);

		// When "Other" is active, replace the last line with the inline input
		// ("Other" is always the last item and has no description lines).
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
		this.optionPickerItems = [];
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
		// Logger progress and daemon-status updates can request renders while
		// the TUI is stopped for an external prompt. pi-tui leaves that request
		// pending, so force a fresh render when resuming.
		this.tui.requestRender( true );
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

	showTosNotice(): void {
		const lines = formatTosNoticeLines().map( ( line ) =>
			line ? ' ' + chalk.dim( line ) : line
		);
		this.messages.addChild( new Text( lines.join( '\n' ) + '\n', 0, 0 ) );
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

	private fallbackProgressText: Text | null = null;

	setLoaderMessage( message: string, update?: boolean ): void {
		if ( ! message ) {
			return;
		}

		const toolCall = this.getActiveProgressToolCall();
		if ( toolCall ) {
			this.addToolProgress( toolCall, message, update === true );
			this.tui.requestRender();
			return;
		}

		const formatted = formatToolOutputLines( [ chalk.dim( message ) ] );
		if ( update && this.fallbackProgressText ) {
			this.fallbackProgressText.setText( formatted );
		} else {
			this.fallbackProgressText = new Text( formatted, 0, 0 );
			this.messages.addChild( this.fallbackProgressText );
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
			this.fallbackProgressText = null;
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
		this.pendingToolCalls.clear();
		this.fallbackProgressText = null;
	}

	/**
	 * End an agent turn: hide loader, clean up response state.
	 */
	endAgentTurn(): void {
		this.hideLoader();
		this.interruptCallback = null;
		this._inAgentTurn = false;
		this.pendingToolCalls.clear();
		this.fallbackProgressText = null;
		this.updateHints();
		this.currentMarkdown = null;
		this.currentResponseText = '';
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
		// Applies chalk.bold to any <b>…</b> tags in a translated string, then
		// strips the tags. Translators can place <b> anywhere in the sentence.
		const applyBold = ( str: string ) =>
			str.replace( /<b>(.*?)<\/b>/g, ( _, text: string ) => b( text ) );

		const lines = [
			' ' +
				chalk.blue( '⏺' ) +
				' ' +
				__( "Great, you're connected now! Let me tell you what I can do:" ),
			'',
			'  ' + b( __( 'Local Sites Management' ) ),
			'',
			/* translators: <b> and </b> wrap the action verb, which translators can move anywhere in the sentence */
			'  - ' +
				applyBold(
					__( '<b>Create</b> new local WordPress sites instantly (fully configured, ready to use)' )
				),
			/* translators: <b> and </b> wrap the action verb, which translators can move anywhere in the sentence */
			'  - ' + applyBold( __( '<b>Start / stop</b> existing local sites' ) ),
			/* translators: <b> and </b> wrap the action verb, which translators can move anywhere in the sentence */
			'  - ' + applyBold( __( '<b>List</b> all your local sites and their status' ) ),
			'',
			'  ' + b( __( 'Design & Development' ) ),
			'',
			/* translators: <b> and </b> wrap the action verb, which translators can move anywhere in the sentence */
			'  - ' + applyBold( __( '<b>Build</b> block themes with striking, memorable designs' ) ),
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
			/* translators: <b> and </b> wrap the action verb, which translators can move anywhere in the sentence */
			'  - ' +
				applyBold( __( "<b>Validate</b> all block content to ensure it's editor-compatible" ) ),
			/* translators: <b> and </b> wrap the action verb, which translators can move anywhere in the sentence */
			'  - ' + applyBold( __( '<b>Push</b> your local site to the cloud in WordPress.com' ) ),
			/* translators: <b> and </b> wrap the action verb, which translators can move anywhere in the sentence */
			'  - ' +
				applyBold( __( '<b>Generate preview sites</b> with shareable URLs for quick feedback' ) ),
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

	private addExpandablePreview(
		preview: { collapsed: string; expanded: string },
		target: Container = this.messages
	): void {
		const textComponent = new Text( preview.collapsed, 0, 0 );
		target.addChild( textComponent );

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

	private generateHiddenDetailsPreview(
		text: string,
		label: string,
		maxLength = 4000
	): { collapsed: string; expanded: string } {
		const expandedText =
			text.length > maxLength
				? text.slice( 0, maxLength ) + '\n' + __( '... output truncated' )
				: text;
		return {
			collapsed: formatToolOutputLines( [ chalk.dim( label ) ] ),
			expanded: formatToolOutputLines(
				expandedText.split( '\n' ).map( ( line ) => chalk.dim( line ) )
			),
		};
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

	private generateDiffPreview( diff: string ): { collapsed: string; expanded: string } {
		const rawLines = diff.replace( /\n$/, '' ).split( '\n' );
		const coloredLines = rawLines.map( ( line ) => {
			if ( line.startsWith( '+' ) ) {
				return chalk.green( line );
			}
			if ( line.startsWith( '-' ) ) {
				return chalk.red( line );
			}
			return chalk.dim( line );
		} );
		const expanded = formatToolOutputLines( coloredLines );

		if ( rawLines.length <= DEFAULT_COLLAPSE_THRESHOLD_LINES ) {
			return { collapsed: expanded, expanded };
		}

		// Window the collapsed view around the first change so the +/- lines
		// are visible instead of the diff's leading context lines.
		const firstChanged = rawLines.findIndex(
			( line ) => line.startsWith( '+' ) || line.startsWith( '-' )
		);
		const start = Math.max(
			0,
			Math.min( firstChanged - 1, rawLines.length - DEFAULT_COLLAPSE_THRESHOLD_LINES )
		);
		const windowLines = coloredLines.slice( start, start + DEFAULT_COLLAPSE_THRESHOLD_LINES );
		const collapsed =
			formatToolOutputLines( windowLines ) +
			'\n     ' +
			chalk.dim(
				sprintf(
					/* translators: %d: number of hidden lines */
					__( '... %d more lines · ctrl+o to expand' ),
					rawLines.length - windowLines.length
				)
			);

		return { collapsed, expanded };
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

	private getToolResultContent( result: ToolResultMessage ): ToolUseResultContent {
		const blocks: Array< { type: string; text?: string } > = [];
		for ( const block of result.content ) {
			if ( block.type === 'text' && typeof block.text === 'string' ) {
				// Old transcripts embed media widget payload markers in screenshot
				// results; strip them from replayed tool output like the desktop
				// conversation UIs do.
				blocks.push( { type: 'text', text: stripMediaWidgetPayloadLines( block.text ) } );
			}
		}
		return {
			content: blocks,
			isError: result.isError,
		};
	}

	private formatToolUseLine(
		isError: boolean,
		label: string,
		startedAtMs: number | null = null
	): string {
		const elapsed = startedAtMs === null ? 0 : this.nowMs() - startedAtMs;
		const elapsedSeconds = Math.max( elapsed, 0 ) / 1000;
		const elapsedStr =
			elapsed > 0 || this.replayMode ? chalk.dim( ` (${ elapsedSeconds.toFixed( 1 ) }s)` ) : '';
		const statusIcon = isError ? chalk.red( '⏺' ) : '⏺';

		return '\n ' + statusIcon + ' ' + label + elapsedStr;
	}

	private renderToolUseLine(
		isError: boolean,
		label: string,
		startedAtMs: number | null = null,
		target: Container = this.messages
	): Text {
		const rowText = new Text( this.formatToolUseLine( isError, label, startedAtMs ), 0, 0 );
		target.addChild( rowText );
		return rowText;
	}

	private ensureToolRender( toolCall: PendingToolCall ): ToolRenderState {
		if ( toolCall.render ) {
			return toolCall.render;
		}

		const container = new Container();
		const rowText = this.renderToolUseLine( false, toolCall.label, null, container );
		toolCall.render = {
			container,
			rowText,
			progressText: null,
			progressLines: [],
		};
		this.messages.addChild( container );
		return toolCall.render;
	}

	private finalizeToolRender( toolCall: PendingToolCall, isError: boolean ): ToolRenderState {
		const render = this.ensureToolRender( toolCall );
		render.rowText.setText(
			this.formatToolUseLine( isError, toolCall.label, toolCall.startedAtMs )
		);
		return render;
	}

	private getActiveProgressToolCall(): PendingToolCall | null {
		const toolCalls = Array.from( this.pendingToolCalls.values() );
		for ( let i = toolCalls.length - 1; i >= 0; i-- ) {
			const toolCall = toolCalls[ i ];
			if ( toolCall.render ) {
				return toolCall;
			}
		}
		return null;
	}

	private addToolProgress( toolCall: PendingToolCall, message: string, update: boolean ): void {
		const render = this.ensureToolRender( toolCall );
		const lastLine = render.progressLines[ render.progressLines.length - 1 ];
		if ( update && render.progressLines.length > 0 ) {
			render.progressLines[ render.progressLines.length - 1 ] = message;
		} else if ( lastLine !== message ) {
			render.progressLines.push( message );
		} else {
			return;
		}

		const formatted = formatToolOutputLines(
			render.progressLines.map( ( progressLine ) => chalk.dim( progressLine ) )
		);
		if ( render.progressText ) {
			render.progressText.setText( formatted );
		} else {
			render.progressText = new Text( formatted, 0, 0 );
			render.container.addChild( render.progressText );
		}
	}

	private renderToolResultText(
		content: string | Array< { type: string; text?: string } >,
		toolCall?: PendingToolCall,
		isError = false,
		target: Container = this.messages
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

		const toolName = toolCall?.name;
		const preview = getToolResultPreview( toolName, toolCall?.input, text, isError );
		if ( preview ) {
			target.addChild(
				new Text(
					formatToolOutputLines(
						preview.summaryLines.map( ( line ) =>
							isError ? chalk.red( line ) : chalk.dim( line )
						)
					),
					0,
					0
				)
			);
			if ( preview.detailText ) {
				this.addExpandablePreview(
					this.generateHiddenDetailsPreview(
						preview.detailText,
						preview.detailLabel ?? __( 'Full output hidden · ctrl+o to expand' ),
						preview.detailMaxLength
					),
					target
				);
			}
			return;
		}

		const maxLength = toolName === 'validate_blocks' ? 2000 : 500;
		const truncated = text.length > maxLength ? text.slice( 0, maxLength ) + '…' : text;
		const resultLines = truncated.split( '\n' );
		this.addExpandablePreview(
			this.generateExpandablePreview( resultLines.map( ( line ) => chalk.dim( line ) ) ),
			target
		);
	}

	// Finalize tool rows created at message_end and append each result inside
	// its matching tool container.
	renderToolResults( results: readonly ToolResultMessage[] ): void {
		for ( const toolResult of results ) {
			const toolCallId = toolResult.toolCallId;
			const toolCall = this.pendingToolCalls.get( toolCallId );
			this.showToolResult( toolResult, toolCall );
			if ( toolCall ) {
				this.pendingToolCalls.delete( toolCallId );
			}
		}
		if ( results.length > 0 ) {
			this.currentMarkdown = null;
			this.currentResponseText = '';
		}
	}

	private showToolResult( result: ToolResultMessage, toolCall?: PendingToolCall ): void {
		const typedResult = this.getToolResultContent( result );
		const isError = typedResult.isError === true;
		const label = toolCall?.label ?? chalk.bold( __( 'Tool' ) );
		const target = toolCall
			? this.finalizeToolRender( toolCall, isError ).container
			: this.messages;

		// Auto-select the site that was operated on
		if ( ! isError && toolCall ) {
			void this.autoSelectSiteFromToolResult( toolCall.name, toolCall.input );
		}

		if ( ! toolCall ) {
			this.renderToolUseLine( isError, label, null, target );
		}
		if ( toolCall && ! isError ) {
			let preview: { collapsed: string; expanded: string } | null = null;
			if ( toolCall.name === 'Write' && typeof toolCall.input.content === 'string' ) {
				preview = this.generateWritePreview( toolCall.input.content );
			} else if ( toolCall.name === 'Edit' ) {
				const details = result.details as { diff?: string } | undefined;
				if ( typeof details?.diff === 'string' && details.diff.length > 0 ) {
					preview = this.generateDiffPreview( details.diff );
				}
			}
			if ( preview ) {
				const summary = toolCall.name === 'Write' ? __( 'File written' ) : __( 'File edited' );
				target.addChild( new Text( formatToolOutputLines( [ chalk.dim( summary ) ] ), 0, 0 ) );
				this.addExpandablePreview( preview, target );
				this.tui.requestRender();
				return;
			}
		}

		this.renderToolResultText( typedResult.content, toolCall, isError, target );
		this.renderToolResultImages( result, target );
		this.tui.requestRender();
	}

	// Render image blocks (e.g. take_screenshot captures) inline when the
	// terminal supports an image protocol. Elsewhere the saved-file progress
	// line is the user's only handle on the capture.
	private renderToolResultImages( result: ToolResultMessage, target: Container ): void {
		const { images } = getCapabilities();
		if ( ! images ) {
			return;
		}
		for ( const block of result.content ) {
			if ( block.type !== 'image' || ! block.data || ! block.mimeType ) {
				continue;
			}
			// The kitty graphics protocol only renders PNG and screenshots are
			// JPEG; converting would need an optional WASM dependency we don't
			// ship, so those terminals keep the saved-file link instead.
			if ( images === 'kitty' && block.mimeType !== 'image/png' ) {
				continue;
			}
			target.addChild( new Spacer( 1 ) );
			target.addChild(
				new Image(
					block.data,
					block.mimeType,
					{ fallbackColor: ( value ) => chalk.dim( value ) },
					{ maxWidthCells: 60 }
				)
			);
		}
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

		void notifyTerminal( __( 'Studio Code is waiting for your answer' ) );

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

				this.optionPickerItems = selectItems;
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
				this.renderOptionPicker();

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
	handleEvent( event: AgentSessionEvent ): void {
		if ( this.wasInterrupted && event.type !== 'agent_end' ) {
			return;
		}

		switch ( event.type ) {
			case 'compaction_start':
				this.showLoader( __( 'Compacting conversation history…' ) );
				return;
			case 'compaction_end':
				this.hideLoader();
				if ( event.errorMessage ) {
					this.showError( event.errorMessage );
				} else if ( event.result && ! event.aborted ) {
					this.showInfo( __( 'Conversation history compacted' ) );
				}
				return;
			case 'message_end': {
				const message = event.message;
				if ( message.role !== 'assistant' ) {
					return;
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
					return;
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
						const startedAtMs = this.nowMs();
						const input = ( block.arguments ?? {} ) as Record< string, unknown >;
						const toolLabel = formatToolName( block.name, input );
						const toolCall: PendingToolCall = {
							name: block.name,
							input,
							label: toolLabel,
							startedAtMs,
							render: null,
						};
						this.ensureToolRender( toolCall );
						this.pendingToolCalls.set( block.id, toolCall );
					}
				}
				if ( ! this.replayMode && ! this.loaderVisible ) {
					this.showLoader( randomThinkingMessage() );
				}
				return;
			}
			case 'turn_end': {
				this.numTurns += 1;
				this.renderToolResults( event.toolResults );
				return;
			}
			case 'agent_end': {
				this.hideLoader();

				if ( this.usageCapReached ) {
					return;
				}

				if ( this.wasInterrupted ) {
					this.showInterruptedNotice();
					return;
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
					return;
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
				void notifyTerminal( __( 'Studio Code response is ready' ) );
				return;
			}
			default:
				// agent_start / turn_start / message_start / message_update /
				// tool_execution_* — UI doesn't act on these directly; pi
				// events drive incremental state but the visible transitions
				// happen at message_end / turn_end / agent_end.
				return;
		}
	}
}
