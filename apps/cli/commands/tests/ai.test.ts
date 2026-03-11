import { vi } from 'vitest';
import { runCommand } from '../ai';

const {
	mockStart,
	mockShowWelcome,
	mockWaitForInput,
	mockStop,
	mockSetLoaderMessage,
	mockAskUser,
	mockAddUserMessage,
	mockBeginAgentTurn,
	mockEndAgentTurn,
	mockShowInfo,
	mockHandleMessage,
	mockInterrupt,
	mockSetProgressCallback,
	mockStartAiAgent,
	mockGetAnthropicApiKey,
} = vi.hoisted( () => ( {
	mockStart: vi.fn(),
	mockShowWelcome: vi.fn(),
	mockWaitForInput: vi.fn(),
	mockStop: vi.fn(),
	mockSetLoaderMessage: vi.fn(),
	mockAskUser: vi.fn(),
	mockAddUserMessage: vi.fn(),
	mockBeginAgentTurn: vi.fn(),
	mockEndAgentTurn: vi.fn(),
	mockShowInfo: vi.fn(),
	mockHandleMessage: vi.fn(),
	mockInterrupt: vi.fn(),
	mockSetProgressCallback: vi.fn(),
	mockStartAiAgent: vi.fn(),
	mockGetAnthropicApiKey: vi.fn(),
} ) );

vi.mock( 'cli/lib/appdata', () => ( {
	getAnthropicApiKey: mockGetAnthropicApiKey,
	saveAnthropicApiKey: vi.fn(),
} ) );

vi.mock( 'cli/ai/agent', () => ( {
	AI_MODELS: {
		sonnet: 'Claude Sonnet 4',
		opus: 'Claude Opus 4.1',
	},
	DEFAULT_MODEL: 'sonnet',
	startAiAgent: mockStartAiAgent,
} ) );

vi.mock( 'cli/ai/ui', () => ( {
	AiChatUI: class {
		activeSite = null;
		currentModel = 'sonnet';

		start = mockStart;
		showWelcome = mockShowWelcome;
		waitForInput = mockWaitForInput;
		stop = mockStop;
		setLoaderMessage = mockSetLoaderMessage;
		askUser = mockAskUser;
		addUserMessage = mockAddUserMessage;
		beginAgentTurn = mockBeginAgentTurn;
		endAgentTurn = mockEndAgentTurn;
		showInfo = mockShowInfo;
		handleMessage = mockHandleMessage;

		set onInterrupt( fn: () => void ) {
			mockInterrupt( fn );
		}
	},
} ) );

vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportError = vi.fn();
	},
	LoggerError: class LoggerError extends Error {},
	setProgressCallback: mockSetProgressCallback,
} ) );

describe( 'AI Command', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mockGetAnthropicApiKey.mockResolvedValue( 'saved-api-key' );
		mockWaitForInput.mockResolvedValue( '/exit' );
		mockStartAiAgent.mockImplementation( async function* () {} );
	} );

	it( 'should exit the chat when the user enters /exit', async () => {
		await runCommand();

		expect( mockStart ).toHaveBeenCalledTimes( 1 );
		expect( mockShowWelcome ).toHaveBeenCalledTimes( 1 );
		expect( mockWaitForInput ).toHaveBeenCalledTimes( 1 );
		expect( mockStartAiAgent ).not.toHaveBeenCalled();
		expect( mockAddUserMessage ).not.toHaveBeenCalled();
		expect( mockStop ).toHaveBeenCalledTimes( 1 );
		expect( mockSetProgressCallback ).toHaveBeenCalledTimes( 1 );
	} );
} );
