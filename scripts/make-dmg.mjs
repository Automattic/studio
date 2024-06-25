import child_process from 'child_process';
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

child_process.execSync(
	`create-dmg ` +
		`--volname ${ packageJson.productName }.app ` +
		`--volicon ${ volumeIconPath } ` +
		'--window-size 710 502 ' +
		`--background ${ backgroundPath } ` +
		`--icon ${ packageJson.productName } 533 122 ` +
		'--icon-size 80 ' +
		'--app-drop-link 533 354 ' +
		'--skip-jenkins ' +
		`${ dmgPath } ` +
		appPath,
  { stdio: 'inherit' }
);
