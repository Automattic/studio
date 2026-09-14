import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_CHAT_SLASH_COMMANDS, type SlashCommandContext } from 'cli/ai/slash-commands';

vi.mock( 'cli/ai/auth', () => ( {
	getAvailableAiProviders: vi.fn(),
	isAiProviderReady: vi.fn(),
} ) );

vi.mock( 'cli/commands/auth/login', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/auth/logout', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/preview/create', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/preview/update', () => ( { runCommand: vi.fn() } ) );
vi.mock( '@studio/common/lib/shared-config', () => ( {
	readAuthToken: vi.fn(),
	isAutomatticianFromToken: vi.fn().mockResolvedValue( true ),
} ) );

const modelHandler = AI_CHAT_SLASH_COMMANDS.find( ( c ) => c.name === 'model' )?.handler;

function buildModelCtx(
	overrides: Partial< SlashCommandContext > & {
		askUserResponse: string;
	}
): { ctx: SlashCommandContext; persistMock: ReturnType< typeof vi.fn > } {
	const persistMock = vi.fn().mockResolvedValue( undefined );
	const ctx: SlashCommandContext = {
		// `as never` keeps this test framework-agnostic — we don't need a
		// real AiChatUI, just the methods the /model handler touches.
		ui: {
			currentModel: overrides.currentModel ?? 'gpt-5.6-sol',
			askUser: vi.fn().mockResolvedValue( { 0: overrides.askUserResponse } ),
			showInfo: vi.fn(),
			showError: vi.fn(),
		} as never,
		currentModel: overrides.currentModel ?? 'gpt-5.6-sol',
		currentProvider: 'wpcom',
		showCapabilitiesOnConnect: false,
		switchProvider: vi.fn().mockResolvedValue( undefined ),
		prepareProviderSelection: vi.fn().mockResolvedValue( undefined ),
		maybeAutoSwitchProvider: vi.fn().mockResolvedValue( undefined ),
		persistSessionContext: persistMock,
		clearSession: vi.fn().mockResolvedValue( undefined ),
	};
	return { ctx, persistMock };
}

describe( '/model slash command', () => {
	// Locks in the labelToId-map matcher introduced in slash-commands.ts.
	// The previous implementation used `selectedLabel.startsWith( label )`,
	// which silently picked the wrong id whenever one model's label was a
	// prefix of another's (e.g. "GPT 5.6" prefix of "GPT 5.6 Sol"). We don't
	// currently expose any prefix-colliding labels, but the fix is general
	// and we want the regression coverage to survive future additions.
	it( 'resolves the picked model exactly by label, not by prefix', async () => {
		expect( modelHandler ).toBeDefined();
		const { ctx, persistMock } = buildModelCtx( {
			currentModel: 'gpt-5.6-sol',
			askUserResponse: 'Sonnet 5',
		} );

		await modelHandler!( '/model', ctx );

		expect( ctx.currentModel ).toBe( 'claude-sonnet-5' );
		expect( persistMock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'still resolves the picked model when its label carries the "(current)" suffix', async () => {
		const { ctx, persistMock } = buildModelCtx( {
			currentModel: 'gpt-5.6-sol',
			askUserResponse: 'GPT 5.6 Sol (current)',
		} );

		await modelHandler!( '/model', ctx );

		// Same model picked → no swap, no persist.
		expect( ctx.currentModel ).toBe( 'gpt-5.6-sol' );
		expect( persistMock ).not.toHaveBeenCalled();
	} );
} );

vi.mock( '@studio/common/lib/studio-assistant-quota', async ( importOriginal ) => {
	const actual = await importOriginal< object >();
	return { ...actual, fetchStudioAssistantQuota: vi.fn() };
} );

vi.mock( '@studio/common/lib/studio-assistant-top-up-pricing', async ( importOriginal ) => {
	const actual = await importOriginal< object >();
	return { ...actual, fetchStudioAssistantTopUpPricing: vi.fn() };
} );

vi.mock( 'cli/lib/browser', () => ( { openBrowser: vi.fn() } ) );

describe( '/credits slash command', () => {
	const cmd = AI_CHAT_SLASH_COMMANDS.find( ( c ) => c.name === 'credits' )!;

	function makeUi() {
		return {
			showInfo: vi.fn(),
			showError: vi.fn(),
			showSuccess: vi.fn(),
			showProgress: vi.fn(),
			setBusy: vi.fn(),
			askUser: vi.fn(),
		};
	}

	function makeCtx( ui: ReturnType< typeof makeUi > ): SlashCommandContext {
		return {
			ui: ui as unknown as SlashCommandContext[ 'ui' ],
			currentModel: 'claude-sonnet-4-5' as SlashCommandContext[ 'currentModel' ],
			currentProvider: 'wpcom' as SlashCommandContext[ 'currentProvider' ],
			showCapabilitiesOnConnect: false,
			switchProvider: vi.fn().mockResolvedValue( undefined ),
			prepareProviderSelection: vi.fn().mockResolvedValue( undefined ),
			maybeAutoSwitchProvider: vi.fn().mockResolvedValue( undefined ),
			persistSessionContext: vi.fn().mockResolvedValue( undefined ),
			clearSession: vi.fn().mockResolvedValue( undefined ),
		};
	}

	const gbpPricing = {
		options: [
			{ credits: 100000, display: '£7.50' },
			{ credits: 500000, display: '£37.50' },
		],
	};

	async function mocks() {
		return {
			auth: await import( '@studio/common/lib/shared-config' ),
			quota: await import( '@studio/common/lib/studio-assistant-quota' ),
			pricing: await import( '@studio/common/lib/studio-assistant-top-up-pricing' ),
			browser: await import( 'cli/lib/browser' ),
		};
	}

	beforeEach( async () => {
		const m = await mocks();
		vi.mocked( m.auth.readAuthToken ).mockResolvedValue( {
			accessToken: 'token',
		} as Awaited< ReturnType< typeof m.auth.readAuthToken > > );
		vi.mocked( m.quota.fetchStudioAssistantQuota ).mockResolvedValue( null );
		vi.mocked( m.pricing.fetchStudioAssistantTopUpPricing ).mockResolvedValue( null );
		vi.mocked( m.browser.openBrowser ).mockResolvedValue( undefined );
	} );

	it( 'is registered with a handler', () => {
		expect( cmd ).toBeDefined();
		expect( typeof cmd.handler ).toBe( 'function' );
		expect( cmd.description ).toBeTruthy();
	} );

	it( 'asks the user to sign in instead of calling WordPress.com', async () => {
		const m = await mocks();
		vi.mocked( m.auth.readAuthToken ).mockResolvedValue( null );
		const ui = makeUi();

		const result = await cmd.handler!( '/credits', makeCtx( ui ) );

		expect( m.quota.fetchStudioAssistantQuota ).not.toHaveBeenCalled();
		expect( ui.showInfo ).toHaveBeenCalledWith( expect.stringContaining( '/login' ) );
		expect( ui.askUser ).not.toHaveBeenCalled();
		expect( result ).toBe( 'continue' );
	} );

	it( 'shows both credit pools, then offers every priced top-up', async () => {
		const m = await mocks();
		vi.mocked( m.quota.fetchStudioAssistantQuota ).mockResolvedValue( {
			costUsage: 1,
			costCap: 100,
			emailVerified: true,
			hasPaymentMethod: true,
			allowanceRemaining: 960000,
			purchasedRemaining: 150000,
		} as Awaited< ReturnType< typeof m.quota.fetchStudioAssistantQuota > > );
		vi.mocked( m.pricing.fetchStudioAssistantTopUpPricing ).mockResolvedValue( gbpPricing );

		const ui = makeUi();
		ui.askUser.mockResolvedValue( { 0: '500,000 credits' } );

		await cmd.handler!( '/credits', makeCtx( ui ) );

		// One paragraph: separate showInfo calls each pad themselves with
		// blank lines, so the two figures must travel together.
		expect( ui.showInfo ).toHaveBeenCalledWith(
			'Free credits remaining: 960,000\nPurchased credits remaining: 150,000'
		);
		const options = ui.askUser.mock.calls[ 0 ][ 0 ][ 0 ].options;
		expect( options ).toEqual( [
			{ label: '100,000 credits', description: '£7.50' },
			{ label: '500,000 credits', description: '£37.50' },
		] );
		expect( m.browser.openBrowser ).toHaveBeenCalledWith(
			'https://wordpress.com/checkout/wpcom/studio-code-ai-credits:-q-500000'
		);
	} );

	it( 'hides the free pool once it is spent', async () => {
		const m = await mocks();
		vi.mocked( m.quota.fetchStudioAssistantQuota ).mockResolvedValue( {
			costUsage: 1,
			costCap: 100,
			emailVerified: true,
			hasPaymentMethod: true,
			allowanceRemaining: 0,
			purchasedRemaining: 0,
		} as Awaited< ReturnType< typeof m.quota.fetchStudioAssistantQuota > > );

		const ui = makeUi();
		ui.askUser.mockResolvedValue( { 0: 'Add AI credits' } );

		await cmd.handler!( '/credits', makeCtx( ui ) );

		expect( ui.showInfo ).not.toHaveBeenCalledWith(
			expect.stringContaining( 'Free credits remaining' )
		);
		expect( ui.showInfo ).toHaveBeenCalledWith( 'Purchased credits remaining: 0' );
	} );

	it( 'falls back to the fixed top-up when nothing could be priced', async () => {
		const m = await mocks();
		vi.mocked( m.pricing.fetchStudioAssistantTopUpPricing ).mockResolvedValue( { options: [] } );

		const ui = makeUi();
		ui.askUser.mockResolvedValue( { 0: 'Add AI credits' } );

		await cmd.handler!( '/credits', makeCtx( ui ) );

		const options = ui.askUser.mock.calls[ 0 ][ 0 ][ 0 ].options;
		expect( options ).toHaveLength( 1 );
		expect( options[ 0 ].label ).toBe( 'Add AI credits' );
		expect( m.browser.openBrowser ).toHaveBeenCalledWith(
			'https://wordpress.com/checkout/wpcom/studio-code-ai-credits:-q-100000'
		);
	} );

	it( 'still offers top-ups when the balance cannot be read', async () => {
		const m = await mocks();
		vi.mocked( m.pricing.fetchStudioAssistantTopUpPricing ).mockResolvedValue( gbpPricing );

		const ui = makeUi();
		ui.askUser.mockResolvedValue( { 0: '100,000 credits' } );

		await cmd.handler!( '/credits', makeCtx( ui ) );

		expect( ui.showInfo ).toHaveBeenCalledWith( 'Studio Code limits are temporarily unavailable.' );
		expect( ui.askUser ).toHaveBeenCalledOnce();
		expect( m.browser.openBrowser ).toHaveBeenCalled();
	} );

	it( 'opens nothing when the picker is canceled (Esc)', async () => {
		const m = await mocks();
		vi.mocked( m.pricing.fetchStudioAssistantTopUpPricing ).mockResolvedValue( gbpPricing );

		const ui = makeUi();
		ui.askUser.mockRejectedValue(
			Object.assign( new Error( 'aborted' ), { name: 'AbortPromptError' } )
		);

		const result = await cmd.handler!( '/credits', makeCtx( ui ) );

		expect( m.browser.openBrowser ).not.toHaveBeenCalled();
		expect( ui.showInfo ).toHaveBeenCalledWith( 'Canceled.' );
		expect( result ).toBe( 'continue' );
	} );
} );
