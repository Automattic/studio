import { loadAiSession } from '@studio/common/ai/sessions/store';
import { vi, type Mock } from 'vitest';
import { runCommand as runAiCommand } from 'cli/commands/ai';
import { findSiteByFolder } from 'cli/lib/cli-config/sites';
import { isSiteRunning } from 'cli/lib/site-utils';
import { runCommand } from '../resume';

vi.mock( '@studio/common/ai/sessions/store', () => ( {
	loadAiSession: vi.fn(),
	listAiSessions: vi.fn(),
} ) );
vi.mock( 'cli/ai/sessions/paths', () => ( { getAiSessionsRootDirectory: vi.fn() } ) );
vi.mock( 'cli/ai/ui', () => ( { AiChatUI: class AiChatUI {} } ) );
vi.mock( 'cli/commands/ai', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/ai/sessions/helpers', () => ( { chooseSessionForAction: vi.fn() } ) );
vi.mock( 'cli/lib/cli-config/sites', () => ( { findSiteByFolder: vi.fn() } ) );
vi.mock( 'cli/lib/site-utils', () => ( { isSiteRunning: vi.fn() } ) );

function siteSelectedEntry( data: Record< string, unknown > ) {
	return {
		type: 'custom',
		customType: 'studio.site_selected',
		id: 'e1',
		parentId: null,
		timestamp: '2024-01-01T00:00:00Z',
		data,
	};
}

describe( 'sessions resume — active site running state (JSON mode)', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'reports the site as running when the daemon says it is', async () => {
		( loadAiSession as Mock ).mockResolvedValue( {
			entries: [ siteSelectedEntry( { siteName: 'My Site', sitePath: '/sites/my-site' } ) ],
		} );
		( findSiteByFolder as Mock ).mockResolvedValue( { id: 'site-1', path: '/sites/my-site' } );
		( isSiteRunning as Mock ).mockResolvedValue( true );

		await runCommand( 'session-1', { json: true, message: 'hello' } );

		expect( runAiCommand ).toHaveBeenCalledWith(
			expect.objectContaining( {
				activeSite: expect.objectContaining( { path: '/sites/my-site', running: true } ),
			} )
		);
	} );

	it( 'reports the site as stopped when the daemon says it is not running', async () => {
		( loadAiSession as Mock ).mockResolvedValue( {
			entries: [ siteSelectedEntry( { siteName: 'My Site', sitePath: '/sites/my-site' } ) ],
		} );
		( findSiteByFolder as Mock ).mockResolvedValue( { id: 'site-1', path: '/sites/my-site' } );
		( isSiteRunning as Mock ).mockResolvedValue( false );

		await runCommand( 'session-1', { json: true, message: 'hello' } );

		expect( runAiCommand ).toHaveBeenCalledWith(
			expect.objectContaining( {
				activeSite: expect.objectContaining( { running: false } ),
			} )
		);
	} );

	it( 'treats a site missing from the CLI config as stopped', async () => {
		( loadAiSession as Mock ).mockResolvedValue( {
			entries: [ siteSelectedEntry( { siteName: 'Gone', sitePath: '/sites/gone' } ) ],
		} );
		( findSiteByFolder as Mock ).mockResolvedValue( undefined );

		await runCommand( 'session-1', { json: true, message: 'hello' } );

		expect( isSiteRunning ).not.toHaveBeenCalled();
		expect( runAiCommand ).toHaveBeenCalledWith(
			expect.objectContaining( {
				activeSite: expect.objectContaining( { running: false } ),
			} )
		);
	} );

	it( 'skips the daemon check for remote sites', async () => {
		( loadAiSession as Mock ).mockResolvedValue( {
			entries: [
				siteSelectedEntry( {
					siteName: 'Live',
					sitePath: '/sites/live',
					remote: true,
					url: 'https://example.wordpress.com',
					wpcomSiteId: 123,
				} ),
			],
		} );

		await runCommand( 'session-1', { json: true, message: 'hello' } );

		expect( findSiteByFolder ).not.toHaveBeenCalled();
		expect( isSiteRunning ).not.toHaveBeenCalled();
		expect( runAiCommand ).toHaveBeenCalledWith(
			expect.objectContaining( {
				activeSite: expect.objectContaining( { remote: true, running: undefined } ),
			} )
		);
	} );

	it( 'passes no active site when the session has no site_selected entry', async () => {
		( loadAiSession as Mock ).mockResolvedValue( { entries: [] } );

		await runCommand( 'session-1', { json: true, message: 'hello' } );

		expect( findSiteByFolder ).not.toHaveBeenCalled();
		expect( runAiCommand ).toHaveBeenCalledWith(
			expect.objectContaining( { activeSite: undefined } )
		);
	} );
} );
