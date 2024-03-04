import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';
import { _electron as electron } from 'playwright';

export async function launchApp( testEnv: NodeJS.ProcessEnv = {} ) {
	// find the latest build in the out directory
	const latestBuild = findLatestBuild();

	// parse the packaged Electron app and find paths and other info
	const appInfo = parseElectronApp( latestBuild );
	const electronApp = await electron.launch( {
		args: [ appInfo.main ], // main file from package.json
		executablePath: appInfo.executable, // path to the Electron executable
		env: {
			...process.env,
			...testEnv,
			E2E: 'true', // allow app to determine whether it's running as an end-to-end test
		},
	} );
	const mainWindow = await electronApp.firstWindow();

	return [ electronApp, mainWindow ] as const;
}
