import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import convertToWindowsStore from 'electron2appx';

console.log( '--- :electron: Packaging AppX' );

console.log( '~~~ Verifying WINDOWS_CODE_SIGNING_CERT_PASSWORD env var...' );
if ( ! process.env.WINDOWS_CODE_SIGNING_CERT_PASSWORD ) {
	console.error( 'Required env var WINDOWS_CODE_SIGNING_CERT_PASSWORD is not set!' );
	process.exit( 1 );
}

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

// Get architecture from environment variable, default to x64 for backward compatibility
const architecture = process.env.FILE_ARCHITECTURE || 'x64';
if ( architecture !== 'x64' && architecture !== 'arm64' ) {
	console.error( `Invalid architecture: ${ architecture }. Must be 'x64' or 'arm64'.` );
	process.exit( 1 );
}

const windows10SDKVersionPath = path.resolve( __dirname, '..', '.windows-10-sdk-version' );
try {
	await fs.access( windows10SDKVersionPath );
} catch {
	console.error( `Windows version defintion not found at ${ windows10SDKVersionPath }.` );
	process.exit( 1 );
}
const windows10SDKVersionContent = await fs.readFile( windows10SDKVersionPath );
const windows10SDKVersion = windows10SDKVersionContent.toString().trim();
// Windows SDK tools (makeappx.exe, signtool.exe) are always in the x64 directory,
// regardless of the target architecture. The architecture only affects the manifest.
const windowsKitPath = `C:\\Program Files (x86)\\Windows Kits\\10\\bin\\10.0.${ windows10SDKVersion }.0\\x64`;

console.log( '~~~ Verifying Windows 10 SDK location...' );
try {
	await fs.access( windowsKitPath );
	console.log( `Windows 10 SDK verions ${ windows10SDKVersion } found. Continuing...` );
} catch {
	console.error(
		`Windows Kit not found at ${ windowsKitPath }. Please install the Windows 10 SDK using:\n\n\t.\\.buildkite\\commands\\install-windows-10-sdk.ps1`
	);
	process.exit( 1 );
}

const packageJsonPath = path.resolve( __dirname, '..', 'package.json' );
const packageJsonText = await fs.readFile( packageJsonPath, 'utf-8' );
const packageJson = JSON.parse( packageJsonText );

const outPath = path.join( __dirname, '..', 'out' );
const assetsPath = path.join( __dirname, '..', 'apps', 'studio', 'assets', 'appx' );

console.log( `~~~ Packaging AppX for architecture: ${ architecture }` );

const normalizeWindowsVersion = ( version ) => {
	const noPrerelease = version.replace( /-.*/, '' );
	return `${ noPrerelease }.0`;
};

const appStoreVersion = normalizeWindowsVersion( packageJson.version );

const appxName = packageJson.productName + '-appx';

async function addProtocolHandlerToManifest( manifestPath ) {
	console.log( '~~~ Adding protocol handler to manifest...' );
	const manifestContent = await fs.readFile( manifestPath, 'utf-8' );

	// Check if protocol handler already exists
	if ( manifestContent.includes( 'wp-studio' ) ) {
		console.log( '~~~ Protocol handler already exists, skipping...' );
		return;
	}

	// Insert the protocol handler extension before </Application>
	const protocolExtension = `      <Extensions>
        <uap:Extension Category="windows.protocol">
          <uap:Protocol Name="wp-studio">
            <uap:DisplayName>WordPress.com Local Dev Protocol</uap:DisplayName>
          </uap:Protocol>
        </uap:Extension>
      </Extensions>`;

	const updatedManifest = manifestContent.replace(
		'</Application>',
		`${ protocolExtension }\n    </Application>`
	);

	await fs.writeFile( manifestPath, updatedManifest, 'utf-8' );
	console.log( '~~~ Protocol handler added successfully' );
}

const sharedOptions = {
	containerVirtualization: false,
	inputDirectory: path.resolve( outPath, `Studio-win32-${ architecture }` ),
	packageVersion: appStoreVersion,
	// Results in Id being invalid (might just be a matter of escaping, though)
	// packageName: 'WordPress Studio',
	packageName: 'Studio',
	packageDescription: packageJson.description,
	packageExecutable: `app/${ packageJson.productName }.exe`,
	windowsKit: windowsKitPath,
	deploy: false,
	assets: assetsPath,
	makePri: false, // from electron2appx docs: "you don't need to unless you know you do"
	packageDisplayName: 'WordPress Studio',
	publisherDisplayName: 'Automattic, Inc.',
	identityName: '22490Automattic.StudiobyWordPress.com',
	finalSay: async function () {
		// This hook runs after manifest generation but before packaging
		const manifestPath = path.join( this.outputDirectory, 'pre-appx', 'AppXManifest.xml' );
		await addProtocolHandlerToManifest( manifestPath );
	},
};

// Create unsigned AppX
const appxOutputPathUnsigned = path.resolve( outPath, `${ appxName }-${ architecture }-unsigned` );
console.log(
	`~~~ Creating unsigned .appx for Microsoft Store submission upload at ${ appxOutputPathUnsigned }...`
);

await convertToWindowsStore( {
	...sharedOptions,
	// See details at https://partner.microsoft.com/en-us/dashboard/products/<id>/identity
	publisher: 'CN=E2E5A157-746D-4B04-9116-ABE5CB928306',
	devCert: 'nil', // skip code signing for Store upload
	outputDirectory: appxOutputPathUnsigned,
} );

// Create signed AppX
const appxOutputPathSigned = path.resolve( outPath, `${ appxName }-${ architecture }-signed` );
console.log( `~~~ Creating signed .appx for local testing at ${ appxOutputPathSigned }...` );

await convertToWindowsStore( {
	...sharedOptions,
	publisher: 'CN=&quot;Automattic, Inc.&quot;, O=&quot;Automattic, Inc.&quot;, S=California, C=US',
	devCert: 'certificate.pfx',
	certPass: process.env.WINDOWS_CODE_SIGNING_CERT_PASSWORD,
	outputDirectory: appxOutputPathSigned,
} );
