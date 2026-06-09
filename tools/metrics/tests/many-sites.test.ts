import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import fs from 'fs-extra';
import { E2ESession } from '../../../apps/studio/e2e/e2e-helpers';

const DEFAULT_SITE_COUNT = 500;
const DEFAULT_ICON_SIZE_KB = 64;
const NATIVE_PHP_RUNTIME = 'native-php';
const RUNNING_MODE_ALL_STOPPED = 'all-stopped';
const RUNNING_MODE_HALF_RUNNING = 'half-running';
const RUNNING_MODE_ALL_RUNNING = 'all-running';
const RUNNING_MODES = [
	RUNNING_MODE_ALL_STOPPED,
	RUNNING_MODE_HALF_RUNNING,
	RUNNING_MODE_ALL_RUNNING,
] as const;
const FAST_SCROLL_CYCLES = 3;
type RunningMode = ( typeof RUNNING_MODES )[ number ];

function getRunningMode(): RunningMode {
	const mode = process.env.MANY_SITES_RUNNING_MODE;
	return RUNNING_MODES.includes( mode as RunningMode )
		? ( mode as RunningMode )
		: RUNNING_MODE_ALL_STOPPED;
}

function getFixtureConfig() {
	const runtime =
		process.env.STUDIO_RUNTIME === NATIVE_PHP_RUNTIME ? NATIVE_PHP_RUNTIME : 'playground';
	return {
		siteCount: Number.parseInt( process.env.MANY_SITES_COUNT ?? '', 10 ) || DEFAULT_SITE_COUNT,
		iconSizeKb: Number.parseInt( process.env.MANY_SITES_ICON_KB ?? '', 10 ) || DEFAULT_ICON_SIZE_KB,
		runningMode: getRunningMode(),
		runtime,
	};
}

function isSiteRunning( index: number, siteCount: number, runningMode: RunningMode ): boolean {
	if ( runningMode === RUNNING_MODE_ALL_RUNNING ) {
		return true;
	}
	if ( runningMode === RUNNING_MODE_HALF_RUNNING ) {
		return index < siteCount / 2;
	}
	return false;
}

function createIconSvg( sizeKb: number ): string {
	const targetBytes = sizeKb * 1024;
	const prefix = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><text>';
	const suffix = '</text></svg>';
	return `${ prefix }${ 'x'.repeat(
		Math.max( 0, targetBytes - prefix.length - suffix.length )
	) }${ suffix }`;
}

async function seedManySitesFixture( session: E2ESession ) {
	const { siteCount, iconSizeKb, runningMode } = getFixtureConfig();
	const fixtureRoot = path.join( session.sessionPath, 'many-sites-fixture' );
	const iconPath = path.join( fixtureRoot, 'site-icon.svg' );
	await fs.mkdirp( fixtureRoot );
	await fs.mkdirp( session.cliConfigPath );
	await fs.writeFile( iconPath, createIconSvg( iconSizeKb ), 'utf8' );

	const sites = Array.from( { length: siteCount }, ( _, index ) => {
		const siteNumber = String( index + 1 ).padStart( 4, '0' );
		const running = isSiteRunning( index, siteCount, runningMode );
		return {
			id: `many-sites-${ siteNumber }`,
			name: `Many Sites ${ siteNumber }`,
			path: path.join( fixtureRoot, `site-${ siteNumber }` ),
			port: 20_000 + index,
			url: `http://localhost:${ 20_000 + index }`,
			phpVersion: '8.4',
			running,
		};
	} );

	await fs.writeJson(
		path.join( session.cliConfigPath, 'cli.json' ),
		{
			version: 1,
			sites,
			snapshots: [],
		},
		{ spaces: 2 }
	);

	return {
		siteCount,
		iconSizeKb,
		runningMode,
		runningSiteCount: sites.filter( ( site ) => site.running ).length,
		siteMetadata: Object.fromEntries(
			sites.map( ( site, index ) => [
				site.id,
				{
					siteIconPath: iconPath,
					sortOrder: index,
				},
			] )
		),
	};
}

function getDescendantPids( pid: number ): number[] {
	if ( process.platform === 'win32' ) {
		return [];
	}

	try {
		const output = execFileSync( 'pgrep', [ '-P', String( pid ) ], { encoding: 'utf8' } ).trim();
		if ( ! output ) {
			return [];
		}
		const children = output
			.split( '\n' )
			.map( ( childPid ) => Number.parseInt( childPid, 10 ) )
			.filter( Number.isFinite );
		return children.flatMap( ( childPid ) => [ childPid, ...getDescendantPids( childPid ) ] );
	} catch {
		return [];
	}
}

function getProcessTreeRssMb( pid: number ): number {
	if ( process.platform === 'win32' ) {
		return 0;
	}

	const pids = [ pid, ...getDescendantPids( pid ) ];
	const output = execFileSync( 'ps', [ '-o', 'rss=', '-p', pids.join( ',' ) ], {
		encoding: 'utf8',
	} );
	const rssKb = output
		.split( '\n' )
		.map( ( value ) => Number.parseInt( value.trim(), 10 ) )
		.filter( Number.isFinite )
		.reduce( ( total, value ) => total + value, 0 );
	return Math.round( rssKb / 1024 );
}

