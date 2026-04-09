import { SelectList } from '@mariozechner/pi-tui';
import stripAnsi from 'strip-ansi';
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

describe( 'AiChatUI.askUser', () => {
	it( 'skips remaining option questions when cancelled', async () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			askUser: (
				questions: Array< {
					question: string;
					options: Array< { label: string; description: string } >;
					allowFreeForm?: boolean;
				} >
			) => Promise< Record< string, string > >;
			[ key: string ]: unknown;
		};

		ui.hideLoader = vi.fn();
		ui.hideEditor = vi.fn();
		ui.showLoader = vi.fn();
		ui.renderOptionPicker = vi.fn();
		ui.randomThinkingMessage = vi.fn().mockReturnValue( 'Thinking…' );
		ui.messages = { addChild: vi.fn() };
		ui.tui = {
			addChild: vi.fn(),
			removeChild: vi.fn(),
			requestRender: vi.fn(),
		};

		const answersPromise = ui.askUser( [
			{
				question: 'Which layout?',
				options: [
					{ label: 'Business', description: 'Business site' },
					{ label: 'Portfolio', description: 'Portfolio site' },
				],
				allowFreeForm: true,
			},
		] );

		const selectList = ui.optionPickerSelectList as { onCancel?: () => void } | null;
		expect( ui.renderOptionPicker ).toHaveBeenCalledTimes( 1 );
		expect( selectList?.onCancel ).toBeTypeOf( 'function' );
		selectList?.onCancel?.();

		await expect( answersPromise ).resolves.toEqual( {} );
		expect( ui.showLoader ).toHaveBeenCalledWith( 'Thinking…' );
		expect( ui.askUserActive ).toBe( false );
	} );

	it( 'skips remaining text questions when cancelled', async () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			askUser: (
				questions: Array< {
					question: string;
					options: Array< { label: string; description: string } >;
				} >
			) => Promise< Record< string, string > >;
			cancelAskUserQuestions: () => boolean;
			[ key: string ]: unknown;
		};

		ui.hideLoader = vi.fn();
		ui.showLoader = vi.fn();
		ui.randomThinkingMessage = vi.fn().mockReturnValue( 'Thinking…' );
		ui.messages = { addChild: vi.fn() };
		ui.editor = { setText: vi.fn() };
		ui.tui = {
			addChild: vi.fn(),
			removeChild: vi.fn(),
			requestRender: vi.fn(),
			setFocus: vi.fn(),
		};

		const answersPromise = ui.askUser( [
			{
				question: 'What should the site be called?',
				options: [],
			},
		] );

		expect( ui.submitResolve ).toBeTypeOf( 'function' );
		expect( ui.cancelAskUserQuestions() ).toBe( true );

		await expect( answersPromise ).resolves.toEqual( {} );
		expect( ui.showLoader ).toHaveBeenCalledWith( 'Thinking…' );
		expect( ui.askUserActive ).toBe( false );
	} );
} );

