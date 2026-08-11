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

function getForkEnv(): NodeJS.ProcessEnv {
	const options = mockFork.mock.calls[ 0 ][ 2 ] as { env: NodeJS.ProcessEnv };
	return options.env;
}

describe( 'createAgentRunManager fork environment', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		mockFork.mockReturnValue( createChild() as never );
	} );

	// The forked CLI is what emits the Studio Code Tracks events, and it reads this env var to decide
	// whether the run came from a UI. Without it, desktop chat is attributed to `channel: studio-cli`.
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

	// The user can switch renderer without restarting, so a value captured once at wiring time would
	// keep reporting the old one.
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
		mockFork.mockReturnValue( createChild() as never );
		manager.startAgentRun( { sessionId: 'session-2', prompt: 'hello again' } );

		const secondEnv = mockFork.mock.calls[ 1 ][ 2 ] as { env: NodeJS.ProcessEnv };
		expect( secondEnv.env.STUDIO_TRACKS_ORIGIN ).toBe( 'studio-ui:v2' );
	} );

	// `studio ui` leaves it unset, so its runs fall through to `channel: studio-cli` — see STU-2247.
	it( 'omits the origin when the host does not supply one', () => {
		const manager = createAgentRunManager( {
			cliBinary: '/cli.mjs',
			surface: 'cliui',
			emit: vi.fn(),
		} );

		manager.startAgentRun( { sessionId: 'session-1', prompt: 'hello' } );

		expect( getForkEnv().STUDIO_TRACKS_ORIGIN ).toBeUndefined();
	} );

	it( 'keeps the parent environment', () => {
		process.env.STUDIO_TEST_PARENT_VAR = 'kept';
		const manager = createAgentRunManager( {
			cliBinary: '/cli.mjs',
			surface: 'desktop',
			emit: vi.fn(),
			getTracksOrigin: () => 'studio-ui:v2',
		} );

		manager.startAgentRun( { sessionId: 'session-1', prompt: 'hello' } );

		expect( getForkEnv().STUDIO_TEST_PARENT_VAR ).toBe( 'kept' );
		delete process.env.STUDIO_TEST_PARENT_VAR;
	} );
} );
