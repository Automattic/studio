import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteAuthError, RemoteBadRequestError } from 'cli/remote-session/remote-http';
import { respondMessage } from 'cli/remote-session/respond-router';
import type { RemoteSessionConfig } from 'cli/remote-session/config';

const baseConfig: RemoteSessionConfig = {
	base_url: 'https://api.example.test/wpcom/v2/telegram-bot',
	token: 'abc',
	bot: 'my_bot',
	chat_id: 1,
	machine_id: 'test_host',
	poll_interval_seconds: 1,
	long_poll_timeout_seconds: 5,
	max_message_chars: 3800,
	turn_timeout_seconds: 60,
};

describe( 'respondMessage', () => {
	const fetchMock = vi.fn();
	beforeEach( () => {
		fetchMock.mockReset();
		vi.stubGlobal( 'fetch', fetchMock );
	} );
	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	describe( 'Telegram path', () => {
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

		it( 'throws RemoteBadRequestError on 4xx without retry', async () => {
			fetchMock.mockResolvedValueOnce( new Response( 'bad payload', { status: 400 } ) );
			await expect( respondMessage( baseConfig, { chatId: 1, text: 'x' } ) ).rejects.toBeInstanceOf(
				RemoteBadRequestError
			);
			expect( fetchMock ).toHaveBeenCalledTimes( 1 );
		} );

		it( 'throws RemoteAuthError on 403 without retry', async () => {
			fetchMock.mockResolvedValueOnce( new Response( 'no', { status: 403 } ) );
			await expect( respondMessage( baseConfig, { chatId: 1, text: 'x' } ) ).rejects.toBeInstanceOf(
				RemoteAuthError
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

	describe( 'studio-mobile path', () => {
		it( 'routes studio_mobile_* bots to /studio-mobile-client/respond with the envelope body', async () => {
			fetchMock.mockResolvedValueOnce( new Response( '', { status: 200 } ) );
			await respondMessage(
				{ ...baseConfig, bot: undefined },
				{ chatId: 7, bot: 'studio_mobile_rn', text: 'hi' }
			);
			const [ url, init ] = fetchMock.mock.calls[ 0 ];
			expect( url ).toBe( 'https://api.example.test/wpcom/v2/studio-mobile-client/respond' );
			expect( init.headers[ 'Content-Type' ] ).toBe( 'application/json' );
			const body = JSON.parse( init.body as string );
			expect( body.chat_id ).toBe( 7 );
			expect( body.bot ).toBe( 'studio_mobile_rn' );
			// `machine_id` comes from config (hostname-derived by default).
			expect( body.machine_id ).toBe( 'test_host' );
			expect( body.envelope.type ).toBe( 'agent_message' );
			expect( body.envelope.text ).toBe( 'hi' );
			expect( typeof body.envelope.id ).toBe( 'string' );
			expect( body.envelope.id.length ).toBeGreaterThan( 0 );
			// Top-level `text` is gone — wpcom reads it from `envelope.text`.
			expect( body ).not.toHaveProperty( 'text' );
		} );

		it( 'uses the per-host machine_id from config so multiple machines can share the same wpcom token', async () => {
			fetchMock.mockResolvedValueOnce( new Response( '', { status: 200 } ) );
			await respondMessage(
				{ ...baseConfig, bot: undefined, machine_id: 'gergely_mbp' },
				{ chatId: 7, bot: 'studio_mobile_rn', text: 'hi' }
			);
			const [ , init ] = fetchMock.mock.calls[ 0 ];
			const body = JSON.parse( init.body as string );
			expect( body.machine_id ).toBe( 'gergely_mbp' );
		} );

		it( 'demotes a photo to a text envelope for studio_mobile bots, preserving the caption', async () => {
			fetchMock.mockResolvedValueOnce( new Response( '', { status: 200 } ) );
			await respondMessage(
				{ ...baseConfig, bot: undefined },
				{
					chatId: 7,
					bot: 'studio_mobile_rn',
					photo: 'BASE64DATA',
					caption: 'Screenshot of the homepage',
				}
			);
			const [ , init ] = fetchMock.mock.calls[ 0 ];
			expect( init.body ).toBeTypeOf( 'string' );
			const body = JSON.parse( init.body as string );
			expect( body.envelope.text ).toBe( 'Screenshot of the homepage' );
		} );

		it( 'sends a placeholder envelope when a studio_mobile bot has only a photo (no text or caption)', async () => {
			fetchMock.mockResolvedValueOnce( new Response( '', { status: 200 } ) );
			await respondMessage(
				{ ...baseConfig, bot: undefined },
				{ chatId: 7, bot: 'studio_mobile_rn', photo: 'BASE64DATA' }
			);
			const [ , init ] = fetchMock.mock.calls[ 0 ];
			const body = JSON.parse( init.body as string );
			expect( body.envelope.text ).toMatch( /image omitted/i );
		} );

		it( 'degrades action=edit to a fresh create envelope (mobile has no edit primitive)', async () => {
			fetchMock.mockResolvedValueOnce( new Response( '', { status: 200 } ) );
			const outcome = await respondMessage(
				{ ...baseConfig, bot: undefined },
				{
					chatId: 7,
					bot: 'studio_mobile_rn',
					action: 'edit',
					messageId: 42,
					text: 'updated text',
				}
			);
			const [ url, init ] = fetchMock.mock.calls[ 0 ];
			expect( url ).toBe( 'https://api.example.test/wpcom/v2/studio-mobile-client/respond' );
			const body = JSON.parse( init.body as string );
			// Body has no `action` / `message_id` keys; mobile gets a fresh envelope.
			expect( body ).not.toHaveProperty( 'action' );
			expect( body ).not.toHaveProperty( 'message_id' );
			expect( body.envelope.text ).toBe( 'updated text' );
			// Empty messageIds — caller (progress streamer) interprets this as
			// "no message id captured; keep creating".
			expect( outcome.messageIds ).toEqual( [] );
		} );

		it( 'throws when base_url does not end with /telegram-bot for a mobile bot', async () => {
			await expect(
				respondMessage(
					{
						...baseConfig,
						bot: undefined,
						base_url: 'https://api.example.test/wpcom/v2/something-else',
					},
					{ chatId: 7, bot: 'studio_mobile_rn', text: 'hi' }
				)
			).rejects.toThrow( /studio-mobile URL/ );
			expect( fetchMock ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'input validation', () => {
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
	} );
} );
