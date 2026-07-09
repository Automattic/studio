import fs from 'fs';
import path from 'path';
import { test } from '@playwright/test';
import { getDirSize } from '../utils';

test.describe( 'App Size Metrics', () => {
	// eslint-disable-next-line no-empty-pattern
	test( 'measure packaged app size', async ( {}, testInfo ) => {
		const outDir = path.resolve( import.meta.dirname, '../../../apps/studio/out' );
		const results: Record< string, number > = {};

		const macDir = path.join( outDir, 'Studio-darwin-arm64', 'Studio.app' );

		if ( fs.existsSync( macDir ) ) {
			results.appSizeMac = getDirSize( macDir );
		} else {
			throw new Error( `Could not find packaged app at ${ macDir }. Run 'npm run package' first.` );
		}

		await testInfo.attach( 'results', {
			body: JSON.stringify( results ),
			contentType: 'application/json',
		} );
	} );
} );