describe( 'AiChatUI ask-user affordances', () => {
	it( 'does not show an interrupt hint when idle', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			updateHints: () => void;
			[ key: string ]: unknown;
		};

		ui.editor = { hints: [] };
		ui._inAgentTurn = false;
		ui.askUserActive = false;
		ui.optionPickerVisible = false;
		ui.activeExpandablePreview = null;
		ui.interruptCallback = null;

		ui.updateHints();

		expect( ui.editor ).toMatchObject( {
			hints: [ '↓ select site' ],
		} );
	} );

	it( 'shows a submit-and-skip hint for free-form ask-user input', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			updateHints: () => void;
			[ key: string ]: unknown;
		};

		ui.editor = { hints: [] };
		ui._inAgentTurn = true;
		ui.askUserActive = true;
		ui.optionPickerVisible = false;
		ui.activeExpandablePreview = null;

		ui.updateHints();

		expect( ui.editor ).toMatchObject( {
			hints: [ 'enter to submit · esc to skip' ],
		} );
	} );

	it( 'shows an interrupt hint during an agent turn', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			updateHints: () => void;
			[ key: string ]: unknown;
		};

		ui.editor = { hints: [] };
		ui._inAgentTurn = true;
		ui.askUserActive = false;
		ui.optionPickerVisible = false;
		ui.activeExpandablePreview = null;
		ui.interruptCallback = vi.fn();

		ui.updateHints();

		expect( ui.editor ).toMatchObject( {
			hints: [ 'esc to interrupt' ],
		} );
	} );

	it( 'shows a select-and-skip hint in the option picker', () => {
		const addChild = vi.fn();
		const ui = Object.create( AiChatUI.prototype ) as {
			renderOptionPicker: () => void;
			[ key: string ]: unknown;
		};

		ui.optionPickerContainer = {
			clear: vi.fn(),
			addChild,
		};
		ui.optionPickerSelectList = new SelectList(
			[
				{ value: 'Business', label: '1. Business' },
				{ value: 'Portfolio', label: '2. Portfolio' },
				{ value: '__other__', label: '3. Type something…' },
			],
			3,
			{} as never
		);
		ui.optionPickerHasFreeForm = true;
		ui.optionPickerItemCount = 3;
		ui.optionPickerVisible = true;
		ui.optionPickerOtherActive = false;
		ui.optionPickerInput = null;
		ui.tui = { requestRender: vi.fn() };

		ui.renderOptionPicker();

		const picker = addChild.mock.calls[ 0 ][ 0 ] as { text: string };
		expect( picker.text ).toContain( '3. Type something…' );
		expect( stripAnsi( picker.text ) ).toContain(
			'tab/arrow keys to navigate · enter to select · esc to skip'
		);
	} );

	it( 'replaces the free-form placeholder with inline input while typing', () => {
		const addChild = vi.fn();
		const ui = Object.create( AiChatUI.prototype ) as {
			renderOptionPicker: () => void;
			[ key: string ]: unknown;
		};

		ui.optionPickerContainer = {
			clear: vi.fn(),
			addChild,
		};
		const selectList = new SelectList(
			[
				{ value: 'Business', label: '1. Business' },
				{ value: 'Portfolio', label: '2. Portfolio' },
				{ value: '__other__', label: '3. Type something…' },
			],
			3,
			{} as never
		);
		selectList.setSelectedIndex( 2 );
		ui.optionPickerSelectList = selectList;
		ui.optionPickerHasFreeForm = true;
		ui.optionPickerItemCount = 3;
		ui.optionPickerVisible = true;
		ui.optionPickerOtherActive = true;
		ui.optionPickerOtherValue = 'custom answer';
		ui.optionPickerInput = {
			getValue: vi.fn().mockReturnValue( 'custom answer' ),
		};
		ui.tui = { requestRender: vi.fn() };

		ui.renderOptionPicker();

		const picker = addChild.mock.calls[ 0 ][ 0 ] as { text: string };
		const renderedText = stripAnsi( picker.text );
		expect( renderedText ).toContain( '3. custom answer' );
		expect( renderedText ).not.toContain( 'Type something…' );
		expect( renderedText ).toContain(
			'tab/arrow keys to navigate · enter to submit · esc to skip'
		);
	} );
} );

