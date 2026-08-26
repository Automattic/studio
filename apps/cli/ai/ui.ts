import {
	getMarkdownTheme,
	ToolExecutionComponent,
	type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import {
	type TUI,
	TuiMainScreen,
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
	visibleWidth,
	truncateToWidth,
	CURSOR_MARKER,
} from '@earendil-works/pi-tui';
import { isOutOfCreditsError, isUsageCapError } from '@studio/common/ai/json-events';
import { DEFAULT_MODEL, getAiModelLabel, type AiModelId } from '@studio/common/ai/models';
import { findLastAssistant } from '@studio/common/ai/session-events';
import { randomThinkingMessage } from '@studio/common/ai/thinking-messages';
import { readAuthToken } from '@studio/common/lib/shared-config';
import {
	ADD_AI_CREDITS_URL,
	fetchStudioAssistantQuota,
	formatOutOfCreditsNotice,
	formatQuotaResetDate,
	formatUsageCapNotice,
	getTotalRemainingAiCredits,
} from '@studio/common/lib/studio-assistant-quota';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	DescriptionAwareAutocompleteProvider,
	dimUnhighlighted,
} from 'cli/ai/description-autocomplete';
import { buildOptionPickerLines } from 'cli/ai/option-picker';
import { type AiOutputAdapter } from 'cli/ai/output-adapter';
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER, type AiProviderId } from 'cli/ai/providers';
import { getActiveSlashCommands } from 'cli/ai/slash-commands';
import { initStudioTheme, refineStudioTheme, theme } from 'cli/ai/theme';
import { getToolRenderDefinition } from 'cli/ai/tool-render-definitions';
import { formatToolOutputLines } from 'cli/ai/tool-result-renderers';
import { getWpComSites } from 'cli/lib/api';
import { openBrowser } from 'cli/lib/browser';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { getSitesRunningStatus, isSiteRunning } from 'cli/lib/site-utils';
import { formatTosNoticeLines } from 'cli/lib/tos-notice';
import type { ToolResultMessage } from '@earendil-works/pi-ai';
import type { AskUserQuestion, SiteInfo } from 'cli/ai/types';

const SITE_PICKER_TAB_LOCAL = 'local' as const;
const SITE_PICKER_TAB_REMOTE = 'remote' as const;
type SitePickerTab = typeof SITE_PICKER_TAB_LOCAL | typeof SITE_PICKER_TAB_REMOTE;

const sitePickerTheme: SelectListTheme = {
	selectedPrefix: ( text ) => theme.fg( 'accent', text ),
	selectedText: ( text ) => theme.bold( text ),
	description: ( text ) => theme.fg( 'muted', text ),
	scrollInfo: ( text ) => theme.fg( 'muted', text ),
	noMatch: ( text ) => theme.fg( 'muted', text ),
};

