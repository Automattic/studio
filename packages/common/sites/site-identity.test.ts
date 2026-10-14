import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSiteIcon } from './site-identity';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';

function cliPrinting( stdout: string ): ExecuteCliCommand {
	return vi.fn( () => {
		const emitter = {
			on: ( event: string, listener: ( payload: unknown ) => void ) => {
				if ( event === 'success' ) {
					setTimeout( () => listener( { result: { stdout, stderr: '' } } ) );
				}
				return emitter;
			},
		};
		return [ emitter, {} ];
	} ) as unknown as ExecuteCliCommand;
}

describe( 'readSiteIcon', () => {
	const sitePath = mkdtempSync( path.join( os.tmpdir(), 'site-identity-' ) );
	afterEach( () =>
		rmSync( path.join( sitePath, 'wp-content' ), { recursive: true, force: true } )
	);

	it( 'returns the icon as a data URL', async () => {
		mkdirSync( path.join( sitePath, 'wp-content' ) );
		writeFileSync( path.join( sitePath, 'wp-content', 'icon.png' ), 'png-bytes' );

		await expect(
			readSiteIcon( cliPrinting( '{"relativePath":"wp-content\\/icon.png"}' ), sitePath )
		).resolves.toBe( `data:image/png;base64,${ Buffer.from( 'png-bytes' ).toString( 'base64' ) }` );
	} );

	it( 'returns null when the site has no icon, or its file is gone', async () => {
		await expect( readSiteIcon( cliPrinting( 'null' ), sitePath ) ).resolves.toBeNull();
		await expect(
			readSiteIcon( cliPrinting( '{"relativePath":"wp-content\\/gone.png"}' ), sitePath )
		).resolves.toBeNull();
	} );
} );
