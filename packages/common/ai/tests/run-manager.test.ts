import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentRunManager } from '../run-manager';

const forkMock = vi.hoisted( () => vi.fn() );

vi.mock( 'node:child_process', () => ( {
	default: { fork: forkMock },
	fork: forkMock,
} ) );

vi.mock( '@studio/common/ai/agent-stats', () => ( {
	recordAgentRun: vi.fn(),
	recordAgentSend: vi.fn(),
} ) );

vi.mock( '@studio/common/ai/sessions/placement', () => ( {
	getCreatedSiteFromArtifact: vi.fn( () => null ),
	setAiSessionSitePlacement: vi.fn(),
} ) );

vi.mock( '@studio/common/lib/error-reporting', () => ( {
	captureException: vi.fn(),
} ) );

class FakeChild extends EventEmitter {
	connected = true;
	killed = false;
	send = vi.fn( () => true );
	kill = vi.fn( () => {
		this.killed = true;
		return true;
	} );
}

function createManager() {
	return createAgentRunManager( {
		cliBinary: '/fake/cli/main.mjs',
		nodeBinary: '/fake/node',
		surface: 'desktop',
		emit: vi.fn(),
	} );
}

describe( 'AgentRunManager.steerAgentRun', () => {
	let child: FakeChild;

	beforeEach( () => {
		vi.clearAllMocks();
		child = new FakeChild();
		forkMock.mockReturnValue( child );
	} );

	it( 'forwards the steer message to the running child', () => {
		const manager = createManager();
		const { runId } = manager.startAgentRun( { sessionId: 'session-1', prompt: 'build a site' } );

		const forwarded = manager.steerAgentRun( runId, 'make the hero darker', 'steer-1' );

		expect( forwarded ).toBe( true );
		expect( child.send ).toHaveBeenCalledWith( {
			type: 'steer',
			text: 'make the hero darker',
			id: 'steer-1',
		} );
	} );

	it( 'omits the correlation id when the caller does not pass one', () => {
		const manager = createManager();
		const { runId } = manager.startAgentRun( { sessionId: 'session-1', prompt: 'build a site' } );

		expect( manager.steerAgentRun( runId, 'add a contact page' ) ).toBe( true );
		expect( child.send ).toHaveBeenCalledWith( { type: 'steer', text: 'add a contact page' } );
	} );

	it( 'reports the steer as not forwarded when the run is unknown', () => {
		const manager = createManager();

		expect( manager.steerAgentRun( 'missing-run', 'too late' ) ).toBe( false );
	} );

	it( 'reports the steer as not forwarded when the child is disconnected', () => {
		const manager = createManager();
		const { runId } = manager.startAgentRun( { sessionId: 'session-1', prompt: 'build a site' } );
		child.connected = false;

		expect( manager.steerAgentRun( runId, 'too late' ) ).toBe( false );
		expect( child.send ).not.toHaveBeenCalled();
	} );
} );
