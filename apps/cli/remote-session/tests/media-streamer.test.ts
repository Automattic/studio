import { describe, expect, it, vi } from 'vitest';
import { RemoteSessionLogger } from 'cli/remote-session/logger';
import { MediaStreamer } from 'cli/remote-session/media-streamer';
import type { RemoteSessionConfig } from 'cli/remote-session/config';

const config: RemoteSessionConfig = {
	base_url: 'https://api.example.test/telegram-bot',
	token: 't',
	bot: 'b',
	chat_id: 42,
	poll_interval_seconds: 1,
	long_poll_timeout_seconds: 5,
	max_message_chars: 3800,
	turn_timeout_seconds: 60,
};

describe( 'MediaStreamer', () => {
	it( 'posts a photo as soon as a media.share event arrives', async () => {
		const respond = vi.fn().mockResolvedValue( undefined );
		const streamer = new MediaStreamer( {
			config,
			target: { chatId: 42, bot: 'b' },
			deps: { respond, logger: new RemoteSessionLogger( { logPath: '/dev/null' } ) },
		} );

		streamer.onEvent( {
			type: 'media.share',
			timestamp: 'now',
			mediaType: 'image',
			mimeType: 'image/png',
			dataBase64: 'AAAA',
			caption: 'Site preview',
		} );

		const summary = await streamer.drain();
		expect( summary.posted ).toBe( 1 );
		expect( summary.failed ).toBe( 0 );
		expect( respond ).toHaveBeenCalledOnce();
		expect( respond.mock.calls[ 0 ][ 1 ] ).toEqual( {
			chatId: 42,
			bot: 'b',
			photo: 'AAAA',
			photoMimeType: 'image/png',
			caption: 'Site preview',
		} );
	} );

	it( 'serializes posts so multiple shares arrive in emit order', async () => {
		const order: string[] = [];
		const respond = vi.fn().mockImplementation( async ( _config, params ) => {
			// Yield the event loop so a second post would race past us if we
			// were not serializing.
			await new Promise( ( r ) => setTimeout( r, 5 ) );
			order.push( params.photo );
		} );
		const streamer = new MediaStreamer( {
			config,
			target: { chatId: 42 },
			deps: { respond, logger: new RemoteSessionLogger( { logPath: '/dev/null' } ) },
		} );

		streamer.onEvent( {
			type: 'media.share',
			timestamp: 'now',
			mediaType: 'image',
			mimeType: 'image/png',
			dataBase64: 'first',
		} );
		streamer.onEvent( {
			type: 'media.share',
			timestamp: 'now',
			mediaType: 'image',
			mimeType: 'image/png',
			dataBase64: 'second',
		} );

		await streamer.drain();
		expect( order ).toEqual( [ 'first', 'second' ] );
	} );

	it( 'tracks failures without throwing so the turn keeps running', async () => {
		const respond = vi
			.fn()
			.mockResolvedValueOnce( undefined )
			.mockRejectedValueOnce( new Error( 'network blip' ) )
			.mockResolvedValueOnce( undefined );
		const streamer = new MediaStreamer( {
			config,
			target: { chatId: 42 },
			deps: { respond, logger: new RemoteSessionLogger( { logPath: '/dev/null' } ) },
		} );

		for ( const data of [ 'a', 'b', 'c' ] ) {
			streamer.onEvent( {
				type: 'media.share',
				timestamp: 'now',
				mediaType: 'image',
				mimeType: 'image/png',
				dataBase64: data,
			} );
		}

		const summary = await streamer.drain();
		expect( summary.posted ).toBe( 2 );
		expect( summary.failed ).toBe( 1 );
	} );

	it( 'ignores non-media events', async () => {
		const respond = vi.fn().mockResolvedValue( undefined );
		const streamer = new MediaStreamer( {
			config,
			target: { chatId: 42 },
			deps: { respond, logger: new RemoteSessionLogger( { logPath: '/dev/null' } ) },
		} );

		streamer.onEvent( { type: 'info', timestamp: 'now', message: 'doing things' } );
		streamer.onEvent( { type: 'turn.started', timestamp: 'now' } );

		const summary = await streamer.drain();
		expect( summary.posted ).toBe( 0 );
		expect( respond ).not.toHaveBeenCalled();
	} );

	it( 'ignores malformed media.share events without throwing', async () => {
		const respond = vi.fn().mockResolvedValue( undefined );
		const streamer = new MediaStreamer( {
			config,
			target: { chatId: 42 },
			deps: { respond, logger: new RemoteSessionLogger( { logPath: '/dev/null' } ) },
		} );

		// Missing dataBase64.
		streamer.onEvent( {
			type: 'media.share',
			timestamp: 'now',
			mediaType: 'image',
			mimeType: 'image/png',
		} as never );
		// Empty dataBase64.
		streamer.onEvent( {
			type: 'media.share',
			timestamp: 'now',
			mediaType: 'image',
			mimeType: 'image/png',
			dataBase64: '',
		} );
		// Invalid mimeType.
		streamer.onEvent( {
			type: 'media.share',
			timestamp: 'now',
			mediaType: 'image',
			mimeType: 'image/gif',
			dataBase64: 'AAAA',
		} as never );
		// Caption present but wrong type.
		streamer.onEvent( {
			type: 'media.share',
			timestamp: 'now',
			mediaType: 'image',
			mimeType: 'image/png',
			dataBase64: 'AAAA',
			caption: 123,
		} as never );

		const summary = await streamer.drain();
		expect( summary.posted ).toBe( 0 );
		expect( summary.failed ).toBe( 0 );
		expect( respond ).not.toHaveBeenCalled();
	} );
} );
