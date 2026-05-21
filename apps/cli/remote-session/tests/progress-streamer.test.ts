import { describe, expect, it, vi } from 'vitest';
import { RemoteSessionLogger } from 'cli/remote-session/logger';
import { ProgressStreamer } from 'cli/remote-session/progress-streamer';
import type { JsonEvent } from '@studio/common/ai/json-events';
import type { RemoteSessionConfig } from 'cli/remote-session/config';
import type { RespondOutcome } from 'cli/remote-session/telegram-client';

// The streamer reads pi events via a defensive narrowing interface
// (PiAgentMessageLike). Tests assemble minimal fixtures that match the runtime
// shape the streamer cares about; this helper bypasses the full AgentMessage /
// AgentSessionEvent types without infecting the test with `any`.
function piEvent( shape: unknown ): JsonEvent {
	return shape as JsonEvent;
}

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

function okOutcome( messageId?: number, extra: Partial< RespondOutcome > = {} ): RespondOutcome {
	return {
		success: true,
		messageIds: messageId === undefined ? [] : [ messageId ],
		...extra,
	};
}

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

async function flushPromises( times = 5 ): Promise< void > {
	// Several microtask hops because the streamer's queue chains setState
	// across multiple `.then()`s before the next post sees the update.
	for ( let i = 0; i < times; i++ ) {
		await new Promise( ( resolve ) => setImmediate( resolve ) );
	}
}

