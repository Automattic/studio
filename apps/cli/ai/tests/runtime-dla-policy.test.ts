import { SessionManager } from '@earendil-works/pi-coding-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runStudioAgentTurn, type StudioAgentTurnConfig } from 'cli/ai/runtimes/pi';
import type {
	AgentSessionEvent,
	CreateAgentSessionOptions,
	DefaultResourceLoader as DefaultResourceLoaderType,
	ExtensionFactory,
} from '@earendil-works/pi-coding-agent';

type DefaultResourceLoaderOptions = ConstructorParameters< typeof DefaultResourceLoaderType >[ 0 ];

const mocks = vi.hoisted( () => ( {
	createAgentSession: vi.fn(),
	resourceLoaderOptions: [] as DefaultResourceLoaderOptions[],
	dlaPolicyFactoryToken: Symbol( 'dla-policy-factory-token' ),
	createDlaPolicyFactoryCalls: [] as unknown[],
} ) );

vi.mock( '@studio/dla', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@studio/dla') >();
	const sentinelFactory = ( () => {
		// Tag the factory so tests can identify it by reference equality
		// in the captured `DefaultResourceLoader` constructor options.
		const factory: ExtensionFactory = () => {};
		( factory as unknown as { __token: symbol } ).__token = mocks.dlaPolicyFactoryToken;
		return factory;
	} )();
	return {
		...actual,
		createDlaPolicyFactory: ( buckets?: unknown ) => {
			mocks.createDlaPolicyFactoryCalls.push( buckets );
			return sentinelFactory;
		},
	};
} );

vi.mock( '@earendil-works/pi-coding-agent', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@earendil-works/pi-coding-agent') >();
	const stub = ( name: string ) => ( {
		name,
		label: name,
		description: name,
		parameters: {},
		execute: async () => ( { content: [ { type: 'text', text: '' } ], details: undefined } ),
	} );

	// Capture every construction so tests can assert on the
	// `extensionFactories` slot for the relevant turn.
	class CapturingResourceLoader extends actual.DefaultResourceLoader {
		constructor( options: DefaultResourceLoaderOptions ) {
			super( options );
			mocks.resourceLoaderOptions.push( options );
		}
	}

	return {
		...actual,
		createAgentSession: mocks.createAgentSession,
		DefaultResourceLoader: CapturingResourceLoader,
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
	public aborted = false;
	public disposed = false;

	constructor( public options: CreateAgentSessionOptions ) {}

	subscribe( listener: ( event: AgentSessionEvent ) => void ): () => void {
		this.listener = listener;
		return () => {};
	}

	async prompt(): Promise< void > {
		this.listener?.( { type: 'agent_end', messages: [], willRetry: false } );
	}

	async abort(): Promise< void > {
		this.aborted = true;
	}

	dispose(): void {
		this.disposed = true;
	}
}

const newSession = () => SessionManager.inMemory( '/tmp/eval-dla-policy' );

async function runRuntime( config: Omit< StudioAgentTurnConfig, 'onEvent' > ): Promise< void > {
	const handle = runStudioAgentTurn( { ...config, onEvent: () => {} } );
	await handle.result;
}

const baseEnv = {
	OPENAI_API_KEY: 'sk-test',
	OPENAI_BASE_URL: 'https://proxy.example.com/v1',
};

describe( 'pi runtime DLA policy wiring', () => {
	beforeEach( () => {
		mocks.resourceLoaderOptions.length = 0;
		mocks.createDlaPolicyFactoryCalls.length = 0;
		mocks.createAgentSession.mockReset();
		mocks.createAgentSession.mockImplementation( async ( options: CreateAgentSessionOptions ) => {
			const session = new FakeSession( options );
			return { session, extensionsResult: { extensions: [], errors: [], runtime: {} } };
		} );
	} );

	it( 'mounts the DLA policy factory on DefaultResourceLoader when STUDIO_DLA_ENABLED=1', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: { ...baseEnv, STUDIO_DLA_ENABLED: '1' },
			model: 'gpt-5.5',
			session: newSession(),
		} );

		expect( mocks.resourceLoaderOptions ).toHaveLength( 1 );
		const factories = mocks.resourceLoaderOptions[ 0 ].extensionFactories;
		expect( factories ).toHaveLength( 1 );
		expect( ( factories![ 0 ] as unknown as { __token: symbol } ).__token ).toBe(
			mocks.dlaPolicyFactoryToken
		);
		expect( mocks.createDlaPolicyFactoryCalls ).toHaveLength( 1 );
	} );

	it( 'does not mount the DLA policy factory when STUDIO_DLA_ENABLED is unset', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: { ...baseEnv },
			model: 'gpt-5.5',
			session: newSession(),
		} );

		expect( mocks.resourceLoaderOptions ).toHaveLength( 1 );
		expect( mocks.resourceLoaderOptions[ 0 ].extensionFactories ).toEqual( [] );
		expect( mocks.createDlaPolicyFactoryCalls ).toHaveLength( 0 );
	} );

	it( 'does not mount the DLA policy factory when STUDIO_DLA_ENABLED=0', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: { ...baseEnv, STUDIO_DLA_ENABLED: '0' },
			model: 'gpt-5.5',
			session: newSession(),
		} );

		expect( mocks.resourceLoaderOptions ).toHaveLength( 1 );
		expect( mocks.resourceLoaderOptions[ 0 ].extensionFactories ).toEqual( [] );
		expect( mocks.createDlaPolicyFactoryCalls ).toHaveLength( 0 );
	} );

	it( 'leaves noExtensions: true intact when DLA is enabled (inline factories still load)', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: { ...baseEnv, STUDIO_DLA_ENABLED: '1' },
			model: 'gpt-5.5',
			session: newSession(),
		} );

		expect( mocks.resourceLoaderOptions[ 0 ].noExtensions ).toBe( true );
	} );
} );
