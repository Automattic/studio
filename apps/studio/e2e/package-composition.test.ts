import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import {
	getConfiguredPhpBinaryPackageId,
	resolveSupportedPhpVersion,
} from '@studio/common/lib/php-binary-metadata';
import {
	findLatestBuild,
	parseElectronApp,
	type ElectronAppInfo,
} from 'electron-playwright-helpers';
import { matchSupportedLocale } from '../src/lib/match-supported-locale';

const DECLARATION_OR_SOURCE_MAP = /\.(map|d\.[cm]?ts)$/;
const SENTRY_BUILD_TOOL =
	/(^|\/)node_modules\/(sentry|@sentry\/bundler-plugins|oxc-parser|@oxc-parser|@oxc-project)\//;

// The files under `dir`, as `/`-separated paths relative to it.
function listFiles( dir: string ): string[] {
	if ( ! fs.existsSync( dir ) ) {
		return [];
	}
	return fs
		.readdirSync( dir, { recursive: true, withFileTypes: true } )
		.filter( ( entry ) => ! entry.isDirectory() )
		.map( ( entry ) =>
			path.relative( dir, path.join( entry.parentPath, entry.name ) ).split( path.sep ).join( '/' )
		);
}

// The files in the app's archive, read by the app's own Electron the way the app reads it.
function listArchiveFiles( app: ElectronAppInfo, archive: string ): string[] {
	const script = `
		const fs = require( 'fs' );
		const path = require( 'path' );
		const root = process.argv[ 1 ];
		const files = [];
		const walk = ( dir ) => {
			for ( const entry of fs.readdirSync( dir, { withFileTypes: true } ) ) {
				const entryPath = path.join( dir, entry.name );
				if ( entry.isDirectory() ) {
					walk( entryPath );
				} else {
					files.push( path.relative( root, entryPath ).split( path.sep ).join( '/' ) );
				}
			}
		};
		walk( root );
		process.stdout.write( JSON.stringify( files ) );
	`;
	const output = execFileSync( app.executable, [ '-e', script, archive ], {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
		maxBuffer: 64 * 1024 * 1024,
	} );
	return JSON.parse( output.toString() ) as string[];
}

type LocalePack = { name: string; locale: string; file: string; english: string };

// Chromium's locale packs, each with the English pack that matches it.
function listLocalePacks( app: ElectronAppInfo ): LocalePack[] {
	if ( app.platform === 'darwin' ) {
		const resources = path.join(
			app.resourcesDir,
			'..',
			'Frameworks',
			'Electron Framework.framework',
			'Versions',
			'A',
			'Resources'
		);
		return fs
			.readdirSync( resources )
			.filter( ( name ) => name.endsWith( '.lproj' ) )
			.map( ( name ) => {
				const [ , locale, gender = '' ] =
					/^(.+?)(_FEMININE|_MASCULINE|_NEUTER)?\.lproj$/.exec( name ) ?? [];
				return {
					name,
					locale: locale.replace( /_/g, '-' ),
					file: path.join( resources, name, 'locale.pak' ),
					english: path.join( resources, `en${ gender }.lproj`, 'locale.pak' ),
				};
			} );
	}
	const locales = path.join( app.resourcesDir, '..', 'locales' );
	return fs
		.readdirSync( locales )
		.filter( ( name ) => name.endsWith( '.pak' ) )
		.map( ( name ) => ( {
			name,
			locale: path.basename( name, '.pak' ),
			file: path.join( locales, name ),
			english: path.join( locales, 'en-US.pak' ),
		} ) );
}

test.describe( 'Package composition', () => {
	let app: ElectronAppInfo;

	test.beforeAll( () => {
		app = parseElectronApp( findLatestBuild( path.join( __dirname, '..', 'out' ) ) );
		if ( app.platform === 'win32' ) {
			// `parseElectronApp` takes the first executable it finds in the build folder.
			app.executable = app.executable.replace( /squirrel\.exe$/i, 'Studio.exe' );
		}
	} );

	test( 'ships the CLI dependencies without source maps or type declarations', () => {
		const files = listFiles( path.join( app.resourcesDir, 'cli', 'node_modules' ) );

		expect( files ).toContain( 'yargs/package.json' );
		expect( files.filter( ( file ) => DECLARATION_OR_SOURCE_MAP.test( file ) ) ).toEqual( [] );
	} );

	test( 'leaves source maps, type declarations and Sentry build tools out of the app archive', () => {
		const files = [
			...listArchiveFiles( app, path.join( app.resourcesDir, 'app.asar' ) ),
			...listFiles( path.join( app.resourcesDir, 'app.asar.unpacked' ) ),
		];

		expect( files ).toContain( 'node_modules/@sentry/electron/package.json' );
		expect(
			files.filter(
				( file ) => DECLARATION_OR_SOURCE_MAP.test( file ) || SENTRY_BUILD_TOOL.test( file )
			)
		).toEqual( [] );
	} );

	test( 'gives the locales Studio shows in English the English locale pack', () => {
		const packs = listLocalePacks( app );
		const showsInEnglish = ( { locale }: LocalePack ) =>
			new Intl.Locale( locale ).language !== 'en' &&
			matchSupportedLocale( locale ) === DEFAULT_LOCALE;
		// A link to the English pack where the package formats carry links, a copy on Windows.
		const carriesEnglish = ( { file, english }: LocalePack ) =>
			app.platform === 'win32'
				? file !== english && fs.readFileSync( file ).equals( fs.readFileSync( english ) )
				: fs.lstatSync( file ).isSymbolicLink() &&
				  fs.realpathSync( file ) === fs.realpathSync( english );

		expect( packs.filter( ( pack ) => ! fs.existsSync( pack.file ) ) ).toEqual( [] );
		expect( packs.filter( showsInEnglish ) ).not.toEqual( [] );
		expect( packs.filter( carriesEnglish ).map( ( pack ) => pack.name ) ).toEqual(
			packs.filter( showsInEnglish ).map( ( pack ) => pack.name )
		);
	} );

	test( 'ships the default PHP package as one archive', () => {
		const packageId = getConfiguredPhpBinaryPackageId(
			resolveSupportedPhpVersion( DEFAULT_PHP_VERSION )
		);

		expect( fs.readdirSync( path.join( app.resourcesDir, 'php-bin' ) ) ).toEqual( [
			`${ packageId }.tar.br`,
		] );
	} );

	test( 'leaves the Store-only CLI launcher out of the Windows installation', () => {
		test.skip( app.platform !== 'win32', 'Only Windows builds have a Store package' );

		expect( fs.existsSync( path.join( app.resourcesDir, 'bin', 'studio-cli.exe' ) ) ).toBe( false );
		expect( fs.existsSync( path.join( app.resourcesDir, 'bin', 'studio-cli.bat' ) ) ).toBe( true );
	} );
} );
