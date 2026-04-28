import { describe, expect, it, vi } from 'vitest';
import { RemoteSessionLogger } from 'cli/remote-session/logger';
import { ProgressStreamer } from 'cli/remote-session/progress-streamer';
import type { RemoteSessionConfig } from 'cli/remote-session/config';

const baseConfig: RemoteSessionConfig = {
	base_url: 'https://api.example.test/telegram-bot',
	token: 't',
	bot: 'b',
	chat_id: 1,
	poll_interval_seconds: 2,
	long_poll_timeout_seconds: 25,
	max_message_chars: 3800,
	turn_timeout_seconds: 900,
};

interface FakeClock {
	now: number;
	pending: Array< { fn: () => void; runAt: number } >;
	advance: ( ms: number ) => void;
}

function makeClock(): FakeClock {
	const clock: FakeClock = {
		now: 0,
		pending: [],
		advance( ms ) {
			this.now += ms;
			const due = this.pending.filter( ( p ) => p.runAt <= this.now );
			this.pending = this.pending.filter( ( p ) => p.runAt > this.now );
			for ( const d of due ) {
				d.fn();
			}
		},
	};
	return clock;
}

function makeStreamer( overrides: { intervalMs?: number; maxChars?: number } = {} ) {
	const respond = vi.fn().mockResolvedValue( undefined );
	const logger = new RemoteSessionLogger( '/dev/null' );
	const clock = makeClock();
	const streamer = new ProgressStreamer( {
		config: baseConfig,
		target: { chatId: 1, bot: 'b' },
		intervalMs: overrides.intervalMs ?? 10_000,
		maxChars: overrides.maxChars ?? 200,
		deps: {
			respond,
			logger,
			now: () => clock.now,
			setTimeout: ( ( fn: () => void, ms: number ) => {
				const handle = { fn, runAt: clock.now + ms };
				clock.pending.push( handle );
				return handle as unknown as ReturnType< typeof setTimeout >;
			} ) as ProgressStreamer[ 'deps' ][ 'setTimeout' ],
			clearTimeout: ( ( handle: unknown ) => {
				clock.pending = clock.pending.filter( ( p ) => p !== handle );
			} ) as ProgressStreamer[ 'deps' ][ 'clearTimeout' ],
		},
	} );
	return { streamer, respond, clock };
}

describe( 'ProgressStreamer', () => {
	it( 'posts the first info event immediately with a ⏳ prefix', () => {
		const { streamer, respond } = makeStreamer();
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'Installing plugin' } );
		expect( respond ).toHaveBeenCalledTimes( 1 );
		const text = respond.mock.calls[ 0 ][ 1 ].text;
		expect( text ).toBe( '⏳ Installing plugin' );
	} );

	it( 'forwards `progress` events too', () => {
		const { streamer, respond } = makeStreamer();
		streamer.onEvent( { type: 'progress', timestamp: 't', message: 'Downloading' } );
		expect( respond ).toHaveBeenCalledTimes( 1 );
		expect( respond.mock.calls[ 0 ][ 1 ].text ).toBe( '⏳ Downloading' );
	} );

	it( 'ignores non-info / non-progress events', () => {
		const { streamer, respond } = makeStreamer();
		streamer.onEvent( { type: 'turn.started', timestamp: 't' } );
		streamer.onEvent( { type: 'message', timestamp: 't', message: { type: 'result' } } );
		streamer.onEvent( {
			type: 'turn.completed',
			timestamp: 't',
			sessionId: 's',
			status: 'success',
		} );
		expect( respond ).not.toHaveBeenCalled();
	} );

	it( 'ignores empty / whitespace-only messages', () => {
		const { streamer, respond } = makeStreamer();
		streamer.onEvent( { type: 'info', timestamp: 't', message: '   ' } );
		streamer.onEvent( { type: 'info', timestamp: 't', message: '' } );
		expect( respond ).not.toHaveBeenCalled();
	} );

	it( 'coalesces bursts within the cooldown window: only the latest is posted at flush', () => {
		const { streamer, respond, clock } = makeStreamer( { intervalMs: 10_000 } );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'first' } );
		expect( respond ).toHaveBeenCalledTimes( 1 );
		expect( respond.mock.calls[ 0 ][ 1 ].text ).toBe( '⏳ first' );

		// Burst during cooldown — only the last should survive.
		clock.advance( 1000 );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'second' } );
		clock.advance( 1000 );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'third' } );
		clock.advance( 1000 );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'fourth' } );
		expect( respond ).toHaveBeenCalledTimes( 1 );

		// Advance past the cooldown — the latest pending should fire.
		clock.advance( 10_000 );
		expect( respond ).toHaveBeenCalledTimes( 2 );
		expect( respond.mock.calls[ 1 ][ 1 ].text ).toBe( '⏳ fourth' );
	} );

	it( 'collapses whitespace and truncates long messages', () => {
		const { streamer, respond } = makeStreamer( { maxChars: 20 } );
		streamer.onEvent( {
			type: 'info',
			timestamp: 't',
			message: 'one\ttwo\n  three   four five six seven',
		} );
		const text = respond.mock.calls[ 0 ][ 1 ].text;
		expect( text.startsWith( '⏳ ' ) ).toBe( true );
		// 20 chars of payload, last char becomes `…`.
		expect( text.length ).toBe( '⏳ '.length + 20 );
		expect( text.endsWith( '…' ) ).toBe( true );
	} );

	it( 'stop() cancels a pending flush', () => {
		const { streamer, respond, clock } = makeStreamer( { intervalMs: 10_000 } );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'first' } );
		clock.advance( 1000 );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'queued' } );
		streamer.stop();
		clock.advance( 60_000 );
		expect( respond ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'after stop(), further events are ignored', () => {
		const { streamer, respond } = makeStreamer();
		streamer.stop();
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'too late' } );
		expect( respond ).not.toHaveBeenCalled();
	} );

	it( 'does not throw when the underlying respond fails (logged, swallowed)', async () => {
		const { streamer, respond } = makeStreamer();
		respond.mockRejectedValueOnce( new Error( 'network down' ) );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'go' } );
		// Yield so the rejected promise's catch handler runs.
		await new Promise( ( resolve ) => setImmediate( resolve ) );
		expect( respond ).toHaveBeenCalledTimes( 1 );
	} );
} );
