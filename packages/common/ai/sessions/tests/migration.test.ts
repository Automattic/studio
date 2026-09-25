import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateLegacyEvents, migrateLegacyFileInPlace } from '../migration';

describe( 'migrateLegacyEvents', () => {
	it( 'normalizes legacy clear events by keeping only post-clear entries', () => {
		const entries = migrateLegacyEvents(
			[
				{
					type: 'session.started',
					timestamp: '2026-01-01T00:00:00.000Z',
					version: 1,
					sessionId: 'session-1',
				},
				{
					type: 'user.message',
					timestamp: '2026-01-01T00:00:01.000Z',
					text: 'before clear',
					source: 'prompt',
				},
				{
					type: 'session.cleared',
					timestamp: '2026-01-01T00:00:02.000Z',
				},
				{
					type: 'session.linked',
					timestamp: '2026-01-01T00:00:02.500Z',
					agentSessionId: 'legacy-sdk-session',
				},
				{
					type: 'user.message',
					timestamp: '2026-01-01T00:00:03.000Z',
					text: 'after clear',
					source: 'prompt',
				},
			],
			'/tmp/site'
		);

		const serialized = JSON.stringify( entries );
		expect( serialized ).not.toContain( 'studio.session_cleared' );
		expect( serialized ).not.toContain( 'studio.session_linked' );
		expect( serialized ).not.toContain( 'legacy-sdk-session' );
		expect( serialized ).not.toContain( 'before clear' );
		expect( serialized ).toContain( 'after clear' );
		expect( entries[ 0 ] ).toMatchObject( {
			type: 'session',
			id: 'session-1',
			cwd: '/tmp/site',
		} );
	} );

	it( 'normalizes SDK-era prefixed tool names during migration', () => {
		const entries = migrateLegacyEvents(
			[
				{
					type: 'session.started',
					timestamp: '2026-01-01T00:00:00.000Z',
					version: 1,
					sessionId: 'session-1',
				},
				{
					type: 'sdk.message',
					timestamp: '2026-01-01T00:00:01.000Z',
					message: {
						type: 'assistant',
						message: {
							model: 'claude-sonnet-4-6',
							content: [
								{
									type: 'tool_use',
									id: 'toolu_1',
									name: 'mcp__studio__site_create',
									input: { name: 'Test' },
								},
							],
						},
					},
				},
				{
					type: 'sdk.message',
					timestamp: '2026-01-01T00:00:02.000Z',
					message: {
						type: 'user',
						message: {
							content: [
								{
									type: 'tool_result',
									tool_use_id: 'toolu_1',
									content: 'ok',
								},
							],
						},
					},
				},
			],
			'/tmp/site'
		);

		const messages = entries
			.filter( ( entry ) => entry.type === 'message' )
			.map( ( entry ) => entry.message as Record< string, unknown > );
		const assistant = messages.find( ( message ) => message.role === 'assistant' ) as
			| { content?: Array< { name?: string } > }
			| undefined;
		const toolResult = messages.find( ( message ) => message.role === 'toolResult' ) as
			| { toolName?: string }
			| undefined;

		expect( assistant?.content?.[ 0 ]?.name ).toBe( 'site_create' );
		expect( toolResult?.toolName ).toBe( 'site_create' );
	} );
} );

describe( 'migrateLegacyFileInPlace', () => {
	let rootDirectory: string | undefined;

	afterEach( async () => {
		if ( rootDirectory ) {
			await fs.rm( rootDirectory, { recursive: true, force: true } );
			rootDirectory = undefined;
		}
	} );

	function legacyLines(): string[] {
		return [
			JSON.stringify( {
				type: 'session.started',
				timestamp: '2026-01-01T00:00:00.000Z',
				version: 1,
				sessionId: 'session-1',
			} ),
			JSON.stringify( {
				type: 'user.message',
				timestamp: '2026-01-01T00:00:01.000Z',
				text: 'hello from legacy',
				source: 'prompt',
			} ),
		];
	}

	async function writeFixture( content: string ): Promise< string > {
		rootDirectory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-migration-' ) );
		const filePath = path.join( rootDirectory, 'session.jsonl' );
		await fs.writeFile( filePath, content, 'utf8' );
		return filePath;
	}

	async function readLines( filePath: string ): Promise< string[] > {
		const content = await fs.readFile( filePath, 'utf8' );
		return content.split( '\n' ).filter( ( line ) => line.trim() );
	}

	it( 'migrates a legacy file in place and is a no-op on a second run', async () => {
		const filePath = await writeFixture( legacyLines().join( '\n' ) + '\n' );

		await migrateLegacyFileInPlace( filePath, '/tmp/site' );
		const migrated = await readLines( filePath );
		expect( JSON.parse( migrated[ 0 ] ) ).toMatchObject( { type: 'session', id: 'session-1' } );
		expect( migrated.join( '\n' ) ).toContain( 'hello from legacy' );

		await migrateLegacyFileInPlace( filePath, '/tmp/site' );
		await expect( readLines( filePath ) ).resolves.toEqual( migrated );
	} );

	it( 'migrates a CR-delimited legacy file without losing its events', async () => {
		const filePath = await writeFixture( legacyLines().join( '\r' ) + '\r' );

		await migrateLegacyFileInPlace( filePath, '/tmp/site' );

		const migrated = await readLines( filePath );
		expect( JSON.parse( migrated[ 0 ] ) ).toMatchObject( { type: 'session', id: 'session-1' } );
		expect( migrated.join( '\n' ) ).toContain( 'hello from legacy' );
	} );

	it( 'never loses events when two migrations of the same file race', async () => {
		const filePath = await writeFixture( legacyLines().join( '\n' ) + '\n' );

		await Promise.all( [
			migrateLegacyFileInPlace( filePath, '/tmp/site' ),
			migrateLegacyFileInPlace( filePath, '/tmp/site' ),
		] );

		const migrated = await readLines( filePath );
		expect( JSON.parse( migrated[ 0 ] ) ).toMatchObject( { type: 'session', id: 'session-1' } );
		expect( migrated.join( '\n' ) ).toContain( 'hello from legacy' );
	} );
} );
