import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import convertToWindowsStore from 'electron2appx';

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

const windows10SDKVersionPath = path.resolve( __dirname, '..', '.windows-10-sdk-version' );
try {
	await fs.access( windows10SDKVersionPath );
} catch {
	console.error( `Windows version defintion not found at ${ windows10SDKVersionPath }.` );
	process.exit( 1 );
}
const windows10SDKVersionContent = await fs.readFile( windows10SDKVersionPath ); //..trim();
const windows10SDKVersion = windows10SDKVersionContent.toString().trim();
const windowsKitPath = `C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.${ windows10SDKVersion }.0\\x64`;

console.log( 'Verifying Windows 10 SDK location...' );
try {
	await fs.access( windowsKitPath );
	console.log( `Windows 10 SDK verions ${ windows10SDKVersion } found. Continuing...` );
} catch {
	console.error(
		`Windows Kit not found at ${ windowsKitPath }. Please install the Windows 10 SDK using:\n\n\t.\\.buildkite\\commands\\install-windows-10-sdk.ps1`
	);
	process.exit( 1 );
}

const packageJsonPath = path.resolve( __dirname, '../package.json' );
const packageJsonText = await fs.readFile( packageJsonPath, 'utf-8' );
const packageJson = JSON.parse( packageJsonText );

const outPath = path.join( __dirname, '..', 'out' );
const assetsPath = path.join( __dirname, '..', 'assets', 'appx' );

const normalizeWindowsVersion = ( version ) => {
	const noPrerelease = version.replace( /-.*/, '' );
	return `${ noPrerelease }.0`;
};

const appStoreVersion = normalizeWindowsVersion( packageJson.version );

console.log( 'Creating unsigned .appx / .appxbundle for Microsoft Store submission upload...' );

const appxBundleName = packageJson.productName + '-appx';

await convertToWindowsStore( {
	containerVirtualization: false,
	inputDirectory: path.resolve( outPath, 'Studio-win32-x64' ),
	packageVersion: appStoreVersion,
	// Results in Id being invalid (might just be a matter of escaping, though)
	// packageName: 'Studio by WordPress.com',
	packageName: 'Studio',
	packageDescription: packageJson.description,
	packageExecutable: `app/${ packageJson.productName }.exe`,
	windowsKit: windowsKitPath,
	deploy: false,
	assets: assetsPath,
	makePri: true,
	packageDisplayName: 'Studio by WordPress.com',
	// See details at https://partner.microsoft.com/en-us/dashboard/products/<id>/identity
	publisher: 'CN=E2E5A157-746D-4B04-9116-ABE5CB928306',
	publisherDisplayName: 'Automattic, Inc.',
	identityName: '22490Automattic.StudiobyWordPress.com',
	devCert: 'nil', // skip code signing for Store upload
	outputDirectory: path.resolve( outPath, appxBundleName ),
} );
