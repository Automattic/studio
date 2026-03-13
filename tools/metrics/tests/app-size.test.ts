import fs from 'fs';
import path from 'path';
import { test } from '@playwright/test';
import { getDirSize } from '../utils';

test.describe( 'App Size Metrics', () => {
	// eslint-disable-next-line no-empty-pattern
	test( 'measure packaged app size', async ( {}, testInfo ) => {
		const outDir = path.resolve( __dirname, '../../../apps/studio/out' );
		const results: Record< string, number > = {};

		const macDir = path.join( outDir, 'Studio-darwin-arm64', 'Studio.app' );
		const winDir = path.join( outDir, 'Studio-win32-x64' );

		if ( fs.existsSync( macDir ) ) {
			results.appSizeMac = getDirSize( macDir );
		} else if ( fs.existsSync( winDir ) ) {
			results.appSizeWin = getDirSize( winDir );
		} else {
			throw new Error(
				`Could not find packaged app directory under ${ outDir }. Run 'npm run package' first.`
			);
		}

		await testInfo.attach( 'results', {
			body: JSON.stringify( results ),
			contentType: 'application/json',
		} );
	} );
} );
