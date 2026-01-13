import child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import packageJson from '../package.json' with { type: 'json' };

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );

const appPath = path.resolve(
	__dirname,
	'../out',
	`${ packageJson.productName }-darwin-${ process.env.FILE_ARCHITECTURE }`,
	`${ packageJson.productName }.app`
);

const dmgPath = path.resolve(
	__dirname,
	'../out',
	`${ packageJson.productName }-darwin-${ process.env.FILE_ARCHITECTURE }.dmg`
);

const volumeIconPath = path.resolve( __dirname, '../assets/studio-app-icon.icns' );
const backgroundPath = path.resolve( __dirname, '../assets/dmg-background.png' );

const dmgSpecs = {
	title: packageJson.productName,
	icon: volumeIconPath,
	'icon-size': 80,
	background: backgroundPath,
	window: { size: { width: 710, height: 502 } },
	contents: [
		{ type: 'file', path: appPath, x: 533, y: 122 },
		{ type: 'link', path: '/Applications', x: 533, y: 354 },
	],
};

if ( fs.existsSync( dmgPath ) ) {
	fs.unlinkSync( dmgPath );
}

// Rebuild native modules needed by appdmg for current Node.js version
console.log( 'Rebuilding native modules for Node.js...' );
const nodeGypPath = path.resolve( __dirname, '..', 'node_modules', '.bin', 'node-gyp' );

const nativeModules = [ 'macos-alias', 'fs-xattr' ];
for ( const moduleName of nativeModules ) {
	const modulePath = path.resolve( __dirname, '..', 'node_modules', moduleName );
	if ( fs.existsSync( modulePath ) ) {
		console.log( `Rebuilding ${ moduleName }...` );
		try {
			child_process.execSync( `${ nodeGypPath } rebuild`, {
				cwd: modulePath,
				stdio: 'inherit',
			} );
		} catch ( error ) {
			console.error( `Failed to rebuild ${ moduleName }:`, error.message );
			throw error;
		}
	}
}

const specsFile = path.resolve( __dirname, '..', 'appdmg-specs.json' );
fs.writeFileSync( specsFile, JSON.stringify( dmgSpecs ) );
child_process.execSync(
	[ path.join( __dirname, '..', 'node_modules', '.bin', `appdmg` ), specsFile, dmgPath ].join( ' ' )
);
fs.unlinkSync( specsFile );