// Faint variant of the user bubble used by `addUserMessage`, for prompts that
// were staged during an active turn and haven't been dispatched yet.
function formatQueuedPrompt( text: string ): string {
	const lines = text.split( '\n' );
	return lines
		.map( ( line, i ) => {
			const body = i === 0 ? '↳ ' + line + ' ' : '  ' + line + ' ';
			return ' ' + theme.bg( 'userMessageBg', theme.fg( 'muted', body ) );
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
		const promptPrefix = ' ' + theme.bold( '〉' );
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
						theme.fg( 'accent', label ) +
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
				? ' ' +
				  activeHints.map( ( h ) => theme.fg( 'muted', h ) ).join( theme.fg( 'muted', ' · ' ) )
				: '';
		const rightSegments: string[] = [];
		if ( this.daemonStatusMessage ) {
			rightSegments.push( theme.fg( 'success', this.daemonStatusMessage ) );
		}
		if ( this.statusMessage ) {
			rightSegments.push( theme.fg( 'muted', this.statusMessage ) );
		}
		const rightPart =
			rightSegments.length > 0 ? rightSegments.join( theme.fg( 'muted', ' · ' ) ) + ' ' : '';
		if ( leftPart || rightPart ) {
			const leftLen = visibleWidth( leftPart );
			const rightLen = visibleWidth( rightPart );
			const padding = Math.max( 1, width - leftLen - rightLen );
			result.push( leftPart + ' '.repeat( padding ) + rightPart );
		}

		return result.map( ( line ) => truncateToWidth( line, width ) );
	}
}

const editorTheme: EditorTheme = {
	borderColor: ( text ) => theme.fg( 'border', text ),
	selectList: {
		selectedPrefix: ( text ) => theme.fg( 'accent', text ),
		selectedText: ( text ) => theme.bold( text ),
		description: ( text ) => dimUnhighlighted( text ),
		scrollInfo: ( text ) => theme.fg( 'muted', text ),
		noMatch: ( text ) => theme.fg( 'muted', text ),
	},
};

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
	private toolOutputExpanded = false;
	private hasExpandableOutput = false;
	private _inAgentTurn = false;
	private _activeSiteData: SiteData | null = null;
	private siteSelectedCallback: ( ( site: SiteInfo ) => void ) | null = null;
	private replayMode = false;
	private replayTimestampMs: number | null = null;
	private pendingToolCalls = new Map<
		string,
		{ component: ToolExecutionComponent; toolName: string; input: Record< string, unknown > }
	>();
	private renderedToolResultIds = new Set< string >();
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
	private optionPickerQuestion = '';
	private static readonly OTHER_VALUE = '__other__';
	private static readonly OPTION_PICKER_THEME: SelectListTheme = {
		selectedPrefix: ( text: string ) => theme.fg( 'accent', text ),
		selectedText: ( text: string ) => theme.fg( 'accent', text ),
		description: ( text: string ) => theme.fg( 'muted', text ),
		scrollInfo: ( text: string ) => theme.fg( 'muted', text ),
		noMatch: ( text: string ) => theme.fg( 'muted', text ),
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
		this.renderedToolResultIds.clear();
		this.fallbackProgressText = null;
	}

	finishReplay(): void {
		this.replayMode = false;
		this.replayTimestampMs = null;
		this.hideLoader();
		this.currentMarkdown = null;
		this.currentResponseText = '';
		this.pendingToolCalls.clear();
		this.renderedToolResultIds.clear();
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
		this.messages.addChild( new Text( '\n' + theme.bold( question ), 0, 0 ) );
		this.tui.requestRender();
	}

	constructor() {
		initStudioTheme();
		const terminal = new ProcessTerminal();
		this.tui = new TuiMainScreen( terminal, true );

		this.messages = new Container();
		this.tui.addChild( this.messages );

		// Always mounted just after `messages` and (once shown) just before the
		// editor, so staged follow-up prompts render in that gap regardless of
		// whether the loader is currently visible.
		this.queuedContainer = new Container();
		this.tui.addChild( this.queuedContainer );

		this.loader = new Loader(
			this.tui,
			( str ) => theme.fg( 'accent', str ),
			( str ) => theme.fg( 'accent', str ),
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
			if ( matchesKey( data, 'ctrl+o' ) && this.hasExpandableOutput ) {
				this.toolOutputExpanded = ! this.toolOutputExpanded;
				for ( const child of this.messages.children ) {
					if ( child instanceof ToolExecutionComponent ) {
						child.setExpanded( this.toolOutputExpanded );
					}
				}
				this.updateHints();
				this.tui.requestRender();
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
				new Text( theme.fg( 'muted', '  ' + __( 'No sites found. Create one first.' ) ), 1, 0 )
			);
			this.tui.requestRender();
			return;
		}

		this.sitePickerSiteData = sites;
		const runningStatus = await getSitesRunningStatus( sites );
		this.sitePickerItems = sites.map( ( site ) => ( {
			id: site.id,
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
		this.messages.addChild( new Text( `\n${ theme.fg( 'muted', message ) }\n`, 1, 0 ) );
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
		const status = site.running ? `${ theme.fg( 'success', '●' ) } ` : '  ';
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
		const localTab = isLocal ? theme.bold( __( '[Local]' ) ) : theme.fg( 'muted', __( 'Local' ) );
		const remoteTab = isLocal
			? theme.fg( 'muted', 'WordPress.com' )
			: theme.bold( '[WordPress.com]' );
		const pad = ' ';
		const header = `${ pad }${ localTab }  ${ remoteTab }`;

		const searchLine = this.sitePickerQuery
			? `${ pad }${ theme.fg( 'muted', __( 'Search:' ) ) } ${ this.sitePickerQuery }`
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
			lines.push( theme.fg( 'muted', `${ pad }  ${ __( 'Loading WordPress.com sites…' ) }` ) );
		} else if ( this.sitePickerSelectList ) {
			const termWidth = process.stdout.columns ?? 80;
			lines.push(
				...this.sitePickerSelectList.render( termWidth - pad.length ).map( ( line ) => pad + line )
			);
		}

		lines.push( '' );
		lines.push( theme.fg( 'muted', hints ) );

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
			this.messages.addChild( new Text( `\n${ theme.fg( 'accent', label ) }\n`, 0, 0 ) );
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
		this.messages.addChild(
			new Text( theme.fg( 'muted', __( ' ✻ Site deselected' ) ) + '\n', 0, 0 )
		);
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
			id: site.id,
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
			const cursor = theme.inverse( ' ' );
			const display = inputText
				? theme.fg( 'accent', inputText ) + cursor
				: theme.fg( 'muted', __( 'Type your answer…' ) ) + cursor;
			lines[ lines.length - 1 ] = `${ theme.fg( 'accent', '→' ) } ${ display }`;
		}

		const question = this.optionPickerQuestion
			? '\n' + theme.bold( this.optionPickerQuestion ) + '\n'
			: '';
		this.optionPickerContainer.addChild( new Text( question + lines.join( '\n' ), 1, 0 ) );
		this.tui.requestRender();
	}

	private echoAnsweredQuestion( question: string, answer: string ): void {
		this.messages.addChild(
			new Text(
				'\n' + theme.bold( question ) + '\n' + theme.fg( 'accent', '→' ) + ' ' + answer,
				1,
				0
			)
		);
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
		this.optionPickerQuestion = '';
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
		void refineStudioTheme( this.tui ).then( ( changed ) => {
			if ( changed ) {
				this.tui.requestRender( true );
			}
		} );
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

		const b = ( text: string ) => `\x1b[38;2;56;88;233m${ text }\x1b[39m`;

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
			theme.bold( 'WordPress Studio' ) + ( version ? theme.fg( 'muted', ` v${ version }` ) : '' ),
			theme.fg( 'muted', secondLine ),
			'',
			theme.fg( 'muted', theme.italic( __( 'Code is Poetry' ) ) ),
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
			line ? ' ' + theme.fg( 'muted', line ) : line
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
			new Text(
				'\n ' + theme.fg( 'warning', '⏺' ) + ' ' + theme.fg( 'warning', __( 'Interrupted' ) ),
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
					return (
						' ' + theme.bg( 'userMessageBg', theme.fg( 'userMessageText', '〉' + line + ' ' ) )
					);
				}
				return ' ' + theme.bg( 'userMessageBg', theme.fg( 'userMessageText', '  ' + line + ' ' ) );
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

		const formatted = formatToolOutputLines( [ theme.fg( 'muted', message ) ] );
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
		if ( this.hasExpandableOutput ) {
			hints.push( this.toolOutputExpanded ? __( 'ctrl+o collapse' ) : __( 'ctrl+o expand' ) );
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
		this.renderedToolResultIds.clear();
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
		this.renderedToolResultIds.clear();
		this.fallbackProgressText = null;
		this.updateHints();
		this.currentMarkdown = null;
		this.currentResponseText = '';
	}

	/**
	 * Returns true when the current/last turn surfaced a quota refusal
	 * notice — the usage cap or out-of-credits — to the user. Lets callers
	 * suppress redundant downstream errors (e.g. the SDK's "process exited
	 * with code 1" that follows the upstream 429/402).
	 */
	hasErrorBeenSurfaced(): boolean {
		return this.usageCapReached;
	}

	// Follows the usage-cap notice with the date the monthly limit resets,
	// fetched from the WordPress.com quota endpoint. Silently skips when
	// signed out, the quota can't be fetched, or the server no longer reports a
	// reset date — the cap notice on its own is already actionable.
	private async showUsageCapResetDate(): Promise< void > {
		const token = await readAuthToken();
		if ( ! token?.accessToken ) {
			return;
		}
		const quota = await fetchStudioAssistantQuota( token.accessToken );
		if ( ! quota?.costResetDate ) {
			return;
		}
		this.showInfo(
			sprintf(
				/* translators: %s: date the monthly AI usage limit resets (e.g. August 1, 2026). */
				__( 'It resets on %s.' ),
				formatQuotaResetDate( quota.costResetDate )
			)
		);
	}

	// Shows the end-of-turn stats line immediately, then appends the remaining
	// AI credit balance in place once the WordPress.com quota endpoint answers.
	private showTurnStats( stats: string ): void {
		const line = new Text( '\n' + theme.fg( 'muted', stats ) + '\n', 1, 0 );
		this.messages.addChild( line );
		this.tui.requestRender();
		void this.appendRemainingCredits( line, stats );
	}

	private async appendRemainingCredits( line: Text, stats: string ): Promise< void > {
		if ( this.replayMode || this.currentProvider !== 'wpcom' ) {
			return;
		}
		const token = await readAuthToken();
		if ( ! token?.accessToken ) {
			return;
		}
		const quota = await fetchStudioAssistantQuota( token.accessToken );
		const remaining = quota ? getTotalRemainingAiCredits( quota ) : undefined;
		if ( remaining === undefined ) {
			return;
		}
		const credits = sprintf(
			/* translators: %s: total number of AI credits remaining (e.g. 1,110,000). */
			__( '%s credits left' ),
			new Intl.NumberFormat().format( remaining )
		);
		line.setText( '\n' + theme.fg( 'muted', `${ stats } · ${ credits }` ) + '\n' );
		this.tui.requestRender();
	}

	showOnboarding(): void {
		const text =
			' ' +
			theme.fg( 'accent', '⏺' ) +
			' ' +
			sprintf(
				/* translators: %s: product name (WordPress Studio) */
				__( "Hello, I'm %s, your local WordPress agent and builder." ),
				theme.bold( 'WordPress Studio' )
			);

		this.messages.addChild( new Text( '\n' + text + '\n', 0, 0 ) );
		this.tui.requestRender();
	}

	showCapabilities(): void {
		const b = ( text: string ) => theme.bold( text );
		const d = ( text: string ) => theme.fg( 'muted', text );
		const separator = d( ' ─'.padEnd( 80, '─' ) );
		// Applies bold styling to any <b>…</b> tags in a translated string, then
		// strips the tags. Translators can place <b> anywhere in the sentence.
		const applyBold = ( str: string ) =>
			str.replace( /<b>(.*?)<\/b>/g, ( _, text: string ) => b( text ) );

		const lines = [
			' ' +
				theme.fg( 'accent', '⏺' ) +
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
			'  ' + d( theme.italic( __( '"Create a portfolio site for a photographer"' ) ) ),
			'  ' + d( theme.italic( __( '"Build a landing page for a SaaS product"' ) ) ),
			'  ' + d( theme.italic( __( '"Make a blog for a coffee shop"' ) ) ),
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
		this.messages.addChild(
			new Text( '\n ' + theme.fg( 'success', '⏺' ) + ' ' + message + '\n', 0, 0 )
		);
		this.tui.requestRender();
	}

	showError( message: string ): void {
		this.messages.addChild(
			new Text(
				'\n ' + theme.fg( 'error', '⏺' ) + ' ' + theme.fg( 'error', message ) + '\n',
				0,
				0
			)
		);
		this.tui.requestRender();
	}

	showInfo( message: string ): void {
		this.messages.addChild( new Text( '\n' + theme.fg( 'muted', message ) + '\n', 1, 0 ) );
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

	// Live turns render results at `tool_execution_end`; this covers the rest
	// (replayed sessions and results with no execution event).
	renderToolResults( results: readonly ToolResultMessage[] ): void {
		for ( const toolResult of results ) {
			const toolCallId = toolResult.toolCallId;
			if ( this.renderedToolResultIds.delete( toolCallId ) ) {
				continue;
			}
			let pending = this.pendingToolCalls.get( toolCallId );
			if ( ! pending ) {
				const component = this.createToolComponent( 'tool', toolCallId, {} );
				this.messages.addChild( component );
				pending = { component, toolName: 'tool', input: {} };
			} else {
				this.pendingToolCalls.delete( toolCallId );
			}
			this.applyToolResult( pending, {
				content: toolResult.content,
				details: toolResult.details,
				isError: toolResult.isError === true,
			} );
		}
		if ( results.length > 0 ) {
			this.currentMarkdown = null;
			this.currentResponseText = '';
		}
	}

	private createToolComponent(
		name: string,
		toolCallId: string,
		input: Record< string, unknown >
	): ToolExecutionComponent {
		const component = new ToolExecutionComponent(
			name,
			toolCallId,
			input,
			{ showImages: true, imageWidthCells: 60 },
			getToolRenderDefinition( name ),
			this.tui,
			STUDIO_SITES_ROOT
		);
		component.setArgsComplete();
		component.setExpanded( this.toolOutputExpanded );
		this.hasExpandableOutput = true;
		this.updateHints();
		return component;
	}

	private applyToolResult(
		pending: {
			component: ToolExecutionComponent;
			toolName: string;
			input: Record< string, unknown >;
		},
		result: { content: unknown; details?: unknown; isError: boolean }
	): void {
		pending.component.updateResult( result as never );
		if ( ! result.isError ) {
			void this.autoSelectSiteFromToolResult( pending.toolName, pending.input );
		}
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
			if ( q.options.length > 0 ) {
				this.hideEditor();
				this.optionPickerQuestion = q.question;
				// Use SelectList for option-based questions.
				// When allowFreeForm is true, append an "Other" option with inline input.
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

				this.showEditor();

				if ( ! selected ) {
					return answers;
				}
				answers[ q.question ] = selected;
				this.echoAnsweredQuestion( q.question, selected );
			} else {
				this.messages.addChild( new Text( '\n' + theme.bold( q.question ), 1, 0 ) );
				this.tui.requestRender();
				const answer = await this.waitForInput();
				if ( ! answer ) {
					return answers;
				}
				answers[ q.question ] = answer;
				this.messages.addChild( new Text( theme.fg( 'accent', '→' ) + ' ' + answer, 1, 0 ) );
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

				// Detect the WordPress.com proxy's quota refusals — the monthly
				// usage cap (429) and out-of-credits (402, STU-2236). pi-ai
				// surfaces both via `stopReason: 'error'` with the upstream body
				// in `errorMessage`. Out of credits gets its own copy: waiting
				// for the reset doesn't clear it — buying credits does.
				const outOfCredits = isOutOfCreditsError( message.errorMessage );
				if (
					message.stopReason === 'error' &&
					this.currentProvider === 'wpcom' &&
					( outOfCredits || isUsageCapError( message.errorMessage ) )
				) {
					this.hideLoader();
					this.usageCapReached = true;
					this.showError( outOfCredits ? formatOutOfCreditsNotice() : formatUsageCapNotice() );
					if ( outOfCredits ) {
						// The terminal can't render a link, so the URL goes on its own
						// line, as-is — it stays copyable and most terminals auto-link it.
						this.showInfo(
							__( 'Run /credits to see your balance and buy more, or use the link below:' )
						);
						this.showInfo( ADD_AI_CREDITS_URL );
					} else {
						// Async on purpose: the reset date needs a wpcom round trip
						// and must not block rendering the cap notice.
						void this.showUsageCapResetDate();
					}
					this.currentMarkdown = null;
					this.currentResponseText = '';
					return;
				}

				for ( const block of message.content ) {
					if ( block.type === 'text' ) {
						// An empty text block before tool calls would render a bare ⏺.
						if ( ! block.text.trim() ) {
							continue;
						}
						this.hideLoader();
						if ( ! this.currentMarkdown ) {
							this.currentResponseText = '';
							this.hasShownResponseMarker = false;
						}
						if ( ! this.hasShownResponseMarker ) {
							this.hasShownResponseMarker = true;
							this.currentMarkdown = new Markdown( '\n', 1, 0, getMarkdownTheme() );
							this.messages.addChild( this.currentMarkdown );
						}
						if ( this.currentResponseText && ! this.currentResponseText.endsWith( '\n' ) ) {
							this.currentResponseText += '\n';
						}
						this.currentResponseText += block.text;
						this.currentMarkdown!.setText(
							'\n' + theme.fg( 'accent', '⏺' ) + ' ' + this.currentResponseText
						);
						this.tui.requestRender();
					} else if ( block.type === 'toolCall' ) {
						const input = ( block.arguments ?? {} ) as Record< string, unknown >;
						const component = this.createToolComponent( block.name, block.id, input );
						this.messages.addChild( component );
						this.pendingToolCalls.set( block.id, { component, toolName: block.name, input } );
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
			case 'tool_execution_start': {
				this.pendingToolCalls.get( event.toolCallId )?.component.markExecutionStarted();
				return;
			}
			case 'tool_execution_update': {
				const pending = this.pendingToolCalls.get( event.toolCallId );
				if ( ! pending ) {
					return;
				}
				pending.component.updateResult(
					{ ...( event.partialResult as object ), isError: false } as never,
					true
				);
				this.tui.requestRender();
				return;
			}
			case 'tool_execution_end': {
				const pending = this.pendingToolCalls.get( event.toolCallId );
				if ( ! pending ) {
					return;
				}
				this.pendingToolCalls.delete( event.toolCallId );
				this.renderedToolResultIds.add( event.toolCallId );
				this.applyToolResult( pending, {
					content: ( event.result as { content?: unknown } | undefined )?.content ?? [],
					details: ( event.result as { details?: unknown } | undefined )?.details,
					isError: event.isError,
				} );
				return;
			}
			case 'auto_retry_start': {
				const reason = event.errorMessage.split( '\n' )[ 0 ].trim();
				if ( reason ) {
					this.showInfo( reason );
				}
				this.showLoader(
					sprintf(
						/* translators: 1: retry attempt number, 2: maximum retry attempts, 3: delay in seconds */
						__( 'Temporary provider error — retrying in %3$ds (attempt %1$d of %2$d)…' ),
						event.attempt,
						event.maxAttempts,
						Math.round( event.delayMs / 1000 )
					)
				);
				return;
			}
			case 'agent_end': {
				// Not final when willRetry: the session auto-retries the turn
				// after a backoff (`auto_retry_start` follows).
				if ( event.willRetry ) {
					return;
				}
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
						new Text( '\n ' + theme.fg( 'accent', '⏺' ) + ' ' + __( 'Done' ), 0, 0 )
					);
				}
				this.showTurnStats(
					sprintf(
						/* translators: 1: seconds spent thinking, 2: number of turns */
						_n( 'Thought for %1$ds · %2$d turn', 'Thought for %1$ds · %2$d turns', this.numTurns ),
						thinkingSec,
						this.numTurns
					)
				);
				return;
			}
			default:
				// agent_start / turn_start / message_start / message_update /
				// tool_execution_end / auto_retry_end — UI doesn't act on these
				// directly; pi events drive incremental state but the visible
				// transitions happen at message_end / turn_end / agent_end.
				return;
		}
	}
}
