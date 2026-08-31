import { initTheme, ToolExecutionComponent } from '@earendil-works/pi-coding-agent';
import { Container } from '@earendil-works/pi-tui';
import { readAuthToken } from '@studio/common/lib/shared-config';
import {
	ADD_AI_CREDITS_URL,
	fetchStudioAssistantQuota,
} from '@studio/common/lib/studio-assistant-quota';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toolResultRenderers } from 'cli/ai/tool-result-renderers';
import { AiChatUI } from 'cli/ai/ui';
import { openBrowser } from 'cli/lib/browser';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { isSiteRunning } from 'cli/lib/site-utils';

initTheme();

const ANSI_PATTERN = new RegExp( String.fromCharCode( 27 ) + '\\[[0-9;]*m', 'g' );

function stripAnsi( text: string ): string {
	return text.replace( ANSI_PATTERN, '' );
}

function renderedContainerText( container: Container ): string {
	return stripAnsi( container.render( 120 ).join( '\n' ) );
}

vi.mock( 'cli/lib/cli-config/core', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('cli/lib/cli-config/core') >();
	return {
		...actual,
		readCliConfig: vi.fn(),
	};
} );

vi.mock( 'cli/lib/cli-config/sites', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('cli/lib/cli-config/sites') >();
	return {
		...actual,
		getSiteUrl: vi.fn(),
	};
} );

vi.mock( 'cli/lib/browser', () => ( {
	openBrowser: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/shared-config', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@studio/common/lib/shared-config') >();
	return {
		...actual,
		readAuthToken: vi.fn(),
	};
} );

vi.mock( '@studio/common/lib/studio-assistant-quota', async ( importOriginal ) => {
	const actual =
		await importOriginal< typeof import('@studio/common/lib/studio-assistant-quota') >();
	return {
		...actual,
		fetchStudioAssistantQuota: vi.fn(),
	};
} );

vi.mock( 'cli/lib/site-utils', () => ( {
	isSiteRunning: vi.fn(),
} ) );

describe( 'AiChatUI.openActiveSiteInBrowser', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'opens the restored active site when activeSiteData is missing', async () => {
		const restoredSite = {
			name: 'my-site',
			path: '/Users/test/Studio/my-site',
			running: false,
		};

		const siteData = {
			name: 'my-site',
			path: '/Users/test/Studio/my-site',
			port: 8080,
		};

		const ui = Object.create( AiChatUI.prototype ) as {
			openActiveSiteInBrowser: () => Promise< boolean >;
			[ key: string ]: unknown;
		};
		ui._activeSite = restoredSite;
		ui._activeSiteData = null;

		vi.mocked( readCliConfig ).mockResolvedValue( {
			sites: [ siteData ],
		} as never );
		vi.mocked( getSiteUrl ).mockReturnValue( 'http://localhost:8080' );

		const opened = await ui.openActiveSiteInBrowser();

		expect( opened ).toBe( true );
		expect( readCliConfig ).toHaveBeenCalledTimes( 1 );
		expect( openBrowser ).toHaveBeenCalledWith( 'http://localhost:8080' );
		expect( ui._activeSiteData ).toEqual( siteData );
	} );
} );

