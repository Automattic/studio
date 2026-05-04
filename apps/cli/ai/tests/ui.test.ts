import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatUI } from 'cli/ai/ui';
import { openBrowser } from 'cli/lib/browser';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { isSiteRunning } from 'cli/lib/site-utils';

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

describe( 'AiChatUI.updateAutocompleteBasePath', () => {
	const LAUNCH_CWD = '/launch/cwd';

	function makeUi() {
		const calls: Array< { basePath: string | undefined } > = [];
		const ui = Object.create( AiChatUI.prototype ) as {
			updateAutocompleteBasePath: () => void;
			[ key: string ]: unknown;
		};
		ui.initialCwd = LAUNCH_CWD;
		ui._activeSite = null;
		ui.autocompleteBasePath = null;
		ui.editor = {
			activeSiteName: null,
			setAutocompleteProvider: ( provider: { basePath?: string } ) => {
				calls.push( { basePath: provider.basePath } );
			},
		};
		return { ui, calls };
	}

	it( 'scopes @-mention completion to the active local site path', () => {
		const { ui, calls } = makeUi();
		ui._activeSite = {
			name: 'my-site',
			path: '/Users/test/Studio/my-site',
			running: true,
		};
		ui.updateAutocompleteBasePath();
		expect( calls ).toHaveLength( 1 );
		expect( calls[ 0 ].basePath ).toBe( '/Users/test/Studio/my-site' );
	} );

	it( 'falls back to the launch cwd when no site is active', () => {
		const { ui, calls } = makeUi();
		ui.updateAutocompleteBasePath();
		expect( calls[ 0 ].basePath ).toBe( LAUNCH_CWD );
	} );

	it( 'falls back to the launch cwd for remote sites (no local files to complete)', () => {
		const { ui, calls } = makeUi();
		ui._activeSite = {
			name: 'remote-site',
			path: '',
			remote: true,
			running: true,
		};
		ui.updateAutocompleteBasePath();
		expect( calls[ 0 ].basePath ).toBe( LAUNCH_CWD );
	} );

	it( 'updates the basePath when the active site changes', () => {
		const { ui, calls } = makeUi();
		ui._activeSite = { name: 'a', path: '/Users/test/Studio/a', running: true };
		ui.updateAutocompleteBasePath();
		ui._activeSite = { name: 'b', path: '/Users/test/Studio/b', running: true };
		ui.updateAutocompleteBasePath();
		ui._activeSite = null;
		ui.updateAutocompleteBasePath();
		expect( calls.map( ( c ) => c.basePath ) ).toEqual( [
			'/Users/test/Studio/a',
			'/Users/test/Studio/b',
			LAUNCH_CWD,
		] );
	} );

	it( 'skips installing a fresh provider when the basePath is unchanged', () => {
		const { ui, calls } = makeUi();
		ui._activeSite = { name: 'a', path: '/Users/test/Studio/a', running: true };
		ui.updateAutocompleteBasePath();
		ui.updateAutocompleteBasePath();
		ui.updateAutocompleteBasePath();
		expect( calls ).toHaveLength( 1 );
	} );
} );

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
		ui.initialCwd = '/launch/cwd';
		ui.autocompleteBasePath = null;
		ui.editor = {
			activeSiteName: null,
			invalidate: vi.fn(),
			setAutocompleteProvider: vi.fn(),
		};
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

		await ui.autoSelectSiteFromToolResult( 'mcp__studio__site_create', { name: 'toto' } );

		expect( ui._activeSite ).toMatchObject( {
			name: 'toto',
			path: '/Users/test/Studio/toto',
			running: true,
		} );
		expect( ui.editor ).toMatchObject( { activeSiteName: 'toto' } );
		expect( ui.siteSelectedCallback ).toHaveBeenCalledWith(
			expect.objectContaining( { name: 'toto', path: '/Users/test/Studio/toto', running: true } )
		);
	} );

	it( 'selects a created site after the bare-name (OpenAI runtime) site_create succeeds', async () => {
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

		// pi-agent-core registers tools by their bare name (no MCP prefix).
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

		await ui.autoSelectSiteFromToolResult( 'mcp__studio__site_stop', { nameOrPath: 'tata' } );

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

	it( 'invalidates the prompt editor when selecting a site', () => {
		const ui = createUiStub();

		ui.setActiveSite( {
			name: 'Riad site',
			path: '/Users/test/Studio/riad-site',
			running: true,
		} );

		expect( ui.editor as { activeSiteName: string | null } ).toMatchObject( {
			activeSiteName: 'Riad site',
		} );
		expect(
			( ui.editor as { invalidate: ReturnType< typeof vi.fn > } ).invalidate
		).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'AiChatUI.clearTranscript', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'clears children, resets streaming state, and requests a render', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			clearTranscript: () => void;
			[ key: string ]: unknown;
		};

		const children: unknown[] = [ {}, {} ];
		const messages = {
			clear: vi.fn( () => {
				children.length = 0;
			} ),
			children,
		};
		const tui = { requestRender: vi.fn() };

		ui.messages = messages;
		ui.tui = tui;
		ui.currentMarkdown = { someMarkdown: true };
		ui.currentResponseText = 'in-progress';
		ui.hideLoader = vi.fn();
		ui.queuedPrompts = [];

		ui.clearTranscript();

		expect( ui.hideLoader ).toHaveBeenCalled();
		expect( messages.children ).toHaveLength( 0 );
		expect( ui.currentMarkdown ).toBeNull();
		expect( ui.currentResponseText ).toBe( '' );
		expect( tui.requestRender ).toHaveBeenCalledTimes( 1 );
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

describe( 'AiChatUI.handleMessage', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'falls back to the latest pending tool call when tool results have no parent id', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleMessage: ( message: unknown ) => void;
			[ key: string ]: unknown;
		};
		const showToolResult = vi.fn();

		ui.pendingToolCalls = new Map( [
			[
				'tool-1',
				{
					name: 'mcp__studio__site_stop',
					input: { nameOrPath: 'aura' },
				},
			],
		] );
		ui.pendingTodoRenders = new Map();
		ui.pendingTodoRenderOrder = [];
		ui.showTodoToolResult = vi.fn();
		ui.showToolResult = showToolResult;
		ui.currentMarkdown = null;
		ui.currentResponseText = '';

		ui.handleMessage( {
			type: 'user',
			parent_tool_use_id: null,
			tool_use_result: {
				content: 'Site "aura" stopped.',
			},
			message: {
				content: [],
			},
		} );

		expect( showToolResult ).toHaveBeenCalledWith(
			expect.objectContaining( { parent_tool_use_id: null } ),
			'mcp__studio__site_stop',
			{ nameOrPath: 'aura' }
		);
		expect( ui.pendingToolCalls ).toEqual( new Map() );
	} );

	it( 'surfaces the cap message when an assistant error contains an API Error: 429 text block', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleMessage: ( message: unknown ) => unknown;
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

		const result = ui.handleMessage( {
			type: 'assistant',
			error: 'unknown',
			message: {
				content: [
					{
						type: 'text',
						text: 'API Error: 429 {"error":{"message":"You have exceeded your AI usage cap."}}',
					},
				],
			},
			parent_tool_use_id: null,
			uuid: 'uuid',
			session_id: 'sess',
		} );

		expect( result ).toBeUndefined();
		expect( hideLoader ).toHaveBeenCalled();
		expect( showError ).toHaveBeenCalledWith( expect.stringContaining( 'AI usage cap reached' ) );
		expect( showInfo ).toHaveBeenCalledWith( expect.stringContaining( '/provider' ) );
		expect( ui.usageCapReached ).toBe( true );
		expect( ui.currentMarkdown ).toBeNull();
		expect( ui.currentResponseText ).toBe( '' );
	} );

	it( 'does not trigger cap detection for non-wpcom providers even with a 429 error', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleMessage: ( message: unknown ) => unknown;
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
		// Replay mode skips the showLoader call at the end of the assistant
		// branch, which would otherwise need extensive tui stubs.
		ui.replayMode = true;

		ui.handleMessage( {
			type: 'assistant',
			error: 'unknown',
			message: {
				content: [
					{
						type: 'text',
						text: 'API Error: 429 {"error":{"message":"cap"}}',
					},
				],
			},
			parent_tool_use_id: null,
			uuid: 'uuid',
			session_id: 'sess',
		} );

		expect( showError ).not.toHaveBeenCalled();
		expect( showInfo ).not.toHaveBeenCalled();
		expect( ui.usageCapReached ).toBe( false );
	} );

	it( 'skips the "Done" success indicator when the usage cap was reached', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleMessage: ( message: unknown ) => unknown;
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
		ui.messages = { addChild };

		const result = ui.handleMessage( {
			type: 'result',
			subtype: 'success',
			session_id: 'sess',
			num_turns: 1,
		} );

		expect( addChild ).not.toHaveBeenCalled();
		expect( showInfo ).not.toHaveBeenCalled();
		expect( result ).toEqual( { type: 'result', sessionId: 'sess', success: false } );
	} );

	it( 'reports hasErrorBeenSurfaced based on usageCapReached', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			hasErrorBeenSurfaced: () => boolean;
			[ key: string ]: unknown;
		};
		ui.usageCapReached = false;
		expect( ui.hasErrorBeenSurfaced() ).toBe( false );
		ui.usageCapReached = true;
		expect( ui.hasErrorBeenSurfaced() ).toBe( true );
	} );

	it( 'does not trip the cap branch when an assistant error has no 429 text block', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleMessage: ( message: unknown ) => unknown;
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
		// Empty content + replay mode bypasses the rendering path; this test
		// only guards that the cap branch isn't taken without a 429 text block.
		ui.replayMode = true;
		ui.loaderVisible = true;

		ui.handleMessage( {
			type: 'assistant',
			error: 'unknown',
			message: { content: [] },
			parent_tool_use_id: null,
			uuid: 'uuid',
			session_id: 'sess',
		} );

		expect( showError ).not.toHaveBeenCalled();
		expect( showInfo ).not.toHaveBeenCalled();
		expect( ui.usageCapReached ).toBe( false );
	} );
} );
