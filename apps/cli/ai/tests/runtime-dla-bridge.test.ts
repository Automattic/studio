import { SessionManager } from '@mariozechner/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runStudioAgentTurn, type StudioAgentTurnConfig } from 'cli/ai/runtimes/pi';
import type {
	AgentSessionEvent,
	CreateAgentSessionOptions,
	ToolDefinition,
} from '@mariozechner/pi-coding-agent';
import type { DlaBridge, StartDlaBridgeOptions } from '@studio/dla';

const mocks = vi.hoisted( () => ( {
	createAgentSession: vi.fn(),
	customToolsCalls: [] as ToolDefinition[][],
	startDlaBridge: vi.fn(),
	dlaBridgeDisposeOrder: [] as string[],
	startDlaBridgeCalls: [] as StartDlaBridgeOptions[],
} ) );

vi.mock( '@studio/dla', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@studio/dla') >();
	return {
		...actual,
		startDlaBridge: ( opts?: StartDlaBridgeOptions ) => {
			mocks.startDlaBridgeCalls.push( opts ?? {} );
			return mocks.startDlaBridge( opts );
		},
	};
} );

vi.mock( '@mariozechner/pi-coding-agent', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@mariozechner/pi-coding-agent') >();
	const stub = ( name: string ) => ( {
		name,
		label: name,
		description: name,
		parameters: {},
		execute: async () => ( { content: [ { type: 'text', text: '' } ], details: undefined } ),
	} );

	return {
		...actual,
		createAgentSession: mocks.createAgentSession,
		createReadTool: () => stub( 'Read' ),
		createWriteTool: () => stub( 'Write' ),
		createEditTool: () => stub( 'Edit' ),
		createBashTool: () => stub( 'Bash' ),
		createGrepTool: () => stub( 'Grep' ),
		createFindTool: () => stub( 'Glob' ),
		createLsTool: () => stub( 'Ls' ),
	};
} );

class FakeSession {
	private listener?: ( event: AgentSessionEvent ) => void;
	public disposed = false;

	constructor( public options: CreateAgentSessionOptions ) {}

	subscribe( listener: ( event: AgentSessionEvent ) => void ): () => void {
		this.listener = listener;
		return () => {};
	}

	async prompt(): Promise< void > {
		this.listener?.( { type: 'agent_end', messages: [] } );
	}

	async abort(): Promise< void > {}

	dispose(): void {
		this.disposed = true;
		mocks.dlaBridgeDisposeOrder.push( 'session.dispose' );
	}
}

const newSession = () => SessionManager.inMemory( '/tmp/eval-dla-bridge' );

async function runRuntime( config: Omit< StudioAgentTurnConfig, 'onEvent' > ): Promise< void > {
	const handle = runStudioAgentTurn( { ...config, onEvent: () => {} } );
	await handle.result;
}

const baseEnv = {
	OPENAI_API_KEY: 'sk-test',
	OPENAI_BASE_URL: 'https://proxy.example.com/v1',
};

/**
 * Build a stub {@link ToolDefinition} suitable for testing — name only;
 * `execute()` is never called in these tests.
 */
function fakeDlaTool( name: string ): ToolDefinition {
	return {
		name,
		label: name,
		description: name,
		parameters: {},
		execute: async () => ( { content: [ { type: 'text', text: '' } ], details: undefined } ),
	} as unknown as ToolDefinition;
}

