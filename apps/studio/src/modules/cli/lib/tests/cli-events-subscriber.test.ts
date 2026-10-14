import EventEmitter from 'node:events';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { updateSiteMetadata } from '@studio/common/sites/metadata';
import { vi } from 'vitest';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { captureSiteThumbnail } from 'src/lib/capture-site-thumbnail';
import { isInErrorRecovery } from 'src/lib/php-error-recovery';
import { forgetSite, getSites, refreshThemeDetails } from 'src/lib/sites';
import { startCliEventsSubscriber } from 'src/modules/cli/lib/cli-events-subscriber';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';

vi.mock( '@studio/common/sites/metadata' );
vi.mock( 'src/ipc-utils' );
vi.mock( 'src/lib/active-sync-operations' );
vi.mock( 'src/lib/capture-site-thumbnail' );
vi.mock( 'src/lib/php-error-recovery' );
vi.mock( 'src/lib/sites' );
vi.mock( 'src/modules/cli/lib/execute-command' );

const cliEvents = new EventEmitter();

function siteDetails( id: string ) {
	return {
		id,
		name: id,
		path: `/sites/${ id }`,
		port: 8881,
		url: 'http://localhost:8881',
		phpVersion: '8.3',
	};
}

async function emitSiteEvent( event: SITE_EVENTS, siteId: string, running: boolean ) {
	const value = JSON.stringify( { event, siteId, site: siteDetails( siteId ), running } );
	cliEvents.emit( 'data', { data: { action: 'keyValuePair', key: 'site-event', value } } );
	await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
}

beforeAll( async () => {
	vi.mocked( executeCliCommand ).mockImplementation( () => {
		setTimeout( () => cliEvents.emit( 'started' ) );
		return [ cliEvents, {} ] as never;
	} );
	vi.mocked( getSites ).mockResolvedValue( [ { id: 'site-a', running: true } ] as never );
	await startCliEventsSubscriber();
} );

beforeEach( () => {
	vi.clearAllMocks();
	vi.mocked( refreshThemeDetails ).mockResolvedValue( undefined );
	vi.mocked( isInErrorRecovery ).mockReturnValue( false );
} );

describe( 'CLI events subscriber', () => {
	it( 'acts on running transitions only, starting from the site list', async () => {
		await emitSiteEvent( SITE_EVENTS.UPDATED, 'site-a', true );
		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith(
			'site-event',
			expect.objectContaining( { siteId: 'site-a', running: true } )
		);
		expect( captureSiteThumbnail ).not.toHaveBeenCalled();
		expect( updateSiteMetadata ).not.toHaveBeenCalled();

		await emitSiteEvent( SITE_EVENTS.UPDATED, 'site-a', false );
		expect( updateSiteMetadata ).toHaveBeenLastCalledWith( { 'site-a': { autoStart: false } } );

		await emitSiteEvent( SITE_EVENTS.UPDATED, 'site-a', true );
		expect( captureSiteThumbnail ).toHaveBeenCalledWith( siteDetails( 'site-a' ) );
		expect( refreshThemeDetails ).toHaveBeenCalledWith( siteDetails( 'site-a' ) );
		expect( updateSiteMetadata ).toHaveBeenLastCalledWith( { 'site-a': { autoStart: true } } );

		vi.clearAllMocks();
		await emitSiteEvent( SITE_EVENTS.UPDATED, 'site-a', true );
		expect( captureSiteThumbnail ).not.toHaveBeenCalled();
		expect( updateSiteMetadata ).not.toHaveBeenCalled();
	} );

	it( 'starts a new site once, whichever of its events lands first', async () => {
		await emitSiteEvent( SITE_EVENTS.UPDATED, 'site-new', true );
		await emitSiteEvent( SITE_EVENTS.CREATED, 'site-new', true );

		expect( captureSiteThumbnail ).toHaveBeenCalledTimes( 1 );
		expect( updateSiteMetadata ).toHaveBeenCalledTimes( 1 );
		expect( updateSiteMetadata ).toHaveBeenCalledWith( { 'site-new': { autoStart: true } } );
	} );

	it( 'reports a site serving the PHP error page as running', async () => {
		await emitSiteEvent( SITE_EVENTS.CREATED, 'site-b', true );
		vi.mocked( isInErrorRecovery ).mockReturnValue( true );

		await emitSiteEvent( SITE_EVENTS.UPDATED, 'site-b', false );

		expect( sendIpcEventToRenderer ).toHaveBeenLastCalledWith(
			'site-event',
			expect.objectContaining( { siteId: 'site-b', running: true } )
		);
		expect( updateSiteMetadata ).not.toHaveBeenCalledWith( { 'site-b': { autoStart: false } } );
	} );

	it( 'forgets a deleted site', async () => {
		await emitSiteEvent( SITE_EVENTS.DELETED, 'site-c', false );

		expect( forgetSite ).toHaveBeenCalledWith( 'site-c' );
		expect( sendIpcEventToRenderer ).toHaveBeenCalledWith(
			'site-event',
			expect.objectContaining( { event: SITE_EVENTS.DELETED, siteId: 'site-c' } )
		);
	} );
} );