async function captureScreenshot( session: E2ESession, testInfo, name: string ) {
	const screenshot = await session.mainWindow.screenshot();
	const artifactsPath = process.env.ARTIFACTS_PATH;
	if ( artifactsPath ) {
		await fs.mkdirp( artifactsPath );
		await fs.writeFile( path.join( artifactsPath, name ), screenshot );
	}
	await testInfo.attach( name, {
		body: screenshot,
		contentType: 'image/png',
	} );
}

async function setSidebarScrollTop( session: E2ESession, top: number ) {
	await session.mainWindow.evaluate( ( nextTop ) => {
		const scrollers = Array.from( document.querySelectorAll( '*' ) ).filter(
			( element ): element is HTMLElement =>
				element instanceof HTMLElement &&
				( element.tagName === 'ASIDE' || element.scrollHeight > element.clientHeight ) &&
				getComputedStyle( element ).overflowY !== 'hidden'
		);
		for ( const scroller of scrollers ) {
			scroller.scrollTop = nextTop;
			scroller.dispatchEvent( new Event( 'scroll', { bubbles: true } ) );
		}
	}, top );
	await session.mainWindow.waitForTimeout( 100 );
}

test.describe( 'Many Sites Metrics', () => {
	const results: Record< string, number[] > = {};
	const session = new E2ESession();

	// eslint-disable-next-line no-empty-pattern
	test.afterAll( async ( {}, testInfo ) => {
		await testInfo.attach( 'results', {
			body: JSON.stringify(
				Object.fromEntries(
					Object.entries( results ).map( ( [ metric, values ] ) => [ metric, values[ 0 ] ] )
				),
				null,
				2
			),
			contentType: 'application/json',
		} );

		await session.cleanup();
		setTimeout( () => process.exit( 0 ), 1000 );
	} );

	// eslint-disable-next-line no-empty-pattern
	test( 'measures memory and scrolling with hundreds of sites', async ( {}, testInfo ) => {
		const fixture = await seedManySitesFixture( session );
		const runtime =
			process.env.STUDIO_RUNTIME === NATIVE_PHP_RUNTIME ? NATIVE_PHP_RUNTIME : 'playground';
		await session.launch(
			{ STUDIO_RUNTIME: runtime },
			{
				initialAppdata: {
					version: 1,
					siteMetadata: fixture.siteMetadata,
					onboardingCompleted: true,
					betaFeatures: {
						studioSitesCli: true,
						nativePhpRuntime: runtime === NATIVE_PHP_RUNTIME,
					},
				},
			}
		);

		const appPid = session.electronApp.process().pid;
		const firstSite = session.mainWindow.getByText( 'Many Sites 0001' ).first();
		await expect( firstSite ).toBeVisible( { timeout: 60_000 } );

		results.siteCount = [ fixture.siteCount ];
		results.iconSizeKb = [ fixture.iconSizeKb ];
		results.runningSiteCount = [ fixture.runningSiteCount ];
		results.nativePhpRuntime = [ runtime === NATIVE_PHP_RUNTIME ? 1 : 0 ];
		results.launchRssMb = [ getProcessTreeRssMb( appPid ) ];

		await captureScreenshot( session, testInfo, 'many-sites-top.png' );

		const startTime = Date.now();
		const lastSiteName = `Many Sites ${ String( fixture.siteCount ).padStart( 4, '0' ) }`;
		const lastSite = session.mainWindow.getByText( lastSiteName ).first();
		for ( let index = 0; index < 80; index++ ) {
			if ( await lastSite.isVisible().catch( () => false ) ) {
				break;
			}
			await session.mainWindow.mouse.wheel( 0, 1200 );
			await session.mainWindow.waitForTimeout( 50 );
		}
		await expect( lastSite ).toBeVisible( { timeout: 30_000 } );

		results.scrollDuration = [ Date.now() - startTime ];
		results.scrolledRssMb = [ getProcessTreeRssMb( appPid ) ];

		await captureScreenshot( session, testInfo, 'many-sites-bottom.png' );

		const stressStartTime = Date.now();
		for ( let cycle = 0; cycle < FAST_SCROLL_CYCLES; cycle++ ) {
			await setSidebarScrollTop( session, 0 );
			await setSidebarScrollTop( session, Number.MAX_SAFE_INTEGER );
		}

		results.scrollStressCycles = [ FAST_SCROLL_CYCLES ];
		results.scrollStressDuration = [ Date.now() - stressStartTime ];
		results.scrollStressRssMb = [ getProcessTreeRssMb( appPid ) ];

		await captureScreenshot( session, testInfo, 'many-sites-stress-bottom.png' );
	} );
} );
