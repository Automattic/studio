import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import convertToWindowsStore from 'electron2appx';

// FIXME: Read from location shared with what CI uses via .buildkite/commands/install-windows-10-sdk.ps1
const windows10SDKVersion = '20348';
const windowsKitPath = `C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.${ windows10SDKVersion }.0\\x64`;

console.log( 'Verifying Windows 10 SDK location...' );
try {
	await fs.access( windowsKitPath );
	console.log( 'Windows 10 SDK found. Continuing...' );
} catch {
	console.error(
		`Windows Kit not found at ${ windowsKitPath }. Please install the Windows 10 SDK using:\n\n\t.\\.buildkite\\commands\\install-windows-10-sdk.ps1`
	);
	process.exit( 1 );
}

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

const packageJsonPath = path.resolve( __dirname, '../package.json' );
const packageJsonText = await fs.readFile( packageJsonPath, 'utf-8' );
const packageJson = JSON.parse( packageJsonText );

const outPath = path.join( __dirname, '..', 'out' );
const assetsPath = path.join( __dirname, '..', 'public', 'assets', 'appx' );

const normalizeWindowsVersion = ( version ) => {
	const noPrerelease = version.replace( /-.*/, '' );
	return `${ noPrerelease }.0`;
};

const appStoreVersion = normalizeWindowsVersion( packageJson.version );

const windowsStoreConfig = {
	containerVirtualization: false,
	inputDirectory: path.resolve( outPath, 'make', 'appx', 'x64', 'pre-appx', 'app' ),
	packageVersion: appStoreVersion,
	packageName: 'Studio by WordPress.com',
	packageDescription: packageJson.description,
	packageExecutable: `app/${ packageJson.productName }.exe`,
	windowsKit: windowsKitPath,
	deploy: false,
	assets: assetsPath,
	makePri: true,
};

console.log( 'Creating unsigned .appx / .appxbundle for Microsoft Store submission upload...' );

await convertToWindowsStore( {
	...windowsStoreConfig,
	packageDisplayName: 'Studio by WordPress.com',
	// See details at https://partner.microsoft.com/en-us/dashboard/products/<id>/identity
	publisher: 'CN=E2E5A157-746D-4B04-9116-ABE5CB928306',
	publisherDisplayName: 'Automattic, Inc.',
	identityName: 'Automattic.StudiobyWordPress.com',
	devCert: 'nil',
	outputDirectory: path.resolve( outPath, appxBundleName ),
} );

console.log( 'Converting .appx to .appxbundle...' );

const appxFile = path.resolve(
	outPath,
	appxBundleName,
	`studio-${ appStoreVersion }-unsigned.appx`
);
