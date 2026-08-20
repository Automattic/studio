import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentRunManager } from '../run-manager';

vi.mock( 'node:child_process', () => {
	const forkMock = vi.fn();
	return { fork: forkMock, default: { fork: forkMock } };
} );
vi.mock( '@studio/common/ai/agent-stats', () => ( {
	recordAgentSend: vi.fn(),
	recordAgentRun: vi.fn(),
} ) );
vi.mock( '@studio/common/ai/sessions/placement', () => ( {
	getCreatedSiteFromArtifact: vi.fn(),
	setAiSessionSitePlacement: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/error-reporting', () => ( { captureException: vi.fn() } ) );

const mockFork = vi.mocked( fork );

function createChild() {
	const child = new EventEmitter() as EventEmitter & { kill: () => void; send: () => void };
	child.kill = vi.fn();
	child.send = vi.fn();
	return child;
}

function createConnectedChild() {
	const child = createChild() as ReturnType< typeof createChild > & {
		connected: boolean;
		killed: boolean;
	};
	child.connected = true;
	child.killed = false;
	return child;
}

function getForkEnv( callIndex = 0 ): NodeJS.ProcessEnv {
	const options = mockFork.mock.calls[ callIndex ][ 2 ] as { env: NodeJS.ProcessEnv };
	return options.env;
}

describe( 'createAgentRunManager fork environment', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mockFork.mockReset();
		mockFork.mockImplementation( () => createChild() as never );
	} );

	// Without this, desktop chat is attributed to `channel: studio-cli`.
	it( 'passes the resolved tracks origin to the CLI child', () => {
		const manager = createAgentRunManager( {
			cliBinary: '/cli.mjs',
			surface: 'desktop',
			emit: vi.fn(),
			getTracksOrigin: () => 'studio-ui:v2',
		} );

		manager.startAgentRun( { sessionId: 'session-1', prompt: 'hello' } );

		expect( getForkEnv().STUDIO_TRACKS_ORIGIN ).toBe( 'studio-ui:v2' );
	} );

	// The user can switch renderer without restarting.
	it( 'resolves the origin per run rather than once', () => {
		let uiVersion = 'v1';
		const manager = createAgentRunManager( {
			cliBinary: '/cli.mjs',
			surface: 'desktop',
			emit: vi.fn(),
			getTracksOrigin: () => `studio-ui:${ uiVersion }`,
		} );

		manager.startAgentRun( { sessionId: 'session-1', prompt: 'hello' } );
		expect( getForkEnv().STUDIO_TRACKS_ORIGIN ).toBe( 'studio-ui:v1' );

		uiVersion = 'v2';
		manager.startAgentRun( { sessionId: 'session-2', prompt: 'hello again' } );

		expect( getForkEnv( 1 ).STUDIO_TRACKS_ORIGIN ).toBe( 'studio-ui:v2' );
	} );

	// `studio ui` instead sets `STUDIO_TRACKS_ORIGIN` on its own process, which the fork inherits.
	it( 'omits the origin when the host does not supply one', () => {
		const manager = createAgentRunManager( {
			cliBinary: '/cli.mjs',
			surface: 'cliui',
			emit: vi.fn(),
		} );

		manager.startAgentRun( { sessionId: 'session-1', prompt: 'hello' } );

		expect( getForkEnv().STUDIO_TRACKS_ORIGIN ).toBeUndefined();
	} );
} );

// Two CLI children resuming the same session would both append to its JSONL
// from independently tracked leaf pointers, forking the entry tree. Callers
// sequence the next run behind this promise, so it must not resolve while the
// interrupted child is still winding down.
describe( 'createAgentRunManager interrupt', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mockFork.mockReset();
	} );

	it( 'resolves only once the interrupted child has exited', async () => {
		const child = createConnectedChild();
		mockFork.mockImplementation( () => child as never );
		const manager = createAgentRunManager( {
			cliBinary: '/cli.mjs',
			surface: 'desktop',
			emit: vi.fn(),
		} );

		const { runId } = manager.startAgentRun( { sessionId: 'session-1', prompt: 'hello' } );

		let resolved = false;
		const interrupted = manager.interruptAgentRun( runId ).then( () => {
			resolved = true;
		} );

		expect( child.send ).toHaveBeenCalledWith( { type: 'interrupt' } );
		await Promise.resolve();
		expect( resolved ).toBe( false );

		child.emit( 'exit', 0 );
		await interrupted;

		expect( resolved ).toBe( true );
	} );

	it( 'resolves immediately for a run that is already gone', async () => {
		const child = createConnectedChild();
		mockFork.mockImplementation( () => child as never );
		const manager = createAgentRunManager( {
			cliBinary: '/cli.mjs',
			surface: 'desktop',
			emit: vi.fn(),
		} );

		const { runId } = manager.startAgentRun( { sessionId: 'session-1', prompt: 'hello' } );
		child.emit( 'exit', 0 );

		await expect( manager.interruptAgentRun( runId ) ).resolves.toBeUndefined();
	} );

	// A child that fails to spawn emits `close` and never `exit`; without that
	// fallback the queued follow-up would wait forever.
	it( 'resolves when the child fails to spawn', async () => {
		const child = createConnectedChild();
		mockFork.mockImplementation( () => child as never );
		const manager = createAgentRunManager( {
			cliBinary: '/cli.mjs',
			surface: 'desktop',
			emit: vi.fn(),
		} );

		const { runId } = manager.startAgentRun( { sessionId: 'session-1', prompt: 'hello' } );
		const interrupted = manager.interruptAgentRun( runId );
		child.emit( 'error', new Error( 'spawn ENOENT' ) );
		child.emit( 'close', null );

		await expect( interrupted ).resolves.toBeUndefined();
	} );

	// `error` also fires for a failed `send()`/`kill()` while the child is very
	// much alive. Treating it as the end would let the next run fork a second
	// CLI child onto the same session file.
	it( 'does not resolve on an error from a child that is still running', async () => {
		const child = createConnectedChild();
		mockFork.mockImplementation( () => child as never );
		const manager = createAgentRunManager( {
			cliBinary: '/cli.mjs',
			surface: 'desktop',
			emit: vi.fn(),
		} );

		const { runId } = manager.startAgentRun( { sessionId: 'session-1', prompt: 'hello' } );

		let resolved = false;
		void manager.interruptAgentRun( runId ).then( () => {
			resolved = true;
		} );
		child.emit( 'error', new Error( 'channel closed' ) );
		await Promise.resolve();

		expect( resolved ).toBe( false );
	} );

	// Both events fire for a normal ending, but the run only ends once.
	it( 'ends the run once when exit and close both fire', async () => {
		const child = createConnectedChild();
		mockFork.mockImplementation( () => child as never );
		const emit = vi.fn();
		const manager = createAgentRunManager( {
			cliBinary: '/cli.mjs',
			surface: 'desktop',
			emit,
		} );

		manager.startAgentRun( { sessionId: 'session-1', prompt: 'hello' } );
		child.emit( 'exit', 0 );
		child.emit( 'close', 0 );
		await vi.waitFor( () =>
			expect(
				emit.mock.calls.filter( ( [ output ] ) => output.event?.event?.type === 'run.exited' )
			).toHaveLength( 1 )
		);
	} );
} );