function makeStreamer( overrides: { intervalMs?: number; maxChars?: number } = {} ) {
	const respond = vi.fn< ( ...args: unknown[] ) => Promise< RespondOutcome > >();
	respond.mockResolvedValue( okOutcome() );
	const logger = new RemoteSessionLogger( { logPath: '/dev/null' } );
	const clock = makeClock();
	const streamer = new ProgressStreamer( {
		config: baseConfig,
		target: { chatId: 1, bot: 'b' },
		intervalMs: overrides.intervalMs ?? 10_000,
		maxChars: overrides.maxChars ?? 200,
		deps: {
			respond: respond as unknown as ProgressStreamer[ 'deps' ][ 'respond' ],
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
	it( 'posts the first info event immediately as an italicized create with a ⏳ prefix', async () => {
		const { streamer, respond } = makeStreamer();
		respond.mockResolvedValueOnce( okOutcome( 1001 ) );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'Installing plugin' } );
		await flushPromises();
		expect( respond ).toHaveBeenCalledTimes( 1 );
		const params = respond.mock.calls[ 0 ][ 1 ] as Record< string, unknown >;
		expect( params.action ).toBe( 'create' );
		expect( params.text ).toBe( '⏳ _Installing plugin_' );
		expect( params.messageId ).toBeUndefined();
	} );

	it( 'forwards `progress` events too', async () => {
		const { streamer, respond } = makeStreamer();
		streamer.onEvent( { type: 'progress', timestamp: 't', message: 'Downloading' } );
		await flushPromises();
		expect( respond ).toHaveBeenCalledTimes( 1 );
		expect( ( respond.mock.calls[ 0 ][ 1 ] as { text: string } ).text ).toBe( '⏳ _Downloading_' );
	} );

	it( 'ignores lifecycle and uninteresting message events', async () => {
		const { streamer, respond } = makeStreamer();
		streamer.onEvent( { type: 'turn.started', timestamp: 't' } );
		// `message_start` and `tool_execution_update` are deliberately dropped —
		// the corresponding *_end events carry the same info.
		streamer.onEvent(
			piEvent( {
				type: 'message',
				timestamp: 't',
				message: { type: 'message_start', message: { role: 'assistant', content: [] } },
			} )
		);
		streamer.onEvent(
			piEvent( {
				type: 'message',
				timestamp: 't',
				message: {
					type: 'tool_execution_update',
					toolCallId: 'c',
					toolName: 'foo',
					args: {},
					partialResult: null,
				},
			} )
		);
		streamer.onEvent( {
			type: 'turn.completed',
			timestamp: 't',
			sessionId: 's',
			status: 'success',
		} );
		await flushPromises();
		expect( respond ).not.toHaveBeenCalled();
	} );

	it( 'forwards tool_execution_start with a human-readable italic description', async () => {
		const { streamer, respond } = makeStreamer();
		streamer.onEvent(
			piEvent( {
				type: 'message',
				timestamp: 't',
				message: {
					type: 'tool_execution_start',
					toolCallId: 'c1',
					toolName: 'site_stop',
					args: { nameOrPath: 'Catnap' },
				},
			} )
		);
		await flushPromises();
		expect( respond ).toHaveBeenCalledTimes( 1 );
		expect( ( respond.mock.calls[ 0 ][ 1 ] as { text: string } ).text ).toBe(
			'🔧 _Stopping Catnap_'
		);
	} );

	it( 'pairs tool_execution_end with the start args so the completion line names the subject', async () => {
		const { streamer, respond, clock } = makeStreamer( { intervalMs: 1000 } );
		respond.mockResolvedValueOnce( okOutcome( 1001 ) );

		// Start: site_start with a concrete site name.
		streamer.onEvent(
			piEvent( {
				type: 'message',
				timestamp: 't',
				message: {
					type: 'tool_execution_start',
					toolCallId: 'c1',
					toolName: 'site_start',
					args: { nameOrPath: 'Niche Coffee' },
				},
			} )
		);
		await flushPromises();
		expect( ( respond.mock.calls[ 0 ][ 1 ] as { text: string } ).text ).toBe(
			'🔧 _Starting Niche Coffee_'
		);

		// End: streamer recalls the start args and produces a matching completion line.
		clock.advance( 1500 );
		streamer.onEvent(
			piEvent( {
				type: 'message',
				timestamp: 't',
				message: {
					type: 'tool_execution_end',
					toolCallId: 'c1',
					toolName: 'site_start',
					result: null,
					isError: false,
				},
			} )
		);
		await flushPromises();
		expect( ( respond.mock.calls[ 1 ][ 1 ] as { text: string } ).text ).toBe(
			'✅ _Started Niche Coffee_'
		);
	} );

	it( 'falls back gracefully when a tool_execution_end has no remembered args', async () => {
		const { streamer, respond } = makeStreamer( { intervalMs: 1000 } );
		// No matching start event — the streamer should still render *something*.
		streamer.onEvent(
			piEvent( {
				type: 'message',
				timestamp: 't',
				message: {
					type: 'tool_execution_end',
					toolCallId: 'orphan',
					toolName: 'site_stop',
					result: null,
					isError: true,
				},
			} )
		);
		await flushPromises();
		expect( ( respond.mock.calls[ 0 ][ 1 ] as { text: string } ).text ).toBe(
			'⚠️ _Failed to stop site_'
		);
	} );

	it( 'humanizes unknown tool names with a generic fallback', async () => {
		const { streamer, respond } = makeStreamer();
		streamer.onEvent(
			piEvent( {
				type: 'message',
				timestamp: 't',
				message: {
					type: 'tool_execution_start',
					toolCallId: 'c1',
					toolName: 'frobnicate_widget',
					args: {},
				},
			} )
		);
		await flushPromises();
		expect( ( respond.mock.calls[ 0 ][ 1 ] as { text: string } ).text ).toBe(
			'🔧 _Running frobnicate widget_'
		);
	} );

	it( 'forwards message_end with assistant content, picking the latest interesting block', async () => {
		const { streamer, respond, clock } = makeStreamer( { intervalMs: 1000 } );
		respond.mockResolvedValueOnce( okOutcome( 1001 ) );

		// text + toolCall in one message → prefer the toolCall (the action),
		// and the streamer remembers the args for the matching end event.
		streamer.onEvent(
			piEvent( {
				type: 'message',
				timestamp: 't',
				message: {
					type: 'message_end',
					message: {
						role: 'assistant',
						content: [
							{ type: 'text', text: 'Stopping all sites now.' },
							{ type: 'toolCall', id: 'c1', name: 'site_stop', arguments: { nameOrPath: 'VL' } },
						],
					},
				},
			} )
		);
		await flushPromises();
		expect( ( respond.mock.calls[ 0 ][ 1 ] as { text: string } ).text ).toBe( '🔧 _Stopping VL_' );

		// text-only block → surface the text in italic so it visually
		// matches the other live-status lines.
		clock.advance( 1500 );
		streamer.onEvent(
			piEvent( {
				type: 'message',
				timestamp: 't',
				message: {
					type: 'message_end',
					message: {
						role: 'assistant',
						content: [ { type: 'text', text: 'All stopped! Starting Niche Coffee.' } ],
					},
				},
			} )
		);
		await flushPromises();
		expect( ( respond.mock.calls[ 1 ][ 1 ] as { text: string } ).text ).toBe(
			'_All stopped! Starting Niche Coffee._'
		);
	} );

	it( 'forwards thinking blocks as 💭 <italic preview>', async () => {
		const { streamer, respond } = makeStreamer();
		streamer.onEvent(
			piEvent( {
				type: 'message',
				timestamp: 't',
				message: {
					type: 'message_end',
					message: {
						role: 'assistant',
						content: [ { type: 'thinking', thinking: 'I should stop all sites first.' } ],
					},
				},
			} )
		);
		await flushPromises();
		expect( respond ).toHaveBeenCalledTimes( 1 );
		expect( ( respond.mock.calls[ 0 ][ 1 ] as { text: string } ).text ).toBe(
			'💭 _I should stop all sites first._'
		);
	} );

	it( 'ignores empty / whitespace-only messages', async () => {
		const { streamer, respond } = makeStreamer();
		streamer.onEvent( { type: 'info', timestamp: 't', message: '   ' } );
		streamer.onEvent( { type: 'info', timestamp: 't', message: '' } );
		await flushPromises();
		expect( respond ).not.toHaveBeenCalled();
	} );

	it( 'after the first create, subsequent posts edit the same message in place', async () => {
		const { streamer, respond, clock } = makeStreamer( { intervalMs: 10_000 } );
		respond.mockResolvedValueOnce( okOutcome( 1001 ) );

		streamer.onEvent( { type: 'info', timestamp: 't', message: 'first' } );
		await flushPromises();
		expect( respond ).toHaveBeenCalledTimes( 1 );
		const first = respond.mock.calls[ 0 ][ 1 ] as Record< string, unknown >;
		expect( first.action ).toBe( 'create' );

		// Burst during cooldown — only the latest survives.
		clock.advance( 1000 );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'second' } );
		clock.advance( 1000 );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'third' } );
		clock.advance( 1000 );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'fourth' } );
		expect( respond ).toHaveBeenCalledTimes( 1 );

		// Past the cooldown — the latest pending fires as an edit against the
		// captured messageId.
		clock.advance( 10_000 );
		await flushPromises();
		expect( respond ).toHaveBeenCalledTimes( 2 );
		const second = respond.mock.calls[ 1 ][ 1 ] as Record< string, unknown >;
		expect( second.action ).toBe( 'edit' );
		expect( second.messageId ).toBe( 1001 );
		expect( second.text ).toBe( '⏳ _fourth_' );
	} );

	it( 'collapses whitespace and truncates long messages to maxChars (prefix-inclusive)', async () => {
		const { streamer, respond } = makeStreamer( { maxChars: 20 } );
		streamer.onEvent( {
			type: 'info',
			timestamp: 't',
			message: 'one\ttwo\n  three   four five six seven',
		} );
		await flushPromises();
		const text = ( respond.mock.calls[ 0 ][ 1 ] as { text: string } ).text;
		expect( text.startsWith( '⏳ ' ) ).toBe( true );
		// `maxChars` is the absolute cap on the whole line (emoji prefix
		// included) so a long status doesn't accidentally exceed it.
		expect( text.length ).toBe( 20 );
		expect( text.endsWith( '…' ) ).toBe( true );
	} );

	it( 'stop() cancels a pending flush', async () => {
		const { streamer, respond, clock } = makeStreamer( { intervalMs: 10_000 } );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'first' } );
		clock.advance( 1000 );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'queued' } );
		await streamer.stop();
		clock.advance( 60_000 );
		await flushPromises();
		expect( respond ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'after stop(), further events are ignored', async () => {
		const { streamer, respond } = makeStreamer();
		await streamer.stop();
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'too late' } );
		await flushPromises();
		expect( respond ).not.toHaveBeenCalled();
	} );

	it( 'stop("success") deletes the live status message so the real reply is the only artifact', async () => {
		const { streamer, respond } = makeStreamer();
		respond.mockResolvedValueOnce( okOutcome( 1001 ) );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'working' } );
		await flushPromises();
		expect( respond ).toHaveBeenCalledTimes( 1 );

		await streamer.stop( 'success' );
		expect( respond ).toHaveBeenCalledTimes( 2 );
		const finalCall = respond.mock.calls[ 1 ][ 1 ] as Record< string, unknown >;
		expect( finalCall.action ).toBe( 'delete' );
		expect( finalCall.messageId ).toBe( 1001 );
		expect( finalCall.text ).toBeUndefined();
	} );

	it( 'stop("error") edits the live status to a ⚠️ summary so failures stay visible', async () => {
		const { streamer, respond } = makeStreamer();
		respond.mockResolvedValueOnce( okOutcome( 1001 ) );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'working' } );
		await flushPromises();

		await streamer.stop( 'error' );
		const finalCall = respond.mock.calls[ 1 ][ 1 ] as Record< string, unknown >;
		expect( finalCall.action ).toBe( 'edit' );
		expect( finalCall.text ).toBe( '⚠️ _error_' );
	} );

	it( 'stop() with no captured messageId is a no-op (no final delete or edit)', async () => {
		const { streamer, respond } = makeStreamer();
		await streamer.stop( 'success' );
		expect( respond ).not.toHaveBeenCalled();
	} );

	it( 'stop("success") swallows a delete failure without throwing', async () => {
		const { streamer, respond } = makeStreamer();
		respond.mockResolvedValueOnce( okOutcome( 1001 ) );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'working' } );
		await flushPromises();

		respond.mockRejectedValueOnce( new Error( 'network down' ) );
		await expect( streamer.stop( 'success' ) ).resolves.toBeUndefined();
		expect( respond ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'falls back to create when the first create errored (no messageId to edit against)', async () => {
		const { streamer, respond, clock } = makeStreamer( { intervalMs: 10_000 } );
		respond.mockRejectedValueOnce( new Error( 'network down' ) );
		respond.mockResolvedValueOnce( okOutcome( 2002 ) );

		streamer.onEvent( { type: 'info', timestamp: 't', message: 'first' } );
		await flushPromises();
		expect( respond ).toHaveBeenCalledTimes( 1 );

		clock.advance( 10_000 );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'second' } );
		await flushPromises();
		expect( respond ).toHaveBeenCalledTimes( 2 );
		const retry = respond.mock.calls[ 1 ][ 1 ] as Record< string, unknown >;
		expect( retry.action ).toBe( 'create' );
		expect( retry.messageId ).toBeUndefined();
	} );

	it( 'respects retry_after_ms by deferring the next post', async () => {
		const { streamer, respond, clock } = makeStreamer( { intervalMs: 1000 } );
		respond.mockResolvedValueOnce( okOutcome( 1001, { retryAfterMs: 5000 } ) );

		streamer.onEvent( { type: 'info', timestamp: 't', message: 'first' } );
		await flushPromises();
		expect( respond ).toHaveBeenCalledTimes( 1 );

		// Cooldown alone would let this fire after 1s, but retry_after pushes
		// the next post out to 5s after the 429.
		clock.advance( 2000 );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'still throttled' } );
		await flushPromises();
		expect( respond ).toHaveBeenCalledTimes( 1 );

		clock.advance( 4000 );
		await flushPromises();
		expect( respond ).toHaveBeenCalledTimes( 2 );
		const second = respond.mock.calls[ 1 ][ 1 ] as Record< string, unknown >;
		expect( second.action ).toBe( 'edit' );
		expect( second.text ).toBe( '⏳ _still throttled_' );
	} );

	it( 'does not throw when the underlying respond fails (logged, swallowed)', async () => {
		const { streamer, respond } = makeStreamer();
		respond.mockRejectedValueOnce( new Error( 'network down' ) );
		streamer.onEvent( { type: 'info', timestamp: 't', message: 'go' } );
		await flushPromises();
		expect( respond ).toHaveBeenCalledTimes( 1 );
	} );
} );