describe( 'AiChatUI auto site selection', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	function createUiStub() {
		const ui = Object.create( AiChatUI.prototype ) as {
			autoSelectSiteFromToolResult: (
				toolName: string,
				toolInput: Record< string, unknown >
			) => Promise< void >;
			setActiveSite: (
				site: { name: string; path: string; running: boolean },
				options?: { announce?: boolean; emitEvent?: boolean }
			) => void;
			[ key: string ]: unknown;
		};
		ui._activeSite = null;
		ui._activeSiteData = null;
		ui.editor = { activeSiteName: null, invalidate: vi.fn() };
		ui.messages = { addChild: vi.fn() };
		ui.tui = { requestRender: vi.fn() };
		ui.siteSelectedCallback = vi.fn();
		return ui;
	}

	it( 'selects a created site after site_create succeeds', async () => {
		const ui = createUiStub();
		const siteData = {
			name: 'toto',
			path: '/Users/test/Studio/toto',
			port: 8881,
		};

		vi.mocked( readCliConfig ).mockResolvedValue( {
			sites: [ siteData ],
		} as never );
		vi.mocked( isSiteRunning ).mockResolvedValue( false );

		await ui.autoSelectSiteFromToolResult( 'site_create', { name: 'toto' } );

		expect( ui._activeSite ).toMatchObject( {
			name: 'toto',
			path: '/Users/test/Studio/toto',
			running: true,
		} );
		expect( ui.siteSelectedCallback ).toHaveBeenCalledWith(
			expect.objectContaining( { name: 'toto', path: '/Users/test/Studio/toto', running: true } )
		);
	} );

	it( 'selects the acted-on site after site_stop succeeds', async () => {
		const ui = createUiStub();
		const siteData = {
			name: 'tata',
			path: '/Users/test/Studio/tata',
			port: 8882,
		};
		ui._activeSite = {
			name: 'other-site',
			path: '/Users/test/Studio/other-site',
			running: true,
		};

		vi.mocked( readCliConfig ).mockResolvedValue( {
			sites: [ siteData ],
		} as never );
		vi.mocked( isSiteRunning ).mockResolvedValue( true );

		await ui.autoSelectSiteFromToolResult( 'site_stop', { nameOrPath: 'tata' } );

		expect( ui._activeSite ).toMatchObject( {
			name: 'tata',
			path: '/Users/test/Studio/tata',
			running: false,
		} );
		expect( ui.editor ).toMatchObject( { activeSiteName: 'tata' } );
		expect( ui.siteSelectedCallback ).toHaveBeenCalledWith(
			expect.objectContaining( { name: 'tata', path: '/Users/test/Studio/tata', running: false } )
		);
	} );
} );

describe( 'AiChatUI interrupt handling', () => {
	it( 'centralizes ESC interruption cleanup and only calls the interrupt callback once', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			requestInterrupt: () => boolean;
			[ key: string ]: unknown;
		};
		const interruptCallback = vi.fn();
		const submitResolve = vi.fn();

		ui.interruptCallback = interruptCallback;
		ui.wasInterrupted = false;
		ui.closeSitePicker = vi.fn();
		ui.cancelOptionPicker = vi.fn();
		ui.showInterruptedNotice = vi.fn();
		ui.submitResolve = submitResolve;
		ui.updateHints = vi.fn();

		expect( ui.requestInterrupt() ).toBe( true );
		expect( ui.wasInterrupted ).toBe( true );
		expect( ui.closeSitePicker ).toHaveBeenCalledTimes( 1 );
		expect( ui.cancelOptionPicker ).toHaveBeenCalledTimes( 1 );
		expect( submitResolve ).toHaveBeenCalledWith( '' );
		expect( ui.showInterruptedNotice ).toHaveBeenCalledTimes( 1 );
		expect( interruptCallback ).toHaveBeenCalledTimes( 1 );

		expect( ui.requestInterrupt() ).toBe( true );
		expect( interruptCallback ).toHaveBeenCalledTimes( 1 );
		expect( ui.showInterruptedNotice ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not advertise ESC as interrupt when no interrupt callback is active', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			updateHints: () => void;
			[ key: string ]: unknown;
		};
		const editor = { hints: [] as string[] };

		ui.editor = editor;
		ui.interruptCallback = null;
		ui._inAgentTurn = false;
		ui.hasExpandableOutput = false;
		ui.queuedPrompts = [];

		ui.updateHints();

		expect( editor.hints ).not.toContain( 'esc to interrupt' );
	} );
} );

