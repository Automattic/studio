import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadAiSession } from '@studio/common/ai/sessions/store';
import { vi, type Mock } from 'vitest';
import { runCommand as runAiCommand } from 'cli/commands/ai';
import { runCommand } from '../resume';

vi.mock( '@studio/common/ai/sessions/store', () => ( {
	loadAiSession: vi.fn(),
	listAiSessions: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/well-known-paths', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/well-known-paths') >() ),
	getSessionsDirectory: vi.fn(),
} ) );
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

	it( 'passes validated visual annotations from an input payload', async () => {
		( loadAiSession as Mock ).mockResolvedValue( { entries: [] } );
		const directory = await fs.mkdtemp( path.join( os.tmpdir(), 'studio-annotations-' ) );
		const inputPayloadPath = path.join( directory, 'input.json' );
		await fs.writeFile(
			inputPayloadPath,
			JSON.stringify( {
				prompt: 'Update the selected heading',
				displayMessage: '1 annotation submitted',
				visualAnnotations: [
					{ comment: '  Make it smaller  ', tag: ' h1 ', nearbyText: 'Welcome' },
				],
			} )
		);

		try {
			await runCommand( 'session-1', { json: true, inputPayloadPath } );
		} finally {
			await fs.rm( directory, { recursive: true, force: true } );
		}

		expect( runAiCommand ).toHaveBeenCalledWith(
			expect.objectContaining( {
				initialMessage: 'Update the selected heading',
				initialDisplayMessage: '1 annotation submitted',
				initialVisualAnnotations: [
					{
						comment: 'Make it smaller',
						tag: 'h1',
						elementLabel: undefined,
						nearbyText: 'Welcome',
					},
				],
			} )
		);
	} );
} );
