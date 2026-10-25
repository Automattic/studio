import path from 'node:path';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';

/** The app `npm run package` built, as the Desktop e2e in apps/studio/e2e launches it. */
export function packagedApp( args: string[] ) {
	const app = parseElectronApp(
		findLatestBuild( path.resolve( import.meta.dirname, '../../studio/out' ) )
	);
	const linuxFlags =
		app.platform === 'linux'
			? [ '--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--disable-dev-shm-usage' ]
			: [];
	return {
		executablePath:
			app.platform === 'win32'
				? app.executable.replace( 'Squirrel.exe', 'Studio.exe' )
				: app.executable,
		args: [ ...linuxFlags, ...args, app.main ],
	};
}
