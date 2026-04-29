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
		await respondMessage( baseConfig, { chatId: 99, text: 'hi' } );
		const [ url, init ] = fetchMock.mock.calls[ 0 ];
		expect( url ).toBe( 'https://api.example.test/wpcom/v2/telegram-bot/local-agent-respond' );
		expect( init.method ).toBe( 'POST' );
		const body = JSON.parse( init.body as string );
		expect( body ).toEqual( { chat_id: 99, text: 'hi', bot: 'my_bot' } );
		expect( init.headers.Authorization ).toBe( 'Bearer abc' );
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
} );
