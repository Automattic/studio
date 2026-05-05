import { exec } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import path from 'path';
import { promisify } from 'util';
import { ensureStudioPanelsInstalled } from './studio-panels-installer';

const execAsync = promisify( exec );

// On-the-fly panel generation: the agent writes TSX into the scratch route's
// source file, this module rebuilds the plugin via wp-build, and the
// installer pushes the rebuilt artifact to the site. Dev-mode only — needs
// the apps/studio-panels/ source tree on disk and writable; a packaged CLI
// build does not include it.

const SCRATCH_RELATIVE_SOURCE = 'routes/scratch/stage.tsx';

interface BuildResult {
	bumpedVersion: string;
	durationMs: number;
}

// Walks up from the runtime location until it finds `apps/studio-panels/`'s
// package.json. Returns null if the source tree isn't present.
function findStudioPanelsSourceDir( startDir: string = import.meta.dirname ): string | null {
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
	constructor() {
		super(
			'Could not find apps/studio-panels/ source tree. ' +
				'On-the-fly panel generation requires the monorepo source to be writable. ' +
				'This tool only works in development.'
		);
		this.name = 'ScratchSourceTreeMissingError';
	}
}

// Append `-scratch.<n>` to the base version, incrementing on each regen so
// the installer always sees a newer version.
function bumpScratchVersion( base: string ): string {
	const match = base.match( /^(.+?)-scratch\.(\d+)$/ );
	if ( match ) {
		return `${ match[ 1 ] }-scratch.${ Number( match[ 2 ] ) + 1 }`;
	}
	return `${ base }-scratch.1`;
}

function readVersion( file: string ): string | null {
	try {
		return readFileSync( file, 'utf8' ).trim() || null;
	} catch {
		return null;
	}
}

export async function generateAndDeployScratchPanel( {
	source,
	sitePath,
}: {
	source: string;
	sitePath: string;
} ): Promise< BuildResult > {
	const panelsDir = findStudioPanelsSourceDir();
	if ( ! panelsDir ) {
		throw new ScratchSourceTreeMissingError();
	}

	const sourceFile = path.join( panelsDir, SCRATCH_RELATIVE_SOURCE );
	if ( ! existsSync( path.dirname( sourceFile ) ) ) {
		throw new Error( `Scratch source directory not found: ${ path.dirname( sourceFile ) }` );
	}

	await writeFile( sourceFile, source, 'utf8' );

	const versionFile = path.join( panelsDir, 'version.txt' );
	const bumpedVersion = bumpScratchVersion( readVersion( versionFile ) || '0.1.0' );

	const t0 = Date.now();
	try {
		await execAsync( 'npm run build', { cwd: panelsDir, env: process.env } );
	} catch ( err: unknown ) {
		const message = err instanceof Error ? err.message : String( err );
		throw new Error( `wp-build failed:\n${ message }` );
	}

	// Overwrite the version.txt that wp-build emitted so the installer sees a
	// new release and replaces the on-site copy.
	await writeFile( versionFile, bumpedVersion, 'utf8' );

	await ensureStudioPanelsInstalled( sitePath, panelsDir );

	return { bumpedVersion, durationMs: Date.now() - t0 };
}
