import { loadAiSession } from '@studio/common/ai/sessions/store';
import { vi, type Mock } from 'vitest';
import { runCommand as runAiCommand } from 'cli/commands/ai';
import { runCommand } from '../resume';

vi.mock( '@studio/common/ai/sessions/store', () => ( {
	loadAiSession: vi.fn(),
	listAiSessions: vi.fn(),
} ) );
vi.mock( 'cli/ai/sessions/paths', () => ( { getAiSessionsRootDirectory: vi.fn() } ) );
vi.mock( 'cli/ai/ui', () => ( { AiChatUI: class AiChatUI {} } ) );
vi.mock( 'cli/commands/ai', () => ( { runCommand: vi.fn() } ) );
vi.mock( 'cli/commands/ai/sessions/helpers', () => ( { chooseSessionForAction: vi.fn() } ) );

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

describe( 'sessions resume — active site hydration (JSON mode)', () => {
	beforeEach( () => {
		vi.clearAllMocks();
	} );

	it( 'passes the local site resolved from the event log through to the ai command', async () => {
		( loadAiSession as Mock ).mockResolvedValue( {
			entries: [ siteSelectedEntry( { siteName: 'My Site', sitePath: '/sites/my-site' } ) ],
		} );

		await runCommand( 'session-1', { json: true, message: 'hello' } );

		expect( runAiCommand ).toHaveBeenCalledWith(
			expect.objectContaining( {
				activeSite: expect.objectContaining( {
					name: 'My Site',
					path: '/sites/my-site',
					remote: false,
				} ),
			} )
		);
	} );

	it( 'passes remote sites through with their WordPress.com identity', async () => {
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

		expect( runAiCommand ).toHaveBeenCalledWith(
			expect.objectContaining( {
				activeSite: expect.objectContaining( {
					remote: true,
					url: 'https://example.wordpress.com',
					wpcomSiteId: 123,
				} ),
			} )
		);
	} );

	it( 'passes no active site when the session has no site_selected entry', async () => {
		( loadAiSession as Mock ).mockResolvedValue( { entries: [] } );

		await runCommand( 'session-1', { json: true, message: 'hello' } );

		expect( runAiCommand ).toHaveBeenCalledWith(
			expect.objectContaining( { activeSite: undefined } )
		);
	} );
} );
