import { Container, resetCapabilitiesCache, setCapabilities } from '@earendil-works/pi-tui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatUI } from 'cli/ai/ui';
import { openBrowser } from 'cli/lib/browser';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { isSiteRunning } from 'cli/lib/site-utils';

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
		ui.activeExpandablePreview = null;
		ui.queuedPrompts = [];

		ui.updateHints();

		expect( editor.hints ).not.toContain( 'esc to interrupt' );
	} );
} );

describe( 'AiChatUI mid-turn steering', () => {
	function createStubUi() {
		const ui = Object.create( AiChatUI.prototype ) as {
			submitMidTurn: ( text: string ) => void;
			queuedPrompts: string[];
			[ key: string ]: unknown;
		};
		ui.queuedPrompts = [];
		ui.renderQueuedContainer = vi.fn();
		ui.addUserMessage = vi.fn();
		return ui;
	}

	it( 'delivers mid-turn input to the running agent when steering succeeds', async () => {
		const ui = createStubUi();
		const steerCallback = vi.fn().mockResolvedValue( true );
		ui.steerCallback = steerCallback;

		ui.submitMidTurn( 'make the hero darker' );

		await vi.waitFor( () =>
			expect( ui.addUserMessage ).toHaveBeenCalledWith( 'make the hero darker' )
		);
		expect( steerCallback ).toHaveBeenCalledWith( 'make the hero darker' );
		expect( ui.queuedPrompts ).toEqual( [] );
	} );

	it( 'stages the prompt for the next turn when steering is rejected', async () => {
		const ui = createStubUi();
		ui.steerCallback = vi.fn().mockResolvedValue( false );

		ui.submitMidTurn( 'add a contact page' );

		await vi.waitFor( () => expect( ui.queuedPrompts ).toEqual( [ 'add a contact page' ] ) );
		expect( ui.addUserMessage ).not.toHaveBeenCalled();
	} );

	it( 'stages the prompt when steering fails', async () => {
		const ui = createStubUi();
		ui.steerCallback = vi.fn().mockRejectedValue( new Error( 'boom' ) );

		ui.submitMidTurn( 'add a contact page' );

		await vi.waitFor( () => expect( ui.queuedPrompts ).toEqual( [ 'add a contact page' ] ) );
		expect( ui.addUserMessage ).not.toHaveBeenCalled();
	} );

	it( 'stages the prompt when no steer callback is registered', () => {
		const ui = createStubUi();
		ui.steerCallback = null;

		ui.submitMidTurn( 'add a contact page' );

		expect( ui.queuedPrompts ).toEqual( [ 'add a contact page' ] );
		expect( ui.addUserMessage ).not.toHaveBeenCalled();
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
		ui.currentProvider = 'wpcom';
		ui.currentMarkdown = { setText: vi.fn() };
		ui.currentResponseText = 'previous content';
		ui.usageCapReached = false;

		ui.handleEvent(
			buildAssistantMessageEnd( {
				stopReason: 'error',
				errorMessage: 'API Error: 429 {"error":{"message":"You have exceeded your AI usage cap."}}',
			} )
		);

		expect( hideLoader ).toHaveBeenCalled();
		expect( showError ).toHaveBeenCalledWith( expect.stringContaining( 'AI usage cap reached' ) );
		expect( showInfo ).toHaveBeenCalledWith( expect.stringContaining( '/provider' ) );
		expect( ui.usageCapReached ).toBe( true );
		expect( ui.currentMarkdown ).toBeNull();
		expect( ui.currentResponseText ).toBe( '' );
	} );

	it( 'renders each tool result directly under its matching tool row', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleEvent: ( e: unknown ) => unknown;
			[ key: string ]: unknown;
		};
		const messages = new Container();

		ui.messages = messages;
		ui.tui = { requestRender: vi.fn() };
		ui.pendingToolCalls = new Map();
		ui.currentMarkdown = null;
		ui.currentResponseText = '';
		ui.currentProvider = 'anthropic-api-key';
		ui.replayMode = true;
		ui.loaderVisible = false;
		ui.autoSelectSiteFromToolResult = vi.fn();
		ui.nowMs = () => 0;
		ui.activeExpandablePreview = null;
		ui.updateHints = vi.fn();

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
		const ui = Object.create( AiChatUI.prototype ) as {
			handleEvent: ( e: unknown ) => unknown;
			[ key: string ]: unknown;
		};
		const messages = new Container();

		ui.messages = messages;
		ui.tui = { requestRender: vi.fn() };
		ui.pendingToolCalls = new Map();
		ui.currentMarkdown = null;
		ui.currentResponseText = '';
		ui.currentProvider = 'anthropic-api-key';
		ui.replayMode = true;
		ui.loaderVisible = false;
		ui.autoSelectSiteFromToolResult = vi.fn();
		ui.nowMs = () => 0;
		ui.activeExpandablePreview = null;
		ui.updateHints = vi.fn();

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
		expect( joined ).toContain( 'Run npm test' );
		expect( joined ).toContain( 'Command completed: 2 tests passed' );
		expect( joined ).toContain( 'Command output hidden' );
		expect( joined ).toContain( 'Read theme/style.css' );
		expect( joined ).toContain( 'Read 2 lines' );
		expect( joined ).toContain( 'File contents hidden' );
		expect( joined ).not.toContain( '"posts"' );
		expect( joined ).not.toContain( '.wp-site-blocks' );
	} );

	it( 'attaches live progress to the active tool row before the final result', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleEvent: ( e: unknown ) => unknown;
			setLoaderMessage: ( message: string, update?: boolean ) => void;
			[ key: string ]: unknown;
		};
		const messages = new Container();

		ui.messages = messages;
		ui.tui = { requestRender: vi.fn() };
		ui.pendingToolCalls = new Map();
		ui.currentMarkdown = null;
		ui.currentResponseText = '';
		ui.currentProvider = 'anthropic-api-key';
		ui.replayMode = true;
		ui.loaderVisible = false;
		ui.autoSelectSiteFromToolResult = vi.fn();
		ui.nowMs = () => 6500;
		ui.activeExpandablePreview = null;
		ui.updateHints = vi.fn();
		ui.fallbackProgressText = null;

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

		ui.setLoaderMessage( 'Validating site configuration…' );
		ui.setLoaderMessage( 'Site configuration validated' );
		ui.setLoaderMessage( 'Starting WordPress server…' );
		ui.setLoaderMessage( 'Starting WordPress server…' );
		ui.setLoaderMessage( 'WordPress server started' );

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
} );

