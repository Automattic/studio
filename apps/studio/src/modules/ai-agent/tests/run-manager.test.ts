import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import type { ChildProcess } from 'node:child_process';

const forkMock = vi.hoisted( () => vi.fn() );

vi.mock( 'node:child_process', () => ( {
	default: { fork: forkMock },
	fork: forkMock,
} ) );

vi.mock( 'src/storage/paths', () => ( {
	getBundledNodeBinaryPath: () => '/usr/bin/node',
	getCliPath: () => '/tmp/studio-cli.mjs',
} ) );

class FakeChildProcess extends EventEmitter {
	connected = true;
	killed = false;
	send = vi.fn();
	kill = vi.fn( () => {
		this.killed = true;
		return true;
	} );
}

function createWebContents(): WebContents {
	return {
		isDestroyed: vi.fn( () => false ),
		send: vi.fn(),
		once: vi.fn(),
	} as unknown as WebContents;
}

describe( 'ai-agent run-manager', () => {
	beforeEach( () => {
		vi.resetModules();
		vi.clearAllMocks();
	} );

	it( 'releases the per-session run lock immediately on interrupt', async () => {
		const firstChild = new FakeChildProcess();
		const secondChild = new FakeChildProcess();
		forkMock
			.mockReturnValueOnce( firstChild as unknown as ChildProcess )
			.mockReturnValueOnce( secondChild as unknown as ChildProcess );

		const { interruptAgentRun, startAgentRun } = await import( '../run-manager' );
		const webContents = createWebContents();

		const firstRun = startAgentRun( {
			sessionId: 'session-1',
			prompt: 'Build a site',
			webContents,
		} );

		expect( () =>
			startAgentRun( {
				sessionId: 'session-1',
				prompt: 'Before interrupt',
				webContents,
			} )
		).toThrow( /already in progress/ );

		interruptAgentRun( firstRun.runId );

		expect( firstChild.send ).toHaveBeenCalledWith( { type: 'interrupt' } );
		expect( () =>
			startAgentRun( {
				sessionId: 'session-1',
				prompt: 'Try a different layout',
				webContents,
			} )
		).not.toThrow();
		expect( forkMock ).toHaveBeenCalledTimes( 2 );
	} );
} );
