import child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import packageJson from '../package.json' assert { type: 'json' };

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

const specsFile = path.resolve( __dirname, '..', 'appdmg-specs.json' );
fs.writeFileSync( specsFile, JSON.stringify( dmgSpecs ) );
child_process.execSync(
	[ path.join( __dirname, '..', 'node_modules', '.bin', `appdmg` ), specsFile, dmgPath ].join( ' ' )
);
fs.unlinkSync( specsFile );