describe( 'AiChatUI.handleEvent', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	const buildAssistantMessageEnd = (
		overrides: {
			text?: string;
			errorMessage?: string;
			stopReason?: 'stop' | 'error' | 'aborted' | 'toolUse' | 'length';
		} = {}
	) => ( {
		type: 'message_end' as const,
		message: {
			role: 'assistant' as const,
			content: overrides.text ? [ { type: 'text' as const, text: overrides.text } ] : [],
			api: 'anthropic-messages',
			provider: 'anthropic',
			model: 'claude',
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: overrides.stopReason ?? 'stop',
			errorMessage: overrides.errorMessage,
			timestamp: 0,
		},
	} );

	it( 'surfaces the cap message when an assistant error carries a 429 marker', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleEvent: ( e: unknown ) => unknown;
			[ key: string ]: unknown;
		};
		const hideLoader = vi.fn();
		const showError = vi.fn();
		const showInfo = vi.fn();

		ui.hideLoader = hideLoader;
		ui.showError = showError;
		ui.showInfo = showInfo;
		ui.showUsageCapResetDate = vi.fn( async () => undefined );
		ui.currentProvider = 'wpcom';
		ui.currentMarkdown = { setText: vi.fn() };
		ui.currentResponseText = 'previous content';
		ui.usageCapReached = false;

		ui.handleEvent(
			buildAssistantMessageEnd( {
				stopReason: 'error',
				errorMessage: 'Monthly usage limit reached: 429 {"error":{"type":"rate_limit_error"}}',
			} )
		);

		expect( hideLoader ).toHaveBeenCalled();
		expect( showError ).toHaveBeenCalledWith(
			expect.stringContaining( 'You’ve reached your monthly AI usage limit' )
		);
		expect( showInfo ).not.toHaveBeenCalled();
		expect( ui.showUsageCapResetDate ).toHaveBeenCalled();
		expect( ui.usageCapReached ).toBe( true );
		expect( ui.currentMarkdown ).toBeNull();
		expect( ui.currentResponseText ).toBe( '' );
	} );

	// STU-2236: distinct copy — no "try again later"/reset-date framing, and no
	// reset-date fetch, because only buying credits clears this state.
	it( 'surfaces the out-of-credits message when an assistant error carries the 402 marker', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleEvent: ( e: unknown ) => unknown;
			[ key: string ]: unknown;
		};
		const hideLoader = vi.fn();
		const showError = vi.fn();
		const showInfo = vi.fn();

		ui.hideLoader = hideLoader;
		ui.showError = showError;
		ui.showInfo = showInfo;
		ui.showUsageCapResetDate = vi.fn( async () => undefined );
		ui.currentProvider = 'wpcom';
		ui.currentMarkdown = { setText: vi.fn() };
		ui.currentResponseText = 'previous content';
		ui.usageCapReached = false;

		ui.handleEvent(
			buildAssistantMessageEnd( {
				stopReason: 'error',
				errorMessage:
					'402 {"code":"studio_out_of_credits","message":"studio_out_of_credits: You\'ve used your free monthly AI allowance and have no credits left. Buy credits in WordPress Studio to continue.","data":{"status":402}}',
			} )
		);

		expect( hideLoader ).toHaveBeenCalled();
		expect( showError ).toHaveBeenCalledWith(
			expect.stringContaining( 'You’re out of AI credits' )
		);
		expect( showError ).not.toHaveBeenCalledWith(
			expect.stringContaining( 'monthly AI usage limit' )
		);
		expect( showInfo ).toHaveBeenCalledWith( 'Use /credits to see your balance and buy more.' );
		// No direct checkout URL here — /credits is the single entry point, so
		// the user sees every top-up option instead of one preset quantity.
		expect( showInfo ).not.toHaveBeenCalledWith( ADD_AI_CREDITS_URL );
		expect( ui.showUsageCapResetDate ).not.toHaveBeenCalled();
		expect( ui.usageCapReached ).toBe( true );
		expect( ui.currentMarkdown ).toBeNull();
		expect( ui.currentResponseText ).toBe( '' );
	} );

	const makeRenderUi = ( nowMs = 0 ) => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleEvent: ( e: unknown ) => unknown;
			[ key: string ]: unknown;
		};
		const messages = new Container();
		Object.assign( ui, {
			messages,
			tui: { requestRender: vi.fn() },
			pendingToolCalls: new Map(),
			renderedToolResultIds: new Set(),
			currentMarkdown: null,
			currentResponseText: '',
			currentProvider: 'anthropic-api-key',
			replayMode: true,
			loaderVisible: false,
			autoSelectSiteFromToolResult: vi.fn(),
			nowMs: () => nowMs,
			toolOutputExpanded: false,
			updateHints: vi.fn(),
			fallbackProgressText: null,
		} );
		return { ui, messages };
	};

	it( 'renders each tool result directly under its matching tool row', () => {
		const { ui, messages } = makeRenderUi();

		ui.handleEvent( {
			type: 'message_end',
			message: {
				role: 'assistant',
				content: [
					{
						type: 'toolCall',
						id: 'toolu_remote',
						name: 'Skill',
						arguments: { name: 'wpcom-remote-management' },
					},
					{
						type: 'toolCall',
						id: 'toolu_design',
						name: 'Skill',
						arguments: { name: 'visual-design' },
					},
				],
			},
		} );

		ui.handleEvent( {
			type: 'turn_end',
			toolResults: [
				{
					toolCallId: 'toolu_remote',
					isError: false,
					content: [
						{
							type: 'text',
							text: '# WordPress.com Remote Management\n\n## Tool Shape\n\nUse wpcom_request.',
						},
					],
				},
				{
					toolCallId: 'toolu_design',
					isError: false,
					content: [
						{
							type: 'text',
							text: '# Visual Design\n\n## Design Direction\n\nPick a clear direction.',
						},
					],
				},
			],
		} );

		const renderedText = renderedContainerText( messages );
		const remoteRow = renderedText.indexOf( 'Load skill wpcom-remote-management' );
		const remoteSummary = renderedText.indexOf( 'Loaded WordPress.com Remote Management' );
		const remoteHidden = renderedText.indexOf( 'Full skill body hidden' );
		const designRow = renderedText.indexOf( 'Load skill visual-design' );
		const designSummary = renderedText.indexOf( 'Loaded Visual Design' );

		expect( remoteRow ).toBeGreaterThanOrEqual( 0 );
		expect( remoteSummary ).toBeGreaterThan( remoteRow );
		expect( remoteHidden ).toBeGreaterThan( remoteSummary );
		expect( designRow ).toBeGreaterThan( remoteHidden );
		expect( designSummary ).toBeGreaterThan( designRow );
		expect( renderedText ).toContain( 'Sections: Tool Shape' );
		expect( renderedText ).toContain( 'Sections: Design Direction' );
		expect( renderedText ).not.toContain( '# Visual Design' );
	} );

	it( 'renders concise summaries for API, Bash, and Read tool output', () => {
		const { ui, messages } = makeRenderUi();

		ui.handleEvent( {
			type: 'message_end',
			message: {
				role: 'assistant',
				content: [
					{
						type: 'toolCall',
						id: 'toolu_api',
						name: 'wpcom_request',
						arguments: { method: 'GET', path: '/posts' },
					},
					{
						type: 'toolCall',
						id: 'toolu_bash',
						name: 'Bash',
						arguments: { command: 'npm test' },
					},
					{
						type: 'toolCall',
						id: 'toolu_read',
						name: 'Read',
						arguments: { file_path: '/Users/test/Studio/site/theme/style.css' },
					},
				],
			},
		} );

		ui.handleEvent( {
			type: 'turn_end',
			toolResults: [
				{
					toolCallId: 'toolu_api',
					isError: false,
					content: [
						{
							type: 'text',
							text: JSON.stringify( { found: 2, posts: [ { id: 1 }, { id: 2 } ] } ),
						},
					],
				},
				{
					toolCallId: 'toolu_bash',
					isError: false,
					content: [ { type: 'text', text: '2 tests passed\nDuration 1s' } ],
				},
				{
					toolCallId: 'toolu_read',
					isError: false,
					content: [ { type: 'text', text: 'body {}\n.wp-site-blocks {}\n' } ],
				},
			],
		} );

		const joined = renderedContainerText( messages );

		expect( joined ).toContain( 'WordPress.com API GET /posts' );
		expect( joined ).toContain( 'GET /posts: Returned 2 posts' );
		expect( joined ).toContain( 'Full API response hidden' );
		expect( joined ).toContain( '$ npm test' );
		expect( joined ).toContain( '2 tests passed' );
		expect( joined ).toContain( 'style.css' );
		expect( joined ).not.toContain( '"posts"' );
		expect( joined ).not.toContain( '.wp-site-blocks' );
	} );

	const progressEvent = ( toolCallId: string, message: string, update?: boolean ) => ( {
		type: 'tool_execution_update',
		toolCallId,
		toolName: 'site_create',
		args: {},
		partialResult: { content: [], details: { studioProgress: { message, update } } },
	} );

	it( 'attaches live progress to the matching tool row before the final result', () => {
		const { ui, messages } = makeRenderUi( 6500 );

		ui.handleEvent( {
			type: 'message_end',
			message: {
				role: 'assistant',
				content: [
					{
						type: 'toolCall',
						id: 'toolu_create',
						name: 'site_create',
						arguments: { name: 'Auran' },
					},
				],
			},
		} );

		ui.handleEvent( progressEvent( 'toolu_create', 'Validating site configuration…' ) );
		ui.handleEvent( progressEvent( 'toolu_create', 'Site configuration validated' ) );
		ui.handleEvent( progressEvent( 'toolu_create', 'Starting WordPress server…' ) );
		ui.handleEvent( progressEvent( 'toolu_create', 'Starting WordPress server…' ) );
		ui.handleEvent( progressEvent( 'toolu_create', 'WordPress server started' ) );

		ui.handleEvent( {
			type: 'turn_end',
			toolResults: [
				{
					toolCallId: 'toolu_create',
					isError: false,
					content: [
						{
							type: 'text',
							text: JSON.stringify(
								{
									id: 'site-id',
									name: 'Auran',
									url: 'http://localhost:8887',
								},
								null,
								2
							),
						},
					],
				},
			],
		} );

		const renderedText = renderedContainerText( messages );
		const row = renderedText.indexOf( 'Create site Auran' );
		const firstProgress = renderedText.indexOf( 'Validating site configuration' );
		const lastProgress = renderedText.indexOf( 'WordPress server started' );
		const result = renderedText.indexOf( 'Created site Auran' );

		expect( row ).toBeGreaterThanOrEqual( 0 );
		expect( firstProgress ).toBeGreaterThan( row );
		expect( lastProgress ).toBeGreaterThan( firstProgress );
		expect( result ).toBeGreaterThan( lastProgress );
		expect( renderedText ).toContain( 'http://localhost:8887' );
		expect( renderedText ).toContain( 'Full site details hidden' );
		expect( renderedText ).not.toContain( '"name": "Auran"' );
		expect( renderedText.match( /Starting WordPress server/g ) ).toHaveLength( 1 );
	} );

	it( 'routes interleaved progress from parallel tool calls to their own rows', () => {
		const { ui, messages } = makeRenderUi( 1000 );

		ui.handleEvent( {
			type: 'message_end',
			message: {
				role: 'assistant',
				content: [
					{
						type: 'toolCall',
						id: 'toolu_one',
						name: 'site_create',
						arguments: { name: 'Alpha' },
					},
					{
						type: 'toolCall',
						id: 'toolu_two',
						name: 'site_create',
						arguments: { name: 'Beta' },
					},
				],
			},
		} );

		ui.handleEvent( progressEvent( 'toolu_one', 'Validating Alpha…' ) );
		ui.handleEvent( progressEvent( 'toolu_two', 'Validating Beta…' ) );
		ui.handleEvent( progressEvent( 'toolu_one', 'Alpha server started' ) );
		ui.handleEvent( progressEvent( 'toolu_two', 'Beta server started' ) );

		const renderedText = renderedContainerText( messages );
		const alphaRow = renderedText.indexOf( 'Create site Alpha' );
		const alphaProgress = renderedText.indexOf( 'Validating Alpha…' );
		const alphaDone = renderedText.indexOf( 'Alpha server started' );
		const betaRow = renderedText.indexOf( 'Create site Beta' );
		const betaProgress = renderedText.indexOf( 'Validating Beta…' );
		const betaDone = renderedText.indexOf( 'Beta server started' );

		expect( alphaRow ).toBeGreaterThanOrEqual( 0 );
		expect( alphaProgress ).toBeGreaterThan( alphaRow );
		expect( alphaDone ).toBeGreaterThan( alphaProgress );
		expect( betaRow ).toBeGreaterThan( alphaDone );
		expect( betaProgress ).toBeGreaterThan( betaRow );
		expect( betaDone ).toBeGreaterThan( betaProgress );
	} );

	it( 'collapses long progress to the last lines and expands on toggle', () => {
		const { ui, messages } = makeRenderUi();

		ui.handleEvent( {
			type: 'message_end',
			message: {
				role: 'assistant',
				content: [ { type: 'toolCall', id: 'toolu_start', name: 'site_start', arguments: {} } ],
			},
		} );
		for ( let i = 1; i <= 6; i++ ) {
			ui.handleEvent( progressEvent( 'toolu_start', `step ${ i }` ) );
		}

		const collapsed = renderedContainerText( messages );
		expect( collapsed ).toContain( 'step 6' );
		expect( collapsed ).toContain( 'step 3' );
		expect( collapsed ).not.toContain( 'step 2' );
		expect( collapsed ).toContain( 'earlier lines' );

		for ( const child of messages.children ) {
			if ( child instanceof ToolExecutionComponent ) {
				child.setExpanded( true );
			}
		}
		const expanded = renderedContainerText( messages );
		expect( expanded ).toContain( 'step 1' );
		expect( expanded ).not.toContain( 'earlier lines' );
	} );

	it( 'renders a result at tool_execution_end without duplicating it at turn_end', () => {
		const { ui, messages } = makeRenderUi( 1000 );

		ui.handleEvent( {
			type: 'message_end',
			message: {
				role: 'assistant',
				content: [
					{ type: 'toolCall', id: 'toolu_bash', name: 'Bash', arguments: { command: 'ls' } },
				],
			},
		} );
		ui.handleEvent( {
			type: 'tool_execution_end',
			toolCallId: 'toolu_bash',
			toolName: 'Bash',
			result: { content: [ { type: 'text', text: 'file-a.txt' } ] },
			isError: false,
		} );
		ui.handleEvent( {
			type: 'turn_end',
			toolResults: [
				{
					toolCallId: 'toolu_bash',
					isError: false,
					content: [ { type: 'text', text: 'file-a.txt' } ],
				},
			],
		} );

		const renderedText = renderedContainerText( messages );
		expect( renderedText.match( /file-a\.txt/g ) ).toHaveLength( 1 );
	} );

	it( 'shows the tail of long Bash output and expands every block on toggle', () => {
		const { ui, messages } = makeRenderUi();

		ui.handleEvent( {
			type: 'message_end',
			message: {
				role: 'assistant',
				content: [
					{ type: 'toolCall', id: 'toolu_bash', name: 'Bash', arguments: { command: 'npm test' } },
					{
						type: 'toolCall',
						id: 'toolu_skill',
						name: 'Skill',
						arguments: { name: 'visual-design' },
					},
				],
			},
		} );
		ui.handleEvent( {
			type: 'turn_end',
			toolResults: [
				{
					toolCallId: 'toolu_bash',
					isError: false,
					content: [
						{ type: 'text', text: 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7' },
					],
				},
				{
					toolCallId: 'toolu_skill',
					isError: false,
					content: [ { type: 'text', text: '# Visual Design\n\nPick a clear direction.' } ],
				},
			],
		} );

		const collapsed = renderedContainerText( messages );
		expect( collapsed ).toContain( 'earlier lines' );
		expect( collapsed ).toContain( 'line 7' );
		expect( collapsed ).not.toContain( 'line 1' );
		expect( collapsed ).toContain( 'Full skill body hidden' );

		for ( const child of messages.children ) {
			if ( child instanceof ToolExecutionComponent ) {
				child.setExpanded( true );
			}
		}

		const expanded = renderedContainerText( messages );
		expect( expanded ).toContain( 'line 1' );
		expect( expanded ).not.toContain( 'earlier lines' );
		expect( expanded ).toContain( 'Pick a clear direction.' );
	} );

	it( 'fully strips rendered HTML tags that recombine after a single pass', () => {
		const rendered = toolResultRenderers.wpcom_request(
			{
				input: { method: 'GET', path: '/sites/1/posts/1' },
				text: JSON.stringify( {
					title: { rendered: '<scr<script>ipt>alert(1)</scr</script>ipt>' },
				} ),
				isError: false,
			},
			false
		);

		expect( stripAnsi( rendered ?? '' ) ).not.toContain( '<' );
	} );

	it( 'does not trigger cap detection for non-wpcom providers even with a 429 error', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleEvent: ( e: unknown ) => unknown;
			[ key: string ]: unknown;
		};
		const showError = vi.fn();
		const showInfo = vi.fn();
		const addChild = vi.fn();
		const requestRender = vi.fn();

		ui.hideLoader = vi.fn();
		ui.showError = showError;
		ui.showInfo = showInfo;
		ui.currentProvider = 'anthropic-api-key';
		ui.currentMarkdown = null;
		ui.currentResponseText = '';
		ui.usageCapReached = false;
		ui.hasShownResponseMarker = false;
		ui.messages = { addChild };
		ui.tui = { requestRender };
		ui.replayMode = true;

		ui.handleEvent(
			buildAssistantMessageEnd( {
				stopReason: 'error',
				errorMessage: 'API Error: 429 {"error":{"message":"cap"}}',
			} )
		);

		expect( showError ).not.toHaveBeenCalled();
		expect( showInfo ).not.toHaveBeenCalled();
		expect( ui.usageCapReached ).toBe( false );
	} );

	it( 'skips the "Done" success indicator when the usage cap was reached', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleEvent: ( e: unknown ) => unknown;
			[ key: string ]: unknown;
		};
		const addChild = vi.fn();
		const showInfo = vi.fn();

		ui.hideLoader = vi.fn();
		ui.showInfo = showInfo;
		ui.usageCapReached = true;
		ui.hasShownResponseMarker = false;
		ui.nowMs = () => 5000;
		ui.turnStartTime = 0;
		ui.numTurns = 1;
		ui.messages = { addChild };

		ui.handleEvent( {
			type: 'agent_end',
			messages: [],
		} );

		expect( addChild ).not.toHaveBeenCalled();
		expect( showInfo ).not.toHaveBeenCalled();
	} );

	it( 'keeps the turn alive on agent_end when the session will auto-retry', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleEvent: ( e: unknown ) => unknown;
			[ key: string ]: unknown;
		};
		ui.hideLoader = vi.fn();
		ui.showError = vi.fn();

		ui.handleEvent( { type: 'agent_end', willRetry: true, messages: [] } );

		expect( ui.hideLoader ).not.toHaveBeenCalled();
		expect( ui.showError ).not.toHaveBeenCalled();
	} );

	it( 'shows a retry loader message on auto_retry_start', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleEvent: ( e: unknown ) => unknown;
			[ key: string ]: unknown;
		};
		ui.showLoader = vi.fn();
		ui.showInfo = vi.fn();

		ui.handleEvent( {
			type: 'auto_retry_start',
			attempt: 2,
			maxAttempts: 3,
			delayMs: 4000,
			errorMessage: 'API Error: 529 overloaded\nsecond line',
		} );

		expect( ui.showInfo ).toHaveBeenCalledWith( 'API Error: 529 overloaded' );
		expect( ui.showLoader ).toHaveBeenCalledWith(
			'Temporary provider error — retrying in 4s (attempt 2 of 3)…'
		);
	} );

	it( 'does not trip the cap branch when an assistant error has no 429 marker', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleEvent: ( e: unknown ) => unknown;
			[ key: string ]: unknown;
		};
		const showError = vi.fn();
		const showInfo = vi.fn();

		ui.hideLoader = vi.fn();
		ui.showError = showError;
		ui.showInfo = showInfo;
		ui.currentProvider = 'wpcom';
		ui.currentMarkdown = null;
		ui.currentResponseText = '';
		ui.usageCapReached = false;
		ui.replayMode = true;
		ui.loaderVisible = true;

		ui.handleEvent(
			buildAssistantMessageEnd( { stopReason: 'error', errorMessage: 'something else' } )
		);

		expect( showError ).not.toHaveBeenCalled();
		expect( showInfo ).not.toHaveBeenCalled();
		expect( ui.usageCapReached ).toBe( false );
	} );

	it( 'strips legacy media widget payload lines from tool results', () => {
		const { ui, messages } = makeRenderUi();
		ui.handleEvent( {
			type: 'message_end',
			message: {
				role: 'assistant',
				content: [ { type: 'toolCall', id: 'toolu_shot', name: 'take_screenshot', arguments: {} } ],
			},
		} );
		ui.handleEvent( {
			type: 'turn_end',
			toolResults: [
				{
					toolCallId: 'toolu_shot',
					isError: false,
					content: [
						{
							type: 'text',
							text: 'Screenshot captured — desktop.\nmediaWidgetPayload={"type":"media"}',
						},
					],
				},
			],
		} );

		const joined = renderedContainerText( messages );
		expect( joined ).toContain( 'Screenshot captured' );
		expect( joined ).not.toContain( 'mediaWidgetPayload' );
	} );
} );