describe( 'AiChatUI ask-user tab navigation', () => {
	it( 'moves the option picker selection with Tab and Shift+Tab', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleOptionPickerTabNavigation: ( data: string ) => boolean;
			[ key: string ]: unknown;
		};

		ui.optionPickerSelectList = new SelectList(
			[
				{ value: 'Business', label: '1. Business' },
				{ value: 'Portfolio', label: '2. Portfolio' },
			],
			2,
			{} as never
		);
		ui.optionPickerHasFreeForm = false;
		ui.optionPickerOtherActive = false;
		ui.renderOptionPicker = vi.fn();

		expect( ui.handleOptionPickerTabNavigation( '\t' ) ).toBe( true );
		expect( ( ui.optionPickerSelectList as SelectList ).getSelectedItem()?.value ).toBe(
			'Portfolio'
		);

		expect( ui.handleOptionPickerTabNavigation( '\u001b[Z' ) ).toBe( true );
		expect( ( ui.optionPickerSelectList as SelectList ).getSelectedItem()?.value ).toBe(
			'Business'
		);
	} );

	it( 'preserves free-form input when tabbing away and back', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleOptionPickerTabNavigation: ( data: string ) => boolean;
			[ key: string ]: unknown;
		};

		ui.optionPickerSelectList = new SelectList(
			[
				{ value: 'Business', label: '1. Business' },
				{ value: '__other__', label: '2. Type something…' },
			],
			2,
			{} as never
		);
		( ui.optionPickerSelectList as SelectList ).setSelectedIndex( 1 );
		ui.optionPickerHasFreeForm = true;
		ui.optionPickerOtherActive = true;
		ui.optionPickerOtherValue = '';
		ui.optionPickerInput = {
			getValue: vi.fn().mockReturnValue( 'custom answer' ),
		};
		ui.renderOptionPicker = vi.fn();

		expect( ui.handleOptionPickerTabNavigation( '\t' ) ).toBe( true );
		expect( ui.optionPickerOtherValue ).toBe( 'custom answer' );
		expect( ( ui.optionPickerSelectList as SelectList ).getSelectedItem()?.value ).toBe(
			'Business'
		);

		expect( ui.handleOptionPickerTabNavigation( '\t' ) ).toBe( true );
		expect( ( ui.optionPickerSelectList as SelectList ).getSelectedItem()?.value ).toBe(
			'__other__'
		);
		const restoredInput = ui.optionPickerInput as { getValue: () => string; cursor: number } | null;
		expect( restoredInput?.getValue() ).toBe( 'custom answer' );
		expect( restoredInput?.cursor ).toBe( 'custom answer'.length );
	} );

	it( 'activates the Other input when Tab lands on it', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleOptionPickerTabNavigation: ( data: string ) => boolean;
			[ key: string ]: unknown;
		};

		ui.optionPickerSelectList = new SelectList(
			[
				{ value: 'Business', label: '1. Business' },
				{ value: '__other__', label: '2. Type something…' },
			],
			2,
			{} as never
		);
		ui.optionPickerHasFreeForm = true;
		ui.optionPickerOtherActive = false;
		ui.activateOptionPickerOther = vi.fn();
		ui.renderOptionPicker = vi.fn();

		expect( ui.handleOptionPickerTabNavigation( '\t' ) ).toBe( true );
		expect( ui.activateOptionPickerOther ).toHaveBeenCalledTimes( 1 );
		expect( ( ui.optionPickerSelectList as SelectList ).getSelectedItem()?.value ).toBe(
			'__other__'
		);
	} );

	it( 'preserves free-form input when moving away with arrow keys', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleActiveOptionPickerOtherNavigation: ( data: string ) => boolean;
			[ key: string ]: unknown;
		};

		ui.optionPickerSelectList = new SelectList(
			[
				{ value: 'Business', label: '1. Business' },
				{ value: '__other__', label: '2. Type something…' },
			],
			2,
			{} as never
		);
		( ui.optionPickerSelectList as SelectList ).setSelectedIndex( 1 );
		ui.optionPickerHasFreeForm = true;
		ui.optionPickerOtherActive = true;
		ui.optionPickerOtherValue = '';
		ui.optionPickerInput = {
			getValue: vi.fn().mockReturnValue( 'custom answer' ),
		};
		ui.renderOptionPicker = vi.fn();

		expect( ui.handleActiveOptionPickerOtherNavigation( '\u001b[B' ) ).toBe( true );
		expect( ui.optionPickerOtherValue ).toBe( 'custom answer' );
		expect( ui.optionPickerOtherActive ).toBe( false );
		expect( ( ui.optionPickerSelectList as SelectList ).getSelectedItem()?.value ).toBe(
			'Business'
		);
	} );
} );

describe( 'AiChatUI ask-user free-form cleanup', () => {
	it( 'captures the first typed character when switching to Other', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleActiveOptionPickerOtherInput: ( data: string ) => boolean;
			[ key: string ]: unknown;
		};

		ui.optionPickerOtherActive = true;
		ui.optionPickerSelectList = new SelectList(
			[
				{ value: 'Business', label: '1. Business' },
				{ value: '__other__', label: '2. Type something…' },
			],
			2,
			{} as never
		);
		ui.optionPickerOtherValue = '';
		ui.handleActiveOptionPickerOtherNavigation = vi.fn().mockReturnValue( false );
		ui.renderOptionPicker = vi.fn();
		ui.optionPickerInput = {
			handleInput: vi.fn(),
			getValue: vi.fn().mockReturnValue( 'c' ),
		};

		expect( ui.handleActiveOptionPickerOtherInput( 'c' ) ).toBe( true );
		expect( ui.optionPickerOtherValue ).toBe( 'c' );
		expect( ui.renderOptionPicker ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not dereference the inline input after it closes itself', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			handleActiveOptionPickerOtherInput: ( data: string ) => boolean;
			[ key: string ]: unknown;
		};

		const getValue = vi.fn().mockReturnValue( 'custom answer' );
		const renderOptionPicker = vi.fn();

		ui.optionPickerOtherActive = true;
		ui.optionPickerSelectList = new SelectList(
			[
				{ value: 'Business', label: '1. Business' },
				{ value: '__other__', label: '2. Type something…' },
			],
			2,
			{} as never
		);
		ui.handleActiveOptionPickerOtherNavigation = vi.fn().mockReturnValue( false );
		ui.renderOptionPicker = renderOptionPicker;
		ui.optionPickerInput = {
			handleInput: vi.fn( () => {
				ui.optionPickerInput = null;
				ui.optionPickerSelectList = null;
			} ),
			getValue,
		};

		expect( ui.handleActiveOptionPickerOtherInput( '\u001b' ) ).toBe( true );
		expect( getValue ).not.toHaveBeenCalled();
		expect( renderOptionPicker ).not.toHaveBeenCalled();
	} );

	it( 'clears the cached free-form value when the picker closes', () => {
		const ui = Object.create( AiChatUI.prototype ) as {
			closeOptionPicker: () => void;
			[ key: string ]: unknown;
		};

		ui.optionPickerContainer = {};
		ui.optionPickerVisible = true;
		ui.optionPickerSelectList = new SelectList(
			[
				{ value: 'Business', label: '1. Business' },
				{ value: '__other__', label: '2. Type something…' },
			],
			2,
			{} as never
		);
		ui.optionPickerHasFreeForm = true;
		ui.optionPickerItemCount = 2;
		ui.optionPickerOtherActive = true;
		ui.optionPickerOtherValue = 'custom answer';
		ui.optionPickerInput = {
			getValue: vi.fn().mockReturnValue( 'custom answer' ),
		};
		ui.tui = {
			removeChild: vi.fn(),
			requestRender: vi.fn(),
		};

		ui.closeOptionPicker();

		expect( ui.optionPickerOtherActive ).toBe( false );
		expect( ui.optionPickerInput ).toBeNull();
		expect( ui.optionPickerOtherValue ).toBe( '' );
	} );
} );

