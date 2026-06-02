/**
 * @vitest-environment node
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';

vi.mock( 'node:child_process', () => ( {
	fork: vi.fn(),
} ) );

vi.mock( '@sentry/electron/main', () => ( {
	captureException: vi.fn(),
} ) );

vi.mock( 'src/storage/paths', () => ( {
	getCliPath: () => '/fake/cli.mjs',
	getBundledNodeBinaryPath: () => '/fake/node',
} ) );

vi.mock( 'src/lib/ai-session-placement', () => ( {
	setAiSessionSitePlacement: vi.fn(),
} ) );

vi.mock( 'src/lib/bump-stats', async () => {
	const actual =
		await vi.importActual< typeof import('src/lib/bump-stats') >( 'src/lib/bump-stats' );
	return {
		...actual,
		bumpStat: vi.fn(),
		bumpAggregatedUniqueStat: vi.fn().mockResolvedValue( undefined ),
	};
} );

class FakeChild extends EventEmitter {
	connected = true;
	killed = false;
	kill = vi.fn();
	send = vi.fn();
}

function fakeWebContents(): WebContents {
	return {
		isDestroyed: () => false,
		send: vi.fn(),
		once: vi.fn(),
	} as unknown as WebContents;
}

async function startRun( sessionId = 'session-1' ) {
	const child = new FakeChild();
	const { fork } = await import( 'node:child_process' );
	vi.mocked( fork ).mockReturnValue( child as never );

	const { startAgentRun } = await import( 'src/modules/ai-agent/run-manager' );
	const { runId } = startAgentRun( {
		sessionId,
		prompt: 'hello',
		webContents: fakeWebContents(),
	} );

	return { child, runId };
}

beforeEach( () => {
	vi.clearAllMocks();
} );

afterEach( () => {
	vi.resetModules();
} );

describe( 'startAgentRun telemetry', () => {
	it( 'bumps the send stat and weekly/monthly uniques when a run starts', async () => {
		const bumpStats = await import( 'src/lib/bump-stats' );
		await startRun();

		expect( bumpStats.bumpStat ).toHaveBeenCalledWith(
			bumpStats.StatsGroup.STUDIO_APP_CODE_CHAT_SEND,
			expect.any( String )
		);
		expect( bumpStats.bumpAggregatedUniqueStat ).toHaveBeenCalledWith(
			bumpStats.StatsGroup.STUDIO_APP_CODE_CHAT_WKLY_UNQ,
			expect.any( String ),
			'weekly'
		);
		expect( bumpStats.bumpAggregatedUniqueStat ).toHaveBeenCalledWith(
			bumpStats.StatsGroup.STUDIO_APP_CODE_CHAT_MON_UNQ,
			expect.any( String ),
			'monthly'
		);
	} );

	it( 'records a success run stat when the subprocess exits cleanly', async () => {
		const bumpStats = await import( 'src/lib/bump-stats' );
		const { child } = await startRun();
		vi.mocked( bumpStats.bumpStat ).mockClear();

		child.emit( 'exit', 0 );

		expect( bumpStats.bumpStat ).toHaveBeenCalledWith(
			bumpStats.StatsGroup.STUDIO_APP_CODE_CHAT_RUN,
			bumpStats.StatsMetric.SUCCESS
		);
	} );

	it( 'records a failure run stat when the subprocess exits non-zero', async () => {
		const bumpStats = await import( 'src/lib/bump-stats' );
		const { child } = await startRun();
		vi.mocked( bumpStats.bumpStat ).mockClear();

		child.emit( 'exit', 1 );

		expect( bumpStats.bumpStat ).toHaveBeenCalledWith(
			bumpStats.StatsGroup.STUDIO_APP_CODE_CHAT_RUN,
			bumpStats.StatsMetric.FAILURE
		);
	} );

	it( 'records an interrupted run stat when the run was interrupted before exit', async () => {
		const bumpStats = await import( 'src/lib/bump-stats' );
		const { child, runId } = await startRun();
		vi.mocked( bumpStats.bumpStat ).mockClear();

		const { interruptAgentRun } = await import( 'src/modules/ai-agent/run-manager' );
		interruptAgentRun( runId );
		child.emit( 'exit', null );

		expect( bumpStats.bumpStat ).toHaveBeenCalledWith(
			bumpStats.StatsGroup.STUDIO_APP_CODE_CHAT_RUN,
			bumpStats.StatsMetric.INTERRUPTED
		);
	} );
} );
