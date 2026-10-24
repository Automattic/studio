/**
 * @vitest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import forgeConfig from '../../forge.config';
import packageJson from '../../package.json';

describe( 'forge config', () => {
	// Release lanes glob `Studio.app` and `Studio-*.dmg`, and logs and app data
	// live in folders named after the product.
	it( 'keeps the Studio product name for files and paths', () => {
		expect( packageJson.productName ).toBe( 'Studio' );
		expect( forgeConfig.packagerConfig?.name ).toBeUndefined();
	} );

	it( 'names the macOS app WordPress Studio in every localization', async () => {
		const buildPath = fs.mkdtempSync( path.join( os.tmpdir(), 'forge-config-' ) );
		const resources = path.join( buildPath, 'Studio.app', 'Contents', 'Resources' );
		for ( const localization of [ 'en.lproj', 'fr.lproj' ] ) {
			fs.mkdirSync( path.join( resources, localization ), { recursive: true } );
		}

		const hooks = forgeConfig.packagerConfig?.afterCopyExtraResources ?? [];
		await Promise.all(
			hooks.map( ( hook ) =>
				hook( { buildPath, electronVersion: '', platform: 'darwin', arch: 'arm64' } )
			)
		);

		for ( const localization of [ 'en.lproj', 'fr.lproj' ] ) {
			expect(
				fs.readFileSync( path.join( resources, localization, 'InfoPlist.strings' ), 'utf8' )
			).toBe( 'CFBundleDisplayName = "WordPress Studio";\nCFBundleName = "WordPress Studio";\n' );
		}
		fs.rmSync( buildPath, { recursive: true, force: true } );
	} );
} );