describe( 'AiChatUI ask-user result rendering', () => {
	function createAskUserResultUi() {
		const renderToolResultText = vi.fn();
		const ui = Object.create( AiChatUI.prototype ) as {
			showToolResult: (
				message: unknown,
				toolName?: string,
				toolInput?: Record< string, unknown > | null
			) => void;
			[ key: string ]: unknown;
		};

		ui.stopToolDotBlink = vi.fn();
		ui.getToolResultContent = vi.fn().mockReturnValue( {
			content:
				"User has answered your questions: . You can now continue with the user's answers in mind.",
			isError: false,
		} );
		ui.finalizeToolUseLine = vi.fn();
		ui.renderToolResultText = renderToolResultText;
		ui.tui = { requestRender: vi.fn() };
		ui.toolDotLabel = 'AskUserQuestion';
		return { ui, renderToolResultText };
	}

	it( 'renders a short summary for a single answer', () => {
		const { ui, renderToolResultText } = createAskUserResultUi();
		ui.lastAskUserOutcome = {
			answers: {
				'One-page or multi-page site?': 'only need two pages, about and homepage',
			},
			skipped: false,
		};

		ui.showToolResult( { type: 'user' }, 'AskUserQuestion' );

		expect( renderToolResultText ).toHaveBeenCalledWith(
			'Answer: only need two pages, about and homepage',
			'AskUserQuestion'
		);
		expect( ui.lastAskUserOutcome ).toBeNull();
	} );

	it( 'renders a compact list for multiple answers', () => {
		const { ui, renderToolResultText } = createAskUserResultUi();
		ui.lastAskUserOutcome = {
			answers: {
				'One-page or multi-page site?': 'Multi-page',
				'What style should it have?': 'Clean and minimal',
			},
			skipped: false,
		};

		ui.showToolResult( { type: 'user' }, 'AskUserQuestion' );

		expect( renderToolResultText ).toHaveBeenCalledWith(
			'Answers\n- One-page or multi-page site?: Multi-page\n- What style should it have?: Clean and minimal',
			'AskUserQuestion'
		);
		expect( ui.lastAskUserOutcome ).toBeNull();
	} );

	it( 'renders a skipped message instead of the empty SDK answer sentence', () => {
		const { ui, renderToolResultText } = createAskUserResultUi();
		ui.lastAskUserOutcome = {
			answers: {},
			skipped: true,
		};

		ui.showToolResult( { type: 'user' }, 'AskUserQuestion' );

		expect( renderToolResultText ).toHaveBeenCalledWith( 'Skipped', 'AskUserQuestion' );
		expect( ui.lastAskUserOutcome ).toBeNull();
	} );

	it( 'renders the skip state for partial answers', () => {
		const { ui, renderToolResultText } = createAskUserResultUi();
		ui.lastAskUserOutcome = {
			answers: {
				'One-page or multi-page site?': 'only need two pages, about and homepage',
			},
			skipped: true,
		};

		ui.showToolResult( { type: 'user' }, 'AskUserQuestion' );

		expect( renderToolResultText ).toHaveBeenCalledWith(
			'Answer: only need two pages, about and homepage\nSkipped remaining questions',
			'AskUserQuestion'
		);
		expect( ui.lastAskUserOutcome ).toBeNull();
	} );
} );
