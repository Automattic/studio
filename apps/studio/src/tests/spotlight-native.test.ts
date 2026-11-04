import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import forgeConfig from '../../forge.config';

it.skipIf( process.platform !== 'darwin' )(
	'packages a loadable native bridge that rejects malformed input',
	async () => {
		const buildPath = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-spotlight-native-' ) );
		try {
			for ( const hook of forgeConfig.packagerConfig?.afterCopy ?? [] ) {
				await hook( {
					buildPath,
					platform: 'darwin',
					arch: process.arch as 'arm64' | 'x64',
					electronVersion: '',
				} );
			}
			const bridge = createRequire( import.meta.url )(
				path.join( buildPath, 'native/spotlight.node' )
			);
			expect( () => bridge.replaceEntries( 42 ) ).toThrow(
				'Expected Spotlight entries as a JSON string.'
			);
			await expect( bridge.replaceEntries( '{}' ) ).rejects.toThrow(
				'Spotlight entries must be a JSON array.'
			);
			await expect( bridge.replaceEntries( '[{}]' ) ).rejects.toThrow( 'Invalid Spotlight entry.' );
		} finally {
			fs.rmSync( buildPath, { recursive: true, force: true } );
		}
	}
);
