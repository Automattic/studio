/**
 * @vitest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import forgeConfig from '../../forge.config';
import packageJson from '../../package.json';

// Electron locales Studio shows in a translation, whatever its language (Catalan in Spanish, Malay
// in Indonesian, Afrikaans in Dutch, European Portuguese in Brazilian), and English.
const OWN_PACK_LOCALES = [ 'en-US', 'en-GB', 'de', 'ca', 'ms', 'af', 'pt-PT', 'es-419', 'zh-TW' ];
// Electron locales Studio shows in English.
const ENGLISH_PACK_LOCALES = [ 'fi', 'da', 'sw', 'fil', 'am' ];
const GENDERS = [ '', '_FEMININE', '_MASCULINE', '_NEUTER' ];

async function runAfterExtract( buildPath: string, platform: 'darwin' | 'linux' | 'win32' ) {
	for ( const hook of forgeConfig.packagerConfig?.afterExtract ?? [] ) {
		await hook( { buildPath, electronVersion: '', platform, arch: 'arm64' } );
	}
}

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

	// Packaging for macOS and Linux, which link the packs, never runs on Windows.
	it.each( [
		...( process.platform === 'win32' ? [] : [ { platform: 'linux' as const, linked: true } ] ),
		{ platform: 'win32' as const, linked: false },
	] )(
		'gives the locales Studio shows in English the English locale pack on $platform',
		async ( { platform, linked } ) => {
			const buildPath = fs.mkdtempSync( path.join( os.tmpdir(), 'forge-config-' ) );
			const locales = path.join( buildPath, 'locales' );
			fs.mkdirSync( locales );
			for ( const locale of [ ...OWN_PACK_LOCALES, ...ENGLISH_PACK_LOCALES ] ) {
				fs.writeFileSync( path.join( locales, `${ locale }.pak` ), locale );
			}

			await runAfterExtract( buildPath, platform );

			for ( const locale of OWN_PACK_LOCALES ) {
				expect( fs.readFileSync( path.join( locales, `${ locale }.pak` ), 'utf8' ) ).toBe( locale );
			}
			for ( const locale of ENGLISH_PACK_LOCALES ) {
				const pack = path.join( locales, `${ locale }.pak` );
				expect( fs.readFileSync( pack, 'utf8' ) ).toBe( 'en-US' );
				expect( fs.lstatSync( pack ).isSymbolicLink() ).toBe( linked );
			}
			fs.rmSync( buildPath, { recursive: true, force: true } );
		}
	);

	it.skipIf( process.platform === 'win32' )(
		'links the macOS locale packs Studio shows in English to the English ones, gendered variants included',
		async () => {
			const buildPath = fs.mkdtempSync( path.join( os.tmpdir(), 'forge-config-' ) );
			const resources = path.join(
				buildPath,
				'Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources'
			);
			const folders = [ 'en', ...OWN_PACK_LOCALES, ...ENGLISH_PACK_LOCALES ]
				.filter( ( locale ) => locale !== 'en-US' )
				.map( ( locale ) => locale.replace( /-/g, '_' ) );
			for ( const folder of folders ) {
				for ( const gender of GENDERS ) {
					fs.mkdirSync( path.join( resources, `${ folder }${ gender }.lproj` ), {
						recursive: true,
					} );
					fs.writeFileSync(
						path.join( resources, `${ folder }${ gender }.lproj`, 'locale.pak' ),
						`${ folder }${ gender }`
					);
				}
			}

			await runAfterExtract( buildPath, 'darwin' );

			for ( const locale of OWN_PACK_LOCALES.filter( ( locale ) => locale !== 'en-US' ) ) {
				const folder = locale.replace( /-/g, '_' );
				for ( const gender of GENDERS ) {
					expect(
						fs.readFileSync(
							path.join( resources, `${ folder }${ gender }.lproj`, 'locale.pak' ),
							'utf8'
						)
					).toBe( `${ folder }${ gender }` );
				}
			}
			for ( const locale of ENGLISH_PACK_LOCALES ) {
				for ( const gender of GENDERS ) {
					const pack = path.join( resources, `${ locale }${ gender }.lproj`, 'locale.pak' );
					expect( fs.readlinkSync( pack ) ).toBe( `../en${ gender }.lproj/locale.pak` );
					expect( fs.readFileSync( pack, 'utf8' ) ).toBe( `en${ gender }` );
				}
			}
			fs.rmSync( buildPath, { recursive: true, force: true } );
		}
	);
} );
