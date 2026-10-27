import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, expect, it, vi } from 'vitest';
import { judgeEndpoint, judgeLook } from 'cli/ai/eval-look-judge';

afterEach( () => vi.unstubAllGlobals() );

it.each< { name: string; env: Record< string, string >; judge: unknown } >( [
	{ name: 'no key', env: {}, judge: undefined },
	{
		name: "Anthropic's API with its key",
		env: { ANTHROPIC_API_KEY: 'a' },
		judge: { baseUrl: 'https://api.anthropic.com', apiKey: 'a', model: 'claude-sonnet-5' },
	},
	{
		name: 'a judge of its own',
		env: {
			ANTHROPIC_API_KEY: 'a',
			STUDIO_EVAL_JUDGE_API_KEY: 'j',
			STUDIO_EVAL_JUDGE_BASE_URL: 'http://pool:1/',
			STUDIO_EVAL_JUDGE_MODEL: 'vision',
		},
		judge: { baseUrl: 'http://pool:1', apiKey: 'j', model: 'vision' },
	},
] )( 'configures $name', ( { env, judge } ) => {
	expect( judgeEndpoint( env ) ).toEqual( judge );
} );

it( 'sends the ask and the screenshot, and reads the JSON the judge answers', async () => {
	const file = path.join( mkdtempSync( path.join( tmpdir(), 'judge-' ) ), 'home.jpg' );
	writeFileSync( file, Buffer.from( [ 0xff, 0xd8, 0xff ] ) );
	const fetch = vi.fn( async ( _url: string, _init: RequestInit ) =>
		Response.json( {
			content: [
				{
					type: 'text',
					text: 'Here: {"madeForTheAsk": 4, "unreadable": [], "defects": ["x"], "reason": "ok"}',
				},
			],
		} )
	);
	vi.stubGlobal( 'fetch', fetch );
	const judge = { baseUrl: 'http://pool:1', apiKey: 'j', model: 'vision' };
	expect( await judgeLook( judge, ' A bakery site. ', file ) ).toEqual( {
		madeForTheAsk: 4,
		unreadable: [],
		defects: [ 'x' ],
		reason: 'ok',
	} );
	const [ url, init ] = fetch.mock.calls[ 0 ];
	expect( url ).toBe( 'http://pool:1/v1/messages' );
	expect( init.headers ).toMatchObject( { 'x-api-key': 'j' } );
	const body = JSON.parse( init.body as string );
	expect( body.model ).toBe( 'vision' );
	expect( body.messages[ 0 ].content ).toEqual( [
		{ type: 'text', text: 'The site owner asked: A bakery site.' },
		{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: '/9j/' } },
	] );

	fetch.mockResolvedValueOnce( new Response( 'overloaded', { status: 529 } ) );
	await expect( judgeLook( judge, 'x', file ) ).rejects.toThrow(
		'the judge answered 529: overloaded'
	);
} );
