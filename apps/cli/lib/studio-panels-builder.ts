import { exec } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { writeFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { ensureStudioPanelsInstalled } from './studio-panels-installer';

const execAsync = promisify( exec );

/**
 * On-the-fly panel generation lives alongside the parameterized
 * `studio-panels` plugin. The agent writes a TSX `stage` component into the
 * scratch route's source file, this module rebuilds the plugin via
 * `wp-build`, and then reuses the existing installer to push the rebuilt
 * artifact into a site.
 *
 * Dev-mode only: requires the `apps/studio-panels/` source tree to be on
 * disk and writable. A packaged CLI build does not include the source.
 */

const SCRATCH_RELATIVE_SOURCE = 'routes/scratch/stage.tsx';

interface BuildResult {
	bumpedVersion: string;
	durationMs: number;
}

/**
 * Locates the `apps/studio-panels/` source directory by walking up from the
 * runtime location until it finds a `package.json` named `@studio/panels`.
 *
 * Returns null if the source tree isn't present (e.g. packaged distribution).
 */
export function findStudioPanelsSourceDir( startDir: string = import.meta.dirname ): string | null {
	let current = path.resolve( startDir );
	const root = path.parse( current ).root;
	while ( current !== root ) {
		const candidate = path.join( current, 'apps', 'studio-panels', 'package.json' );
		if ( existsSync( candidate ) ) {
			try {
				const pkg = JSON.parse( readFileSync( candidate, 'utf8' ) ) as { name?: string };
				if ( pkg.name === '@studio/panels' ) {
					return path.dirname( candidate );
				}
			} catch {
				// fall through and keep walking
			}
		}
		current = path.dirname( current );
	}
	return null;
}

export class ScratchSourceTreeMissingError extends Error {
	constructor( searched: string ) {
		super(
			`Could not find apps/studio-panels/ source tree (searched up from ${ searched }). ` +
				`On-the-fly panel generation requires the monorepo source to be writable. ` +
				`This tool only works in development.`
		);
		this.name = 'ScratchSourceTreeMissingError';
	}
}

/**
 * Writes the agent-generated TSX into the scratch package, runs wp-build,
 * bumps the version, and installs the rebuilt plugin into the given site.
 */
export async function generateAndDeployScratchPanel( {
	source,
	sitePath,
}: {
	source: string;
	sitePath: string;
} ): Promise< BuildResult > {
	const panelsDir = findStudioPanelsSourceDir();
	if ( ! panelsDir ) {
		throw new ScratchSourceTreeMissingError( import.meta.dirname );
	}

	const sourceFile = path.join( panelsDir, SCRATCH_RELATIVE_SOURCE );
	if ( ! existsSync( path.dirname( sourceFile ) ) ) {
		throw new Error( `Scratch source directory not found: ${ path.dirname( sourceFile ) }` );
	}

	await writeFile( sourceFile, source, 'utf8' );

	// Bump the version string so the installer copies the new build over the
	// previous one. (Same versioning the parameterized installer uses — we
	// just append a counter so each build is unique.)
	const versionFile = path.join( panelsDir, 'version.txt' );
	const baseVersion = readVersion( versionFile ) || '0.1.0';
	const bumpedVersion = bumpScratchVersion( baseVersion );

	const t0 = Date.now();
	try {
		await execAsync( 'npm run build', { cwd: panelsDir, env: process.env } );
	} catch ( err: unknown ) {
		const message = err instanceof Error ? err.message : String( err );
		throw new Error( `wp-build failed:\n${ message }` );
	}

	// Overwrite the version.txt that wp-build emitted so the installer treats
	// this as a new release and replaces the on-site copy.
	await writeFile( versionFile, bumpedVersion, 'utf8' );

	const builtPluginDir = path.join( panelsDir );
	// The installer expects a directory containing `version.txt`,
	// `studio-panels.php`, and `build/`. The source root has all three.
	await ensureStudioPanelsInstalled( sitePath, builtPluginDir );

	return { bumpedVersion, durationMs: Date.now() - t0 };
}

function readVersion( file: string ): string | null {
	if ( ! existsSync( file ) ) return null;
	try {
		const stats = statSync( file );
		if ( ! stats.isFile() ) return null;
		return readFileSync( file, 'utf8' ).trim() || null;
	} catch {
		return null;
	}
}

/**
 * Append a `-scratch.<n>` suffix that increments on each regeneration so the
 * installer always sees a "newer" version.
 */
function bumpScratchVersion( base: string ): string {
	const match = base.match( /^(.+?)-scratch\.(\d+)$/ );
	if ( match ) {
		const [ , prefix, n ] = match;
		return `${ prefix }-scratch.${ Number( n ) + 1 }`;
	}
	return `${ base }-scratch.1`;
}