describe( 'pi runtime DLA bridge wiring', () => {
	beforeEach( () => {
		mocks.customToolsCalls.length = 0;
		mocks.startDlaBridgeCalls.length = 0;
		mocks.dlaBridgeDisposeOrder.length = 0;
		mocks.startDlaBridge.mockReset();
		mocks.createAgentSession.mockReset();
		mocks.createAgentSession.mockImplementation( async ( options: CreateAgentSessionOptions ) => {
			mocks.customToolsCalls.push( ( options.customTools ?? [] ) as ToolDefinition[] );
			const session = new FakeSession( options );
			return { session, extensionsResult: { extensions: [], errors: [], runtime: {} } };
		} );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'wires DLA bridge tools into customTools when STUDIO_DLA_ENABLED=1', async () => {
		const dlaTools = [
			fakeDlaTool( 'liberate_detect' ),
			fakeDlaTool( 'liberate_inspect' ),
			fakeDlaTool( 'liberate_extract' ),
		];
		const bridge: DlaBridge = {
			tools: dlaTools,
			degraded: false,
			dispose: vi.fn( async () => {
				mocks.dlaBridgeDisposeOrder.push( 'bridge.dispose' );
			} ),
		};
		mocks.startDlaBridge.mockResolvedValue( bridge );

		await runRuntime( {
			prompt: 'hello',
			env: { ...baseEnv, STUDIO_DLA_ENABLED: '1' },
			model: 'gpt-5.5',
			session: newSession(),
		} );

		expect( mocks.startDlaBridgeCalls ).toHaveLength( 1 );
		expect( mocks.customToolsCalls ).toHaveLength( 1 );
		const toolNames = mocks.customToolsCalls[ 0 ].map( ( tool ) => tool.name );
		expect( toolNames ).toEqual(
			expect.arrayContaining( [ 'liberate_detect', 'liberate_inspect', 'liberate_extract' ] )
		);
	} );

	it( 'passes the wpcomAccessToken through to startDlaBridge when present', async () => {
		mocks.startDlaBridge.mockResolvedValue( {
			tools: [],
			degraded: false,
			dispose: vi.fn( async () => {} ),
		} satisfies DlaBridge );

		await runRuntime( {
			prompt: 'hello',
			env: { ...baseEnv, STUDIO_DLA_ENABLED: '1' },
			model: 'gpt-5.5',
			session: newSession(),
			wpcomAccessToken: 'wpcom-bearer-token',
		} );

		expect( mocks.startDlaBridgeCalls ).toHaveLength( 1 );
		expect( mocks.startDlaBridgeCalls[ 0 ].wpcomToken ).toBe( 'wpcom-bearer-token' );
	} );

	it( 'does not spawn bridge when STUDIO_DLA_ENABLED is unset', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: { ...baseEnv },
			model: 'gpt-5.5',
			session: newSession(),
		} );

		expect( mocks.startDlaBridge ).not.toHaveBeenCalled();
		expect( mocks.customToolsCalls ).toHaveLength( 1 );
		const toolNames = mocks.customToolsCalls[ 0 ].map( ( tool ) => tool.name );
		expect( toolNames ).not.toEqual(
			expect.arrayContaining( [ 'liberate_detect', 'liberate_inspect' ] )
		);
	} );

	it( 'does not spawn bridge when STUDIO_DLA_ENABLED=0', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: { ...baseEnv, STUDIO_DLA_ENABLED: '0' },
			model: 'gpt-5.5',
			session: newSession(),
		} );

		expect( mocks.startDlaBridge ).not.toHaveBeenCalled();
	} );

	it( 'disposes the bridge after the session in the finally block', async () => {
		const disposeMock = vi.fn( async () => {
			mocks.dlaBridgeDisposeOrder.push( 'bridge.dispose' );
		} );
		mocks.startDlaBridge.mockResolvedValue( {
			tools: [ fakeDlaTool( 'liberate_detect' ) ],
			degraded: false,
			dispose: disposeMock,
		} satisfies DlaBridge );

		await runRuntime( {
			prompt: 'hello',
			env: { ...baseEnv, STUDIO_DLA_ENABLED: '1' },
			model: 'gpt-5.5',
			session: newSession(),
		} );

		expect( disposeMock ).toHaveBeenCalledTimes( 1 );
		expect( mocks.dlaBridgeDisposeOrder ).toEqual( [ 'session.dispose', 'bridge.dispose' ] );
	} );

	it( 'disposes the bridge even when session.prompt throws', async () => {
		const disposeMock = vi.fn( async () => {
			mocks.dlaBridgeDisposeOrder.push( 'bridge.dispose' );
		} );
		mocks.startDlaBridge.mockResolvedValue( {
			tools: [],
			degraded: false,
			dispose: disposeMock,
		} satisfies DlaBridge );

		mocks.createAgentSession.mockImplementationOnce(
			async ( options: CreateAgentSessionOptions ) => {
				mocks.customToolsCalls.push( ( options.customTools ?? [] ) as ToolDefinition[] );
				const session = new FakeSession( options );
				session.prompt = async () => {
					throw new Error( 'boom' );
				};
				return { session, extensionsResult: { extensions: [], errors: [], runtime: {} } };
			}
		);

		await runRuntime( {
			prompt: 'hello',
			env: { ...baseEnv, STUDIO_DLA_ENABLED: '1' },
			model: 'gpt-5.5',
			session: newSession(),
		} );

		expect( disposeMock ).toHaveBeenCalledTimes( 1 );
		expect( mocks.dlaBridgeDisposeOrder ).toEqual( [ 'session.dispose', 'bridge.dispose' ] );
	} );

	it( 'continues session start when bridge degrades', async () => {
		const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const disposeMock = vi.fn( async () => {} );
		mocks.startDlaBridge.mockResolvedValue( {
			tools: [],
			degraded: true,
			degradationReason: 'spawn ENOENT',
			dispose: disposeMock,
		} satisfies DlaBridge );

		await runRuntime( {
			prompt: 'hello',
			env: { ...baseEnv, STUDIO_DLA_ENABLED: '1' },
			model: 'gpt-5.5',
			session: newSession(),
		} );

		expect( mocks.createAgentSession ).toHaveBeenCalledTimes( 1 );
		expect( mocks.customToolsCalls ).toHaveLength( 1 );
		const toolNames = mocks.customToolsCalls[ 0 ].map( ( tool ) => tool.name );
		expect( toolNames ).not.toEqual( expect.arrayContaining( [ 'liberate_detect' ] ) );
		expect( warnSpy ).toHaveBeenCalled();
		expect( disposeMock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'continues session start when startDlaBridge itself rejects', async () => {
		const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		mocks.startDlaBridge.mockRejectedValue( new Error( 'fatal spawn error' ) );

		await runRuntime( {
			prompt: 'hello',
			env: { ...baseEnv, STUDIO_DLA_ENABLED: '1' },
			model: 'gpt-5.5',
			session: newSession(),
		} );

		expect( mocks.createAgentSession ).toHaveBeenCalledTimes( 1 );
		expect( warnSpy ).toHaveBeenCalled();
	} );
} );
