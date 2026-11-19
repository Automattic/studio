/**
 * @vitest-environment node
 */
import { dialog } from 'electron';
import path from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { vi } from 'vitest';
import { reportCliSpawnError } from '../missing-node-binary';

vi.mock( '@sentry/electron/main', () => ( { captureException: vi.fn() } ) );
vi.mock( 'src/main-window', () => ( { getExistingMainWindow: () => null } ) );
vi.mock( import( 'electron' ), async ( importActual ) => {
	const actual = await importActual();
	return {
		...actual,
		dialog: { ...actual.dialog, showMessageBox: vi.fn().mockResolvedValue( { response: 1 } ) },
	};
} );

function spawnError( file: string, code = 'ENOENT' ): NodeJS.ErrnoException {
	return Object.assign( new Error( `spawn ${ file } ${ code }` ), { code, path: file } );
}

it( 'tells the user and reports once when the bundled Node binary is missing', () => {
	const missingNode = path.resolve( 'missing-resources', 'bin', 'node' );

	reportCliSpawnError( spawnError( missingNode ), missingNode );
	reportCliSpawnError( spawnError( missingNode ), missingNode );
	reportCliSpawnError( spawnError( missingNode, 'EACCES' ), missingNode );

	expect( dialog.showMessageBox ).toHaveBeenCalledTimes( 1 );
	expect( Sentry.captureException ).toHaveBeenCalledTimes( 2 );
} );
