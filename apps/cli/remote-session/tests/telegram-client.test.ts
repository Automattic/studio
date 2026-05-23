import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	TelegramAuthError,
	TelegramBadRequestError,
	TelegramTransientError,
	pollMessages,
	respondMessage,
} from 'cli/remote-session/telegram-client';
import type { RemoteSessionConfig } from 'cli/remote-session/config';

const baseConfig: RemoteSessionConfig = {
	base_url: 'https://api.example.test/wpcom/v2/telegram-bot',
	token: 'abc',
	bot: 'my_bot',
	chat_id: 1,
	poll_interval_seconds: 1,
	long_poll_timeout_seconds: 5,
	max_message_chars: 3800,
	turn_timeout_seconds: 60,
};

function jsonResponse( body: unknown, status = 200 ): Response {
	return new Response( JSON.stringify( body ), {
		status,
		headers: { 'content-type': 'application/json' },
	} );
}

describe( 'pollMessages', () => {
	const fetchMock = vi.fn();
	beforeEach( () => {
		fetchMock.mockReset();
		vi.stubGlobal( 'fetch', fetchMock );
	} );
	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'returns the parsed messages array on a 200 response with real server shape', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse( {
				messages: [
					{
						message: 'hi',
						chat_id: 1,
						bot: 'my_bot',
						user_id: 99,
						timestamp: 1776848744,
					},
				],
			} )
		);
		const msgs = await pollMessages( baseConfig );
		expect( msgs ).toEqual( [ { chat_id: 1, text: 'hi', bot: 'my_bot' } ] );
		expect( fetchMock ).toHaveBeenCalledWith(
			'https://api.example.test/wpcom/v2/telegram-bot/local-agent-poll',
			expect.objectContaining( {
				method: 'GET',
				headers: expect.objectContaining( { Authorization: 'Bearer abc' } ),
			} )
		);
	} );

	it( 'preserves message order when the batch contains several entries', async () => {
		fetchMock.mockResolvedValueOnce(
			jsonResponse( {
				messages: [
					{ message: 'first', chat_id: 1, bot: 'b' },
					{ message: 'second', chat_id: 1, bot: 'b' },
				],
			} )
		);
		const msgs = await pollMessages( baseConfig );
		expect( msgs.map( ( m ) => m.text ) ).toEqual( [ 'first', 'second' ] );
	} );

	it( 'returns an empty array on 204 No Content', async () => {
		fetchMock.mockResolvedValueOnce( new Response( null, { status: 204 } ) );
		expect( await pollMessages( baseConfig ) ).toEqual( [] );
	} );

	it( 'returns an empty array on empty body', async () => {
		fetchMock.mockResolvedValueOnce( new Response( '', { status: 200 } ) );
		expect( await pollMessages( baseConfig ) ).toEqual( [] );
	} );

	it( 'returns an empty array on `{}`', async () => {
		fetchMock.mockResolvedValueOnce( jsonResponse( {} ) );
		expect( await pollMessages( baseConfig ) ).toEqual( [] );
	} );

	it( 'accepts a legacy nested { message: {...} } envelope defensively', async () => {
		fetchMock.mockResolvedValueOnce( jsonResponse( { message: { chat_id: 7, text: 'yo' } } ) );
		expect( await pollMessages( baseConfig ) ).toEqual( [
			{ chat_id: 7, text: 'yo', bot: undefined },
		] );
	} );

	it( 'throws TelegramAuthError on 401', async () => {
		fetchMock.mockResolvedValueOnce( new Response( 'no', { status: 401 } ) );
		await expect( pollMessages( baseConfig ) ).rejects.toBeInstanceOf( TelegramAuthError );
	} );

	it( 'throws TelegramTransientError on 502', async () => {
		fetchMock.mockResolvedValueOnce( new Response( 'oh', { status: 502 } ) );
		await expect( pollMessages( baseConfig ) ).rejects.toBeInstanceOf( TelegramTransientError );
	} );
} );

