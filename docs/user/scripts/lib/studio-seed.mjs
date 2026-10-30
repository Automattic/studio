import { execFile as execFileCallback } from 'node:child_process';
import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { readJson } from './common.mjs';
import { CLI_MAIN } from './studio-app.mjs';

const execFile = promisify( execFileCallback );

/**
 * Runs the built Studio CLI inside a profile, so it reads and writes the
 * profile's `cli.json`, sites and daemon rather than the user's. Resolves with
 * the command's stdout.
 */
export async function runCli( profile, args ) {
	const { stdout } = await execFile( process.execPath, [ CLI_MAIN, ...args ], {
		env: profile.env,
		maxBuffer: 16 * 1024 * 1024,
	} ).catch( ( error ) => {
		const tail = `${ error.stdout }${ error.stderr }`.trim().split( '\n' ).slice( -8 ).join( '\n' );
		throw new Error(
			`studio ${ args.slice( 0, 2 ).join( ' ' ) } failed (${ error.code }):\n${ tail }`
		);
	} );
	return stdout;
}

/** Creates a site in the profile's sites directory; resolves with its path. */
export async function createSite( profile, { slug, name, id, start = false } ) {
	const sitePath = path.join( profile.dirs.sites, slug );
	await runCli( profile, [
		'site',
		'create',
		'--path',
		sitePath,
		'--name',
		name,
		...( id ? [ '--id', id ] : [] ),
		...( start ? [ '--start' ] : [] ),
		'--skip-browser',
		'--skip-log-details',
	] );
	return sitePath;
}

export function stopSite( profile, sitePath ) {
	return runCli( profile, [ 'site', 'stop', '--path', sitePath ] );
}

/**
 * Creates the demo sites in a profile from `sites.json` (id, name, slug, and
 * for the site the shots open on, `import`: a Studio backup to load into it,
 * and `design`: the DESIGN.md to put in its folder, which the backup can't
 * carry).
 * Importing needs the site started, so it is stopped after; Studio starts it
 * again on launch through `autoStart` (see `siteMetadata`). The other sites
 * stay blank and stopped: they only fill out the sidebar.
 */
export async function seedSites( profile, dir ) {
	const sites = await readJson( path.join( dir, 'sites.json' ) );
	for ( const site of sites ) {
		const sitePath = await createSite( profile, { ...site, start: !! site.import } );
		if ( site.import ) {
			// The import restarts the site's server, which occasionally crashes on
			// start (an undici assertion in Studio's server child); once more then.
			const importBackup = () =>
				runCli( profile, [ 'import', path.join( dir, site.import ), '--path', sitePath ] );
			await importBackup().catch( async ( error ) => {
				console.log(
					`  Importing ${ site.import } failed (${
						error.message.split( '\n' )[ 0 ]
					}); trying again...`
				);
				await stopSite( profile, sitePath ).catch( () => {} );
				await importBackup();
			} );
			await stopSite( profile, sitePath );
		}
		if ( site.design ) {
			await copyFile( path.join( dir, site.design ), path.join( sitePath, 'DESIGN.md' ) );
		}
	}
	return sites;
}

/**
 * The `app.json` fields for the seeded sites: the sidebar keeps the order of
 * `sites.json`, and Studio starts the imported site on launch.
 */
export function siteMetadata( sites ) {
	return {
		siteMetadata: Object.fromEntries(
			sites.map( ( site, index ) => [ site.id, { sortOrder: index, autoStart: !! site.import } ] )
		),
	};
}
