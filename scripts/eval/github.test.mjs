import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { githubAnswered } from './github.mjs';

// GitHub's quota as it answers the eval: `remaining` requests left this hour.
const quota = ( remaining ) =>
	vi.stubGlobal( 'fetch', async () =>
		Response.json( { resources: { core: { remaining, reset: 0 } } } )
	);

// What the runner prints for a turn whose calls and results these were.
function output( toolCalls, toolResults ) {
	const file = path.join( mkdtempSync( path.join( tmpdir(), 'github-' ) ), 'result.json' );
	writeFileSync( file, JSON.stringify( { toolCalls, toolResults } ) );
	return `EVAL_RUNNER_RESULT_FILE=${ file }`;
}

const releases = [
	{ name: 'Bash', input: { command: 'curl https://api.github.com/repos/a/b/releases' } },
];

afterEach( () => vi.unstubAllGlobals() );

test.each( [
	{ name: 'a turn that did not use GitHub', calls: [], results: [], start: 0, end: 0, valid: true },
	{
		name: 'a turn GitHub answered',
		calls: releases,
		results: [ { text: '[{"tag_name":"v1"}]' } ],
		start: 50,
		end: 49,
		valid: true,
	},
	{
		name: 'a turn GitHub refused',
		calls: releases,
		results: [ { text: '{"message":"API rate limit exceeded for 1.2.3.4."}' } ],
		start: 50,
		end: 49,
		valid: false,
	},
	{
		name: 'a turn that started with almost no requests left',
		calls: releases,
		results: [],
		start: 3,
		end: 2,
		valid: false,
	},
	{
		name: 'a turn that spent the last of them',
		calls: releases,
		results: [],
		start: 50,
		end: 0,
		valid: false,
	},
] )( '$name', async ( { calls, results, start, end, valid } ) => {
	quota( end );
	const { pass, reason } = await githubAnswered( output( calls, results ), {
		vars: { githubQuotaAtStart: { remaining: start } },
	} );
	expect( pass ).toBe( valid );
	expect( reason.startsWith( 'INVALID (environment)' ) ).toBe( ! valid );
} );
