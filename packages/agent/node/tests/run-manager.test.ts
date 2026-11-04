import { fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { updateSharedSession } from '@studio/common/lib/shared-config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentRunManager } from '@studio/agent/node/run-manager';

vi.mock( 'node:child_process', () => {
	const forkMock = vi.fn();
	return { fork: forkMock, default: { fork: forkMock } };
} );
vi.mock( '@studio/agent/node/agent-stats', () => ( {
	recordAgentSend: vi.fn(),
	recordAgentRun: vi.fn(),
} ) );
vi.mock( '@studio/agent/node/sessions/placement', () => ( {
	getCreatedSiteFromArtifact: vi.fn(),
	setAiSessionSitePlacement: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/error-reporting', () => ( { captureException: vi.fn() } ) );
vi.mock( '@studio/common/lib/shared-config', () => ( {
	updateSharedSession: vi.fn().mockResolvedValue( undefined ),
} ) );

const mockFork = vi.mocked( fork );

function createChild() {
	const child = new EventEmitter() as EventEmitter & { kill: () => void; send: () => void };
	child.kill = vi.fn();
	child.send = vi.fn();
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

describe( 'createAgentRunManager active runs', () => {
	const question = { question: 'Which layout?', options: [ { label: 'Grid', description: '' } ] };

	it( 'lists the questions a run is waiting on until they are answered', async () => {
		const child = Object.assign( createChild(), { connected: true } );
		mockFork.mockImplementation( () => child as never );
		const manager = createAgentRunManager( {
			cliBinary: '/cli.mjs',
			surface: 'cliui',
			emit: vi.fn(),
		} );
		const { runId } = manager.startAgentRun( { sessionId: 'session-1', prompt: 'hello' } );

		child.emit( 'message', { type: 'question.asked', timestamp: '', questions: [ question ] } );
		await vi.waitFor( () =>
			expect( manager.listActiveAgentRuns()[ 0 ].pendingQuestions ).toEqual( [ question ] )
		);

		manager.answerAgentRun( runId, { 'Which layout?': 'Grid' } );
		expect( manager.listActiveAgentRuns()[ 0 ].pendingQuestions ).toEqual( [] );
	} );

	it( 'marks the chat unread when a turn finishes, before reporting the exit', async () => {
		const child = createChild();
		mockFork.mockImplementation( () => child as never );
		const emit = vi.fn();
		const manager = createAgentRunManager( { cliBinary: '/cli.mjs', surface: 'cliui', emit } );
		manager.startAgentRun( { sessionId: 'session-1', prompt: 'hello' } );

		child.emit( 'exit', 0 );

		await vi.waitFor( () =>
			expect( emit ).toHaveBeenCalledWith(
				expect.objectContaining( {
					event: expect.objectContaining( {
						event: expect.objectContaining( { type: 'run.exited' } ),
					} ),
				} )
			)
		);
		expect( updateSharedSession ).toHaveBeenCalledWith( 'session-1', { unread: true } );
	} );
} );

it( 'passes the exact dispatched turn ID through the existing input payload', () => {
	const child = createChild();
	mockFork.mockReturnValueOnce( child as never );
	const manager = createAgentRunManager( {
		cliBinary: '/cli.mjs',
		surface: 'desktop',
		emit: vi.fn(),
	} );
	const turnId = crypto.randomUUID();
	manager.startAgentRun( { sessionId: 'correlated', prompt: 'hello', turnId } );
	const args = mockFork.mock.calls.at( -1 )![ 1 ] as string[];
	const input = args[ args.indexOf( '--input-payload' ) + 1 ];
	expect( JSON.parse( fs.readFileSync( input, 'utf8' ) ) ).toMatchObject( {
		prompt: 'hello',
		turnId,
	} );
	child.emit( 'exit', 0 );
} );
