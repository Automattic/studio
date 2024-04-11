import * as path from 'path';
import { fileURLToPath } from 'url';
import createDMG from 'electron-installer-dmg';
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

await createDMG( {
	appPath,
	dmgPath,
	name: packageJson.productName,
	icon: path.resolve( __dirname, '../assets/studio-app-icon.icns' ),
	background: path.resolve( __dirname, '../assets/dmg-background.png' ),
	contents: [
		{
			x: 533,
			y: 122,
			type: 'file',
			path: appPath,
		},
		{ x: 533, y: 354, type: 'link', path: '/Applications' },
	],
	additionalDMGOptions: {
		window: {
			size: {
				width: 710,
				height: 502,
			},
		},
	},
} );
