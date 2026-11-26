import fs from 'fs';
import os from 'os';
import path from 'path';
import { readProviderConfig } from '@studio/common/lib/provider-config';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { input, password } from 'cli/lib/prompts';
import { connectInTerminal } from 'cli/lib/providers';

vi.mock( 'cli/lib/prompts', () => ( { input: vi.fn(), password: vi.fn(), select: vi.fn() } ) );

type Prompt = ( options: {
	message: string;
	validate?: ( value: string ) => Promise< string | boolean > | string | boolean;
} ) => Promise< string >;

let directory: string;

// Answers each prompt in turn, as someone typing them would, once the field takes the answer.
function answer( prompt: typeof input | typeof password, answers: string[] ) {
	vi.mocked( prompt as Prompt ).mockImplementation( async ( { validate } ) => {
		const value = answers.shift()!;
		expect( await validate?.( value ) ).toBe( true );
		return value;
	} );
}

beforeEach( () => {
	directory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-providers-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', directory );
	// Ollama on its default port, with nothing listening on any other.
	vi.spyOn( globalThis, 'fetch' ).mockImplementation( async ( url ) => {
		if ( String( url ) === 'http://127.0.0.1:11434/v1/models' ) {
			return Response.json( { data: [ { id: 'qwen3:0.6b' } ] } );
		}
		if ( String( url ).startsWith( 'http://127.0.0.1:11434/' ) ) {
			return new Response( 'Not found', { status: 404 } );
		}
		throw new TypeError( 'fetch failed' );
	} );
	vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
} );

afterEach( () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	fs.rmSync( directory, { recursive: true, force: true } );
} );

it( 'asks for the whole form again when connecting fails, so a mistyped address can be corrected', async () => {
	answer( input, [ '127.0.0.1:11999', '127.0.0.1:11434' ] );
	answer( password, [ '', '' ] );

	await connectInTerminal( 'local-llm', { force: true } );

	expect( console.error ).toHaveBeenCalledWith(
		expect.stringContaining( 'No local server answered at 127.0.0.1:11999' )
	);
	expect( vi.mocked( password ).mock.calls[ 0 ][ 0 ].message ).toContain( 'optional' );
	const config = await readProviderConfig( 'local-llm' );
	expect( config ).toMatchObject( { baseUrl: 'http://127.0.0.1:11434/v1' } );
	expect( config ).not.toHaveProperty( 'apiKey' );
} );
