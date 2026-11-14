import { execFile as execFileCallback } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { cliMain } from './locate.ts';
import type { Profile } from './profile.ts';

const execFile = promisify( execFileCallback );

/**
 * Runs the built Studio CLI inside a profile, so it reads and writes the
 * profile's `cli.json`, sites and daemon rather than the user's. Resolves with
 * the command's stdout.
 */
export async function runCli( profile: Profile, args: string[] ): Promise< string > {
	try {
		const { stdout } = await execFile( process.execPath, [ cliMain(), ...args ], {
			env: profile.env,
			maxBuffer: 16 * 1024 * 1024,
		} );
		return stdout;
	} catch ( error ) {
		const { stdout, stderr, code } = error as { stdout?: string; stderr?: string; code?: unknown };
		const tail = `${ stdout ?? '' }${ stderr ?? '' }`.trim().split( '\n' ).slice( -8 ).join( '\n' );
		throw new Error( `studio ${ args.slice( 0, 2 ).join( ' ' ) } failed (${ code }):\n${ tail }` );
	}
}

/**
 * Creates a site in the profile's sites directory; resolves with its path.
 * `blueprint` (a path or URL) is applied as the site is created.
 */
export async function createSite(
	profile: Profile,
	{
		slug,
		name,
		id,
		start = false,
		blueprint,
	}: { slug: string; name: string; id?: string; start?: boolean; blueprint?: string }
): Promise< string > {
	const sitePath = path.join( profile.dirs.sites, slug );
	await runCli( profile, [
		'site',
		'create',
		'--path',
		sitePath,
		'--name',
		name,
		...( id ? [ '--id', id ] : [] ),
		...( blueprint ? [ '--blueprint', blueprint ] : [] ),
		...( start ? [ '--start' ] : [] ),
		'--skip-browser',
		'--skip-log-details',
	] );
	return sitePath;
}

/** Starts a site unless it is running already. */
export async function startSite( profile: Profile, sitePath: string ) {
	const sites = JSON.parse( await runCli( profile, [ 'site', 'list', '--format', 'json' ] ) ) as {
		path: string;
		running?: boolean;
	}[];
	if ( ! sites.find( ( site ) => site.path === sitePath )?.running ) {
		await runCli( profile, [
			'site',
			'start',
			'--path',
			sitePath,
			'--skip-browser',
			'--skip-log-details',
		] );
	}
}

export function stopSite( profile: Profile, sitePath: string ) {
	return runCli( profile, [ 'site', 'stop', '--path', sitePath ] );
}

/** Quitting Studio stops the sites, but not when setup failed before it launched. */
export function stopAllSites( profile: Profile ) {
	return runCli( profile, [ 'site', 'stop', '--all' ] ).catch( () => {} );
}
