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
} );