describe( 'AiChatUI.renderToolResultImages', () => {
	// 1x1 transparent PNG.
	const TINY_PNG =
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

	function createUiStub() {
		const ui = Object.create( AiChatUI.prototype ) as {
			renderToolResultImages: ( result: unknown, target: Container ) => void;
			[ key: string ]: unknown;
		};
		ui.tui = { requestRender: vi.fn() };
		return ui;
	}

	afterEach( () => {
		resetCapabilitiesCache();
	} );

	it( 'renders image blocks inline when the terminal supports an image protocol', () => {
		setCapabilities( { images: 'iterm2', trueColor: true, hyperlinks: true } );
		const ui = createUiStub();
		const target = new Container();

		ui.renderToolResultImages(
			{ content: [ { type: 'image', data: TINY_PNG, mimeType: 'image/png' } ] },
			target
		);

		expect( target.render( 120 ).join( '\n' ) ).toContain( '1337;File=' );
	} );

	it( 'renders nothing when the terminal has no image protocol', () => {
		setCapabilities( { images: null, trueColor: false, hyperlinks: false } );
		const ui = createUiStub();
		const target = new Container();

		ui.renderToolResultImages(
			{ content: [ { type: 'image', data: TINY_PNG, mimeType: 'image/png' } ] },
			target
		);

		expect( target.render( 120 ) ).toHaveLength( 0 );
	} );

	it( 'skips non-PNG images on kitty-protocol terminals', () => {
		setCapabilities( { images: 'kitty', trueColor: true, hyperlinks: true } );
		const ui = createUiStub();
		const target = new Container();

		ui.renderToolResultImages(
			{ content: [ { type: 'image', data: TINY_PNG, mimeType: 'image/jpeg' } ] },
			target
		);

		expect( target.render( 120 ) ).toHaveLength( 0 );
	} );
} );

describe( 'AiChatUI.getToolResultContent', () => {
	it( 'strips legacy media widget payload lines from replayed tool results', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			getToolResultContent: ( result: unknown ) => {
				content: Array< { type: string; text?: string } >;
			};
		};

		const result = ui.getToolResultContent( {
			content: [
				{
					type: 'text',
					text: 'Screenshot captured — desktop.\nmediaWidgetPayload={"type":"media"}',
				},
			],
		} );

		expect( result.content[ 0 ].text ).toBe( 'Screenshot captured — desktop.' );
	} );
} );