describe( 'respondMessage', () => {
	const fetchMock = vi.fn();
	beforeEach( () => {
		fetchMock.mockReset();
		vi.stubGlobal( 'fetch', fetchMock );
	} );
	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'POSTs to /local-agent-respond with the configured bot fallback', async () => {
		fetchMock.mockResolvedValueOnce( new Response( '', { status: 200 } ) );
		const outcome = await respondMessage( baseConfig, { chatId: 99, text: 'hi' } );
		const [ url, init ] = fetchMock.mock.calls[ 0 ];
		expect( url ).toBe( 'https://api.example.test/wpcom/v2/telegram-bot/local-agent-respond' );
		expect( init.method ).toBe( 'POST' );
		const body = JSON.parse( init.body as string );
		// `action` is only emitted on non-default values so older servers that
		// don't know about it still accept the create body unchanged.
		expect( body ).toEqual( { chat_id: 99, text: 'hi', bot: 'my_bot' } );
		expect( init.headers.Authorization ).toBe( 'Bearer abc' );
		// Empty body returns a bare success outcome.
		expect( outcome ).toEqual( { success: true, messageIds: [] } );
	} );

	it( 'parses message_ids and the new outcome fields from the server JSON envelope', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify( {
					success: true,
					message_ids: [ 1001, 1002 ],
					text_sent: true,
					chunks_sent: 2,
				} ),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);
		const outcome = await respondMessage( baseConfig, { chatId: 1, text: 'x' } );
		expect( outcome ).toEqual( {
			success: true,
			messageIds: [ 1001, 1002 ],
			textSent: true,
			chunksSent: 2,
		} );
	} );

	it( 'surfaces retry_after_ms in the outcome without throwing', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify( {
					success: false,
					message_ids: [],
					retry_after_ms: 3000,
					error: 'Too Many Requests: retry after 3',
				} ),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);
		const outcome = await respondMessage(
			baseConfig,
			{ chatId: 1, action: 'edit', messageId: 42, text: 'updated' },
			{ maxRetries: 0 }
		);
		expect( outcome.success ).toBe( false );
		expect( outcome.retryAfterMs ).toBe( 3000 );
		expect( outcome.error ).toMatch( /Too Many Requests/i );
	} );

	it( 'sends action=edit with message_id in the JSON body', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response( JSON.stringify( { success: true, message_ids: [ 42 ], text_sent: true } ), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			} )
		);
		await respondMessage( baseConfig, {
			chatId: 1,
			action: 'edit',
			messageId: 42,
			text: 'new text',
		} );
		const [ , init ] = fetchMock.mock.calls[ 0 ];
		expect( init.headers[ 'Content-Type' ] ).toBe( 'application/json' );
		expect( JSON.parse( init.body as string ) ).toEqual( {
			chat_id: 1,
			bot: 'my_bot',
			action: 'edit',
			message_id: 42,
			text: 'new text',
		} );
	} );

	it( 'rejects edit calls without messageId or text up front', async () => {
		await expect(
			respondMessage( baseConfig, { chatId: 1, action: 'edit', text: 'no id' } )
		).rejects.toThrow( /messageId/ );
		await expect(
			respondMessage( baseConfig, { chatId: 1, action: 'edit', messageId: 1 } )
		).rejects.toThrow( /text/ );
		expect( fetchMock ).not.toHaveBeenCalled();
	} );

	it( 'retries on 5xx then succeeds', async () => {
		fetchMock
			.mockResolvedValueOnce( new Response( '', { status: 503 } ) )
			.mockResolvedValueOnce( new Response( '', { status: 200 } ) );
		await respondMessage( baseConfig, { chatId: 1, text: 'x' }, { maxRetries: 1 } );
		expect( fetchMock ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'throws TelegramBadRequestError on 4xx without retry', async () => {
		fetchMock.mockResolvedValueOnce( new Response( 'bad payload', { status: 400 } ) );
		await expect( respondMessage( baseConfig, { chatId: 1, text: 'x' } ) ).rejects.toBeInstanceOf(
			TelegramBadRequestError
		);
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'throws TelegramAuthError on 403 without retry', async () => {
		fetchMock.mockResolvedValueOnce( new Response( 'no', { status: 403 } ) );
		await expect( respondMessage( baseConfig, { chatId: 1, text: 'x' } ) ).rejects.toBeInstanceOf(
			TelegramAuthError
		);
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'POSTs photo + caption as multipart/form-data with raw image bytes', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response( JSON.stringify( { success: true, photo_sent: true } ), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			} )
		);
		// Tiny 1x1 PNG — base64 of the standard "transparent pixel" header.
		const photoBase64 =
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';
		await respondMessage( baseConfig, {
			chatId: 42,
			photo: photoBase64,
			caption: 'Hello world',
		} );
		const [ , init ] = fetchMock.mock.calls[ 0 ];
		expect( init.body ).toBeInstanceOf( FormData );
		// fetch sets Content-Type with the boundary; we must NOT set it ourselves.
		expect( init.headers ).not.toHaveProperty( 'Content-Type' );
		expect( init.headers.Authorization ).toBe( 'Bearer abc' );
		const fd = init.body as FormData;
		expect( fd.get( 'chat_id' ) ).toBe( '42' );
		expect( fd.get( 'bot' ) ).toBe( 'my_bot' );
		expect( fd.get( 'caption' ) ).toBe( 'Hello world' );
		expect( fd.get( 'text' ) ).toBeNull();
		const photo = fd.get( 'photo' ) as Blob;
		expect( photo ).toBeInstanceOf( Blob );
		expect( photo.type ).toBe( 'image/png' );
		expect( photo.size ).toBe( Buffer.from( photoBase64, 'base64' ).length );
	} );

	it( 'POSTs photo + text together via multipart with both fields', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response( JSON.stringify( { success: true, photo_sent: true, text_sent: true } ), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			} )
		);
		await respondMessage( baseConfig, {
			chatId: 42,
			photo: 'BASE64DATA',
			text: 'Follow-up',
		} );
		const [ , init ] = fetchMock.mock.calls[ 0 ];
		const fd = init.body as FormData;
		expect( fd.get( 'text' ) ).toBe( 'Follow-up' );
		expect( fd.get( 'caption' ) ).toBeNull();
		const photo = fd.get( 'photo' ) as Blob;
		expect( photo ).toBeInstanceOf( Blob );
		expect( photo.type ).toBe( 'image/png' );
	} );

	it( 'uses the requested mime type for the photo file part', async () => {
		fetchMock.mockResolvedValueOnce( new Response( '', { status: 200 } ) );
		await respondMessage( baseConfig, {
			chatId: 1,
			photo: 'BASE64DATA',
			photoMimeType: 'image/jpeg',
		} );
		const [ , init ] = fetchMock.mock.calls[ 0 ];
		const fd = init.body as FormData;
		const photo = fd.get( 'photo' ) as Blob;
		expect( photo.type ).toBe( 'image/jpeg' );
	} );

	it( 'omits caption from the multipart body when it is undefined', async () => {
		fetchMock.mockResolvedValueOnce( new Response( '', { status: 200 } ) );
		await respondMessage( baseConfig, { chatId: 1, photo: 'BASE64DATA' } );
		const [ , init ] = fetchMock.mock.calls[ 0 ];
		const fd = init.body as FormData;
		expect( fd.get( 'caption' ) ).toBeNull();
	} );

	it( 'logs a warning but does not throw when the server reports a partial failure', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify( {
					success: false,
					photo_sent: true,
					text_sent: false,
					error: 'Telegram returned 502 on text follow-up',
				} ),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);
		// Should resolve, not throw.
		await respondMessage( baseConfig, { chatId: 1, photo: 'BASE64DATA', text: 'follow' } );
	} );

	it( 'rejects calls with neither text nor photo', async () => {
		await expect( respondMessage( baseConfig, { chatId: 1 } ) ).rejects.toThrow( /text.*photo/i );
		expect( fetchMock ).not.toHaveBeenCalled();
	} );

	it( 'treats empty-string text or photo as absent', async () => {
		fetchMock.mockResolvedValueOnce( new Response( '', { status: 200 } ) );

		// Empty photo + real text → goes through the JSON text path, no photo dropped.
		await respondMessage( baseConfig, { chatId: 1, text: 'hi', photo: '' } );
		const [ , init ] = fetchMock.mock.calls[ 0 ];
		expect( init.headers[ 'Content-Type' ] ).toBe( 'application/json' );
		expect( init.body ).toBeTypeOf( 'string' );
		expect( JSON.parse( init.body as string ) ).not.toHaveProperty( 'photo' );

		// Both empty → throws, no fetch.
		await expect(
			respondMessage( baseConfig, { chatId: 1, text: '', photo: '' } )
		).rejects.toThrow( /text.*photo/i );
		expect( fetchMock ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'truncates captions over 1024 chars before sending', async () => {
		fetchMock.mockResolvedValueOnce( new Response( '', { status: 200 } ) );
		const longCaption = 'x'.repeat( 1500 );
		await respondMessage( baseConfig, {
			chatId: 1,
			photo: 'BASE64DATA',
			caption: longCaption,
		} );
		const [ , init ] = fetchMock.mock.calls[ 0 ];
		const fd = init.body as FormData;
		const sent = fd.get( 'caption' ) as string;
		expect( sent.length ).toBe( 1024 );
		expect( sent.endsWith( '…' ) ).toBe( true );
	} );
} );
