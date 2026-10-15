import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { resolveMigratedAiSessionsPath } from '@studio/common/ai/sessions/root-migration';
import { resolveLocalMediaFile } from '@studio/common/lib/local-media';

vi.mock( '@studio/common/ai/sessions/root-migration', () => ( {
	resolveMigratedAiSessionsPath: vi.fn( ( target: string ) => target ),
} ) );

const sessions = mkdtempSync( path.join( os.tmpdir(), 'local-media-' ) );
afterAll( () => rmSync( sessions, { recursive: true, force: true } ) );

// Containment is covered through the `studio ui` route in apps/local.
it( 'resolves a pre-migration sessions path to its new location', async () => {
	writeFileSync( path.join( sessions, 'shot.png' ), 'png' );
	vi.mocked( resolveMigratedAiSessionsPath ).mockReturnValueOnce(
		path.join( sessions, 'shot.png' )
	);

	const media = await resolveLocalMediaFile( '/legacy/sessions/shot.png', [ sessions ] );

	expect( media ).toEqual( expect.objectContaining( { mimeType: 'image/png', size: 3 } ) );
} );
