import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';
import { _electron as electron } from 'playwright';

export async function launchApp( testEnv: NodeJS.ProcessEnv = {} ) {
	// find the latest build in the out directory
	const latestBuild = findLatestBuild();

	// parse the packaged Electron app and find paths and other info
	const appInfo = parseElectronApp( latestBuild );
	let executablePath = appInfo.executable;
	if ( appInfo.platform === 'win32' ) {
		// `parseElectronApp` function obtains the executable path by finding the first executable from the build folder.
		// We need to ensure that the executable is the Studio app.
		executablePath = executablePath.replace( 'Squirrel.exe', 'Studio.exe' );
	}
	const electronApp = await electron.launch( {
		args: [ appInfo.main ], // main file from package.json
		executablePath, // path to the Electron executable
		env: {
			...process.env,
			...testEnv,
			E2E: 'true', // allow app to determine whether it's running as an end-to-end test
		},
	} );
	const mainWindow = await electronApp.firstWindow( { timeout: 60_000 } );

	return [ electronApp, mainWindow ] as const;
}
