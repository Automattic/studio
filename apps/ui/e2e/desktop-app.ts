import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
import { packagedApp } from './packaged-app';
import type { ElectronApplication, Page } from 'playwright';

export async function createSession() {
	// Keep Unix socket paths within the macOS path-length limit.
	const directory = await mkdtemp( path.join( tmpdir(), 'sx-' ) );
	const config = path.join( directory, 'config' );
	const home = path.join( directory, 'home' );
	await mkdir( config );
	await mkdir( home );
	await mkdir( path.join( directory, 'daemon' ) );
	await writeFile(
		path.join( config, 'app.json' ),
		JSON.stringify( {
			version: 1,
			siteMetadata: {},
			onboardingCompleted: true,
			onboardingHints: {
				tourDismissedVersion: Number.MAX_SAFE_INTEGER,
				whatsNewSeenVersion: Number.MAX_SAFE_INTEGER,
			},
			devToolsOpen: false,
			colorScheme: 'light',
			newSiteBehavior: 'blank',
			defaultSiteDirectory: path.join( home, 'Studio' ),
			quitSitesBehavior: 'stop',
			cliUserUninstalled: true,
			lastNightlyUpdateCheck: Date.now(),
			nightlyPromptResult: { response: 'no', dontAskAgain: true },
		} )
	);
	return { directory, config, home };
}

export async function launch(
	session: Awaited< ReturnType< typeof createSession > >,
	extraArgs: string[] = []
) {
	const env: Record< string, string > = {
		...process.env,
		IS_DEV_BUILD: '1',
		E2E: 'true',
		E2E_HOME_PATH: session.home,
		E2E_APP_DATA_PATH: path.join( session.directory, 'appData' ),
		DEV_CONFIG_DIR: session.config,
		STUDIO_PROCESS_MANAGER_HOME: path.join( session.directory, 'daemon' ),
		STUDIO_BASE_PORT:
			process.env.STUDIO_BASE_PORT ??
			String( 8881 + Number( process.env.TEST_PARALLEL_INDEX ?? 0 ) * 1000 ),
	};
	delete env.ELECTRON_RENDERER_URL;
	delete env.ELECTRON_UI_RENDERER_URL;
	delete env.ELECTRON_EXPERIMENTAL_RENDERER_URL;
	const app = await electron.launch( {
		...packagedApp( [
			`--user-data-dir=${ path.join( session.directory, 'electron' ) }`,
			...extraArgs,
		] ),
		env,
	} );
	let output = '';
	app.process().stdout?.on( 'data', ( chunk ) => {
		output += String( chunk );
	} );
	app.process().stderr?.on( 'data', ( chunk ) => {
		output += String( chunk );
	} );
	try {
		const page = await app.firstWindow();
		await page.emulateMedia( { colorScheme: null } );
		await page.waitForLoadState( 'domcontentloaded' );
		const errors: string[] = [];
		page.on( 'pageerror', ( error ) => errors.push( error.message ) );
		return { app, page, errors, logs: () => output };
	} catch ( error ) {
		console.error( output.slice( -8000 ) );
		await app.close();
		throw error;
	}
}

export async function previewText( app: ElectronApplication, page: Page ) {
	const id = await page
		.locator( 'webview' )
		.evaluate( ( element ) =>
			( element as HTMLElement & { getWebContentsId: () => number } ).getWebContentsId()
		);
	return app.evaluate( async ( { webContents }, guestId ) => {
		return webContents.fromId( guestId )?.executeJavaScript( 'document.body.innerText' );
	}, id );
}
