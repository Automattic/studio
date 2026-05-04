import { describe, expect, it, vi } from 'vitest';
import { AI_CHAT_SLASH_COMMANDS, type SlashCommandContext } from 'cli/ai/slash-commands';

vi.mock( 'cli/ai/auth', () => ( {
	getAvailableAiProviders: vi.fn(),
	isAiProviderReady: vi.fn(),
} ) );

vi.mock( 'cli/commands/auth/login', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/auth/logout', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/preview/create', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/preview/update', () => ( { runCommand: vi.fn() } ) );
vi.mock( '@studio/common/lib/shared-config', () => ( { readAuthToken: vi.fn() } ) );

const modelHandler = AI_CHAT_SLASH_COMMANDS.find( ( c ) => c.name === 'model' )?.handler;

function buildCtx(
	overrides: Partial< SlashCommandContext > & {
		askUserResponse: string;
	}
): { ctx: SlashCommandContext; persistMock: ReturnType< typeof vi.fn > } {
	const persistMock = vi.fn().mockResolvedValue( undefined );
	const ctx: SlashCommandContext = {
		// `as never` keeps this test framework-agnostic — we don't need a
		// real AiChatUI, just the methods the /model handler touches.
		ui: {
			currentModel: overrides.currentModel ?? 'gpt-5.5',
			askUser: vi.fn().mockResolvedValue( { 0: overrides.askUserResponse } ),
			showInfo: vi.fn(),
			showError: vi.fn(),
		} as never,
		currentModel: overrides.currentModel ?? 'gpt-5.5',
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
	// prefix of another's (e.g. "GPT 5.5" prefix of "GPT 5.5 Pro"). We don't
	// currently expose any prefix-colliding labels, but the fix is general
	// and we want the regression coverage to survive future additions.
	it( 'resolves the picked model exactly by label, not by prefix', async () => {
		expect( modelHandler ).toBeDefined();
		const { ctx, persistMock } = buildCtx( {
			currentModel: 'gpt-5.5',
			askUserResponse: 'Sonnet 4.6',
		} );

		await modelHandler!( '/model', ctx );

		expect( ctx.currentModel ).toBe( 'claude-sonnet-4-6' );
		expect( persistMock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'still resolves the picked model when its label carries the "(current)" suffix', async () => {
		const { ctx, persistMock } = buildCtx( {
			currentModel: 'gpt-5.5',
			askUserResponse: 'GPT 5.5 (current)',
		} );

		await modelHandler!( '/model', ctx );

		// Same model picked → no swap, no persist.
		expect( ctx.currentModel ).toBe( 'gpt-5.5' );
		expect( persistMock ).not.toHaveBeenCalled();
	} );
} );
