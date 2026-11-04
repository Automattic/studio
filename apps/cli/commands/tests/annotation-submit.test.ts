import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHydratedAiSession } from '@studio/agent/node/sessions/manage';
import { __recordTracksEvent, TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import {
	getCliConfigPath,
	getSessionsDirectory,
	getSharedConfigPath,
} from '@studio/common/lib/well-known-paths';
import { startLocalServer, type LocalServer } from '@studio/local';
import { getTracksOrigin, recordTracksEvent } from 'cli/lib/tracks';

const startAgentRun = vi.hoisted( () => vi.fn() );
vi.mock( '@studio/agent/node/run-manager', () => ( {
	createAgentRunManager: () => ( { startAgentRun } ),
} ) );
vi.mock( '@studio/common/lib/record-tracks-event', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/record-tracks-event') >() ),
	__recordTracksEvent: vi.fn(),
} ) );

const record = vi.mocked( __recordTracksEvent );
const wrappedRecord = vi.fn(
	(
		event: Parameters< typeof recordTracksEvent >[ 0 ],
		props?: Parameters< typeof recordTracksEvent >[ 1 ]
	) => recordTracksEvent( event, { ...getTracksOrigin(), ...props } )
);
const site = { id: 'private@example.test', name: 'Private title', path: '/private/site' };
const privateText = 'Secret comment #selector https://private.test/path person@example.test';
const image = {
	id: 'private-image',
	name: 'private.png',
	mimeType: 'image/png' as const,
	size: 12,
	dataBase64: 'c2VjcmV0LWltYWdl',
};
let directory: string;
let sessionId: string;
let server: LocalServer;

beforeEach( async () => {
	directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-web-annotation-submit-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', directory );
	vi.stubEnv( 'STUDIO_TRACKS_ORIGIN', 'studio-web:v2' );
	vi.stubEnv( 'STUDIO_FORCE_CLI_TELEMETRY', '' );
	vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', true );
	vi.stubGlobal( '__STUDIO_CLI_VERSION__', 'test-version' );
	startAgentRun.mockReturnValue( { runId: 'run-id' } );
	await fs.writeFile(
		getCliConfigPath(),
		JSON.stringify( { version: 1, sites: [ site ], snapshots: [] } )
	);
	sessionId = ( await createHydratedAiSession( getSessionsDirectory(), { site } ) ).id;
	server = await startLocalServer( {
		cliBinary: '/unused',
		sessionsRoot: getSessionsDirectory(),
		sitesRoot: directory,
		port: 0,
		recordTracksEvent: wrappedRecord,
	} );
} );

afterEach( async () => {
	await server.close();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await fs.rm( directory, { recursive: true, force: true } );
} );

function submit( visualAnnotations?: unknown ) {
	return fetch( `${ server.url }/api/sessions/${ sessionId }/messages`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( {
			prompt: privateText,
			displayMessage: privateText,
			visualAnnotations,
			images: [ image ],
		} ),
	} );
}

it.each( [ 1, 3, 100 ] )( 'records one safe browser event for %i annotations', async ( count ) => {
	const annotations = Array.from( { length: count }, () => ( {
		comment: privateText,
		tag: 'private-tag',
		elementLabel: privateText,
		nearbyText: privateText,
		imageIds: [ image.id ],
	} ) );
	const response = await submit( annotations );
	expect( response.status ).toBe( 200 );
	expect( await response.json() ).toEqual( { runId: 'run-id' } );
	await vi.waitFor( () => expect( record ).toHaveBeenCalledTimes( 1 ) );
	const config = JSON.parse( await fs.readFile( getCliConfigPath(), 'utf8' ) );
	expect( config.sites[ 0 ].tracksId ).toMatch( /^[0-9a-f-]{36}$/ );
	expect( record ).toHaveBeenCalledWith(
		TRACKS_EVENTS.ANNOTATION_SUBMITTED,
		{ type: 'anon', id: expect.stringMatching( /^[0-9a-f-]{36}$/ ) },
		{
			platform: process.platform,
			arch: process.arch,
			app_version: 'test-version',
			is_a11n: false,
			channel: 'studio-web',
			ui_version: 'v2',
			annotation_count: count,
			site_id: config.sites[ 0 ].tracksId,
		}
	);
	expect( JSON.stringify( record.mock.calls ) ).not.toMatch( /Secret|selector|private|person@/ );
	expect( JSON.stringify( record.mock.calls ) ).not.toContain( image.dataBase64 );
	expect( startAgentRun ).toHaveBeenCalledWith(
		expect.objectContaining( { visualAnnotations: annotations } )
	);
} );

it( 'does not record an ordinary turn or unsubmitted drafts', async () => {
	expect( record ).not.toHaveBeenCalled();
	expect( ( await submit() ).status ).toBe( 200 );
	expect( startAgentRun ).toHaveBeenCalledTimes( 1 );
	expect( record ).not.toHaveBeenCalled();
} );

it.each( [
	{ name: 'empty batch', annotations: [] },
	{ name: 'unsafe fields', annotations: [ { comment: 'note', url: 'https://private.test' } ] },
	{
		name: 'over the cap',
		annotations: Array.from( { length: 101 }, () => ( { comment: 'note' } ) ),
	},
] )( 'rejects $name without an event', async ( { annotations } ) => {
	expect( ( await submit( annotations ) ).status ).toBe( 400 );
	expect( startAgentRun ).not.toHaveBeenCalled();
	expect( record ).not.toHaveBeenCalled();
} );

it( 'does not record a rejected send', async () => {
	startAgentRun.mockImplementationOnce( () => {
		throw new Error( 'Run already active' );
	} );
	expect( ( await submit( [ { comment: 'note' } ] ) ).status ).toBe( 500 );
	expect( record ).not.toHaveBeenCalled();
} );

it( 'does not let a Tracks failure break sending', async () => {
	record.mockImplementationOnce( () => {
		throw new Error( 'Tracks unavailable' );
	} );
	expect( ( await submit( [ { comment: 'note' } ] ) ).status ).toBe( 200 );
	await vi.waitFor( () => expect( record ).toHaveBeenCalledTimes( 1 ) );
} );

it.each( [ 'opt-out', 'disabled' ] )(
	'honors browser Tracks %s while sending annotations',
	async ( gate ) => {
		if ( gate === 'opt-out' ) {
			await fs.writeFile( getSharedConfigPath(), '{"version":1,"analyticsOptOut":true}' );
		} else {
			vi.stubGlobal( '__ENABLE_CLI_TELEMETRY__', false );
			vi.stubEnv( 'NODE_ENV', 'production' );
		}
		expect( ( await submit( [ { comment: 'note' } ] ) ).status ).toBe( 200 );
		await vi.waitFor( () => expect( wrappedRecord ).toHaveBeenCalledTimes( 1 ) );
		await wrappedRecord.mock.results[ 0 ].value;
		expect( record ).not.toHaveBeenCalled();
	}
);
