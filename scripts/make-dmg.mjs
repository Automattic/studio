import child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import packageJson from '../apps/studio/package.json' with { type: 'json' };

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const fileArchitecture = process.env.FILE_ARCHITECTURE;

if ( ! fileArchitecture ) {
	throw new Error(
		'FILE_ARCHITECTURE environment variable is required (for example: x64 or arm64).'
	);
}

const outDir = path.resolve( __dirname, '../apps/studio/out' );

const appPath = path.resolve(
	outDir,
	`${ packageJson.productName }-darwin-${ fileArchitecture }`,
	`${ packageJson.productName }.app`
);

const dmgPath = path.resolve(
	outDir,
	`${ packageJson.productName }-darwin-${ fileArchitecture }.dmg`
);

const volumeIconPath = path.resolve( __dirname, '../apps/studio/assets/studio-app-icon.icns' );
const backgroundPath = path.resolve( __dirname, '../apps/studio/assets/dmg-background.png' );

const dmgSpecs = {
	title: packageJson.productName,
	icon: volumeIconPath,
	'icon-size': 80,
	background: backgroundPath,
	window: { size: { width: 710, height: 502 } },
	contents: [
		{ type: 'file', path: appPath, x: 533, y: 122 },
		{ type: 'link', path: '/Applications', x: 533, y: 354 },
		{ type: 'position', path: '.background', x: 900, y: 900 },
		{ type: 'position', path: '.DS_Store', x: 900, y: 900 },
		{ type: 'position', path: '.Trashes', x: 900, y: 900 },
		{ type: 'position', path: '.VolumeIcon.icns', x: 900, y: 900 },
	],
};

if ( fs.existsSync( dmgPath ) ) {
	fs.unlinkSync( dmgPath );
}
fs.mkdirSync( path.dirname( dmgPath ), { recursive: true } );

const specsFile = path.resolve( __dirname, '..', 'appdmg-specs.json' );
fs.writeFileSync( specsFile, JSON.stringify( dmgSpecs ) );
child_process.execSync(
	[ path.join( __dirname, '..', 'node_modules', '.bin', `appdmg` ), specsFile, dmgPath ].join( ' ' )
);
fs.unlinkSync( specsFile );
