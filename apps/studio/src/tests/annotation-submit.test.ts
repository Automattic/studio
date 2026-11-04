import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHydratedAiSession } from '@studio/agent/node/sessions/manage';
import * as configFile from '@studio/common/lib/cli-config-file';
import { __recordTracksEvent, TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import {
	getCliConfigPath,
	getSessionsDirectory,
	getSharedConfigPath,
} from '@studio/common/lib/well-known-paths';
import { continueAiSession } from 'src/ipc-handlers';
import * as tracks from 'src/lib/tracks';
import { startAgentRun } from 'src/modules/ai-agent/run-manager';
import type { IpcMainInvokeEvent } from 'electron';

vi.unmock( 'atomically' );
vi.unmock( 'lockfile' );
vi.mock( 'src/modules/ai-agent/run-manager', () => ( { startAgentRun: vi.fn() } ) );
vi.mock( '@studio/common/lib/record-tracks-event', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/record-tracks-event') >() ),
	__recordTracksEvent: vi.fn(),
} ) );

const record = vi.mocked( __recordTracksEvent );
const ipcEvent = { sender: {} } as IpcMainInvokeEvent;
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

beforeEach( async () => {
	directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-annotation-submit-' ) );
	vi.stubEnv( 'DEV_CONFIG_DIR', directory );
	for ( const key of [ 'CI', 'IS_DEV_BUILD' ] ) vi.stubEnv( key, '' );
	vi.mocked( startAgentRun ).mockReturnValue( { runId: 'run-id' } );
	await fs.writeFile(
		getCliConfigPath(),
		JSON.stringify( { version: 1, sites: [ site ], snapshots: [] } )
	);
	sessionId = ( await createHydratedAiSession( getSessionsDirectory(), { site } ) ).id;
} );

afterEach( async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await fs.rm( directory, { recursive: true, force: true } );
} );

function submit( visualAnnotations?: unknown ) {
	return continueAiSession( ipcEvent, sessionId, privateText, {
		displayMessage: privateText,
		images: [ image ],
		visualAnnotations,
	} );
}

it.each( [ 1, 3, 100 ] )(
	'records one safe event for %i submitted annotations',
	async ( count ) => {
		const annotations = Array.from( { length: count }, () => ( {
			comment: privateText,
			tag: 'private-tag',
			elementLabel: privateText,
			nearbyText: privateText,
			imageIds: [ image.id ],
		} ) );
		await expect( submit( annotations ) ).resolves.toEqual( { runId: 'run-id' } );
		await vi.waitFor( () => expect( record ).toHaveBeenCalledTimes( 1 ) );
		const config = JSON.parse( await fs.readFile( getCliConfigPath(), 'utf8' ) );
		expect( config.sites[ 0 ].tracksId ).toMatch( /^[0-9a-f-]{36}$/ );
		expect( record ).toHaveBeenCalledWith(
			TRACKS_EVENTS.ANNOTATION_SUBMITTED,
			{ type: 'anon', id: expect.stringMatching( /^[0-9a-f-]{36}$/ ) },
			{
				platform: process.platform,
				arch: process.arch,
				app_version: undefined,
				is_a11n: false,
				channel: 'studio-ui',
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
	}
);

it( 'does not record an ordinary turn or an unsubmitted draft', async () => {
	expect( record ).not.toHaveBeenCalled();
	await submit();
	expect( startAgentRun ).toHaveBeenCalledTimes( 1 );
	expect( record ).not.toHaveBeenCalled();
} );

it.each( [
	{ name: 'empty batch', annotations: [] },
	{ name: 'unsafe fields', annotations: [ { comment: 'note', selector: '#secret' } ] },
	{
		name: 'over the cap',
		annotations: Array.from( { length: 101 }, () => ( { comment: 'note' } ) ),
	},
] )( 'rejects $name without an event', async ( { annotations } ) => {
	await expect( submit( annotations ) ).rejects.toThrow();
	expect( startAgentRun ).not.toHaveBeenCalled();
	expect( record ).not.toHaveBeenCalled();
} );

it( 'does not record a rejected send', async () => {
	vi.mocked( startAgentRun ).mockImplementationOnce( () => {
		throw new Error( 'Run already active' );
	} );
	await expect( submit( [ { comment: 'note' } ] ) ).rejects.toThrow( 'Run already active' );
	expect( record ).not.toHaveBeenCalled();
} );

it.each( [ 'missing', 'storage' ] )(
	'still records the count with %s site metadata',
	async ( failure ) => {
		if ( failure === 'missing' ) {
			await fs.writeFile( getCliConfigPath(), '{"version":1,"sites":[],"snapshots":[]}' );
		} else {
			vi.spyOn( configFile, 'writeCliConfigFileRaw' ).mockRejectedValueOnce(
				new Error( 'Storage unavailable' )
			);
		}
		await submit( [ { comment: privateText } ] );
		await vi.waitFor( () => expect( record ).toHaveBeenCalledTimes( 1 ) );
		expect( record.mock.calls[ 0 ][ 2 ] ).not.toHaveProperty( 'site_id' );
		expect( record.mock.calls[ 0 ][ 2 ].annotation_count ).toBe( 1 );
	}
);

it( 'does not let a Tracks failure break sending', async () => {
	record.mockImplementationOnce( () => {
		throw new Error( 'Tracks unavailable' );
	} );
	await expect( submit( [ { comment: 'note' } ] ) ).resolves.toEqual( { runId: 'run-id' } );
	await vi.waitFor( () => expect( record ).toHaveBeenCalledTimes( 1 ) );
} );

it.each( [ 'opt-out', 'CI', 'IS_DEV_BUILD' ] )(
	'honors %s while still sending annotations',
	async ( gate ) => {
		const wrappedRecord = vi.spyOn( tracks, 'recordTracksEvent' );
		if ( gate === 'opt-out' ) {
			await fs.writeFile( getSharedConfigPath(), '{"version":1,"analyticsOptOut":true}' );
		} else {
			vi.stubEnv( gate, 'true' );
		}
		await expect( submit( [ { comment: 'note' } ] ) ).resolves.toEqual( { runId: 'run-id' } );
		await vi.waitFor( () => expect( wrappedRecord ).toHaveBeenCalledTimes( 1 ) );
		await wrappedRecord.mock.results[ 0 ].value;
		expect( record ).not.toHaveBeenCalled();
	}
);