describe( 'AiChatUI.showTurnStats', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	const quota = ( overrides: Record< string, unknown > = {} ) =>
		( {
			costUsage: 5,
			costCap: 100,
			emailVerified: true,
			hasPaymentMethod: true,
			...overrides,
		} ) as never;

	function makeStatsUi( overrides: Record< string, unknown > = {} ) {
		const ui = Object.create( AiChatUI.prototype ) as {
			showTurnStats: ( stats: string ) => void;
			[ key: string ]: unknown;
		};
		const messages = new Container();
		Object.assign( ui, {
			messages,
			tui: { requestRender: vi.fn() },
			currentProvider: 'wpcom',
			replayMode: false,
			...overrides,
		} );
		return { ui, messages };
	}

	it( 'appends the remaining AI credit balance to the stats line', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( { accessToken: 'token' } as never );
		vi.mocked( fetchStudioAssistantQuota ).mockResolvedValue(
			quota( { allowanceRemaining: 100000, purchasedRemaining: 10000 } )
		);
		const { ui, messages } = makeStatsUi();

		ui.showTurnStats( 'Thought for 5s · 1 turn' );

		expect( renderedContainerText( messages ) ).toContain( 'Thought for 5s · 1 turn' );
		const formatted = new Intl.NumberFormat().format( 110000 );
		await vi.waitFor( () => {
			expect( renderedContainerText( messages ) ).toContain(
				`Thought for 5s · 1 turn · ${ formatted } credits left`
			);
		} );
	} );

	it( 'does not fetch the quota on the Anthropic API key provider', async () => {
		const { ui, messages } = makeStatsUi( { currentProvider: 'anthropic-api-key' } );

		ui.showTurnStats( 'Thought for 5s · 1 turn' );
		await new Promise( ( resolve ) => setImmediate( resolve ) );

		expect( readAuthToken ).not.toHaveBeenCalled();
		expect( fetchStudioAssistantQuota ).not.toHaveBeenCalled();
		expect( renderedContainerText( messages ) ).toContain( 'Thought for 5s · 1 turn' );
	} );

	it( 'keeps the bare stats line when the quota has no credit pools', async () => {
		vi.mocked( readAuthToken ).mockResolvedValue( { accessToken: 'token' } as never );
		vi.mocked( fetchStudioAssistantQuota ).mockResolvedValue( quota() );
		const { ui, messages } = makeStatsUi();

		ui.showTurnStats( 'Thought for 5s · 1 turn' );
		await vi.waitFor( () => {
			expect( fetchStudioAssistantQuota ).toHaveBeenCalled();
		} );
		await new Promise( ( resolve ) => setImmediate( resolve ) );

		expect( renderedContainerText( messages ) ).toContain( 'Thought for 5s · 1 turn' );
		expect( renderedContainerText( messages ) ).not.toContain( 'credits left' );
	} );
} );
