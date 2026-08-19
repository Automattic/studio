import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { lockFileAsync, unlockFileAsync } from '../lib/lockfile';

export const DESIGN_PROJECT_RELATIVE_ROOT = path.join( '.studio', 'design' );

export const designArtifactSchema = z.object( {
	id: z.string().min( 1 ),
	revision: z.number().int().positive(),
	kind: z.literal( 'direction' ),
	label: z.string().min( 1 ),
	parentArtifactId: z.string().min( 1 ).optional(),
	rationale: z.string().default( '' ),
	path: z.string().min( 1 ),
	digest: z.string().regex( /^sha256:[a-f0-9]{64}$/ ),
	createdAt: z.string(),
} );

export const designProjectSchema = z.object( {
	schema: z.literal( 'studio/design-project/v1' ),
	projectId: z.string().min( 1 ),
	siteId: z.string().min( 1 ),
	sessionId: z.string().nullable(),
	phase: z.enum( [
		'briefing',
		'generating-directions',
		'directions',
		'refining',
		'accepted',
		'materializing',
		'materialization-failed',
		'materialized',
	] ),
	manifestRevision: z.number().int().nonnegative(),
	brief: z.string(),
	artifacts: z.array( designArtifactSchema ),
	selectedArtifactId: z.string().nullable(),
	acceptedArtifactId: z.string().nullable(),
	materialization: z.object( {
		status: z.enum( [ 'not-started', 'running', 'failed', 'applied' ] ),
		reportPath: z.string().nullable(),
		themeSlug: z.string().nullable(),
		error: z.string().nullable(),
	} ),
	createdAt: z.string(),
	updatedAt: z.string(),
} );

export type DesignArtifact = z.infer< typeof designArtifactSchema >;
export type DesignProject = z.infer< typeof designProjectSchema >;

export function getDesignProjectRoot( sitePath: string ): string {
	return path.join( sitePath, DESIGN_PROJECT_RELATIVE_ROOT );
}

export function getDesignProjectManifestPath( sitePath: string ): string {
	return path.join( getDesignProjectRoot( sitePath ), 'project.json' );
}

export function resolveDesignProjectPath( sitePath: string, relativePath: string ): string {
	const root = path.resolve( getDesignProjectRoot( sitePath ) );
	const resolved = path.resolve( root, relativePath );
	if ( resolved !== root && ! resolved.startsWith( `${ root }${ path.sep }` ) ) {
		throw new Error( 'Design project path escapes the project directory.' );
	}
	return resolved;
}

async function withProjectLock< T >(
	sitePath: string,
	callback: () => Promise< T >
): Promise< T > {
	const root = getDesignProjectRoot( sitePath );
	await fs.promises.mkdir( root, { recursive: true } );
	const lockPath = path.join( root, 'project.lock' );
	await lockFileAsync( lockPath, { retries: 20, retryWait: 100, stale: 30_000 } );
	try {
		return await callback();
	} finally {
		await unlockFileAsync( lockPath );
	}
}

async function writeProject( sitePath: string, project: DesignProject ): Promise< void > {
	await writeFile(
		getDesignProjectManifestPath( sitePath ),
		`${ JSON.stringify( designProjectSchema.parse( project ), null, '\t' ) }\n`
	);
}

export async function readDesignProject( sitePath: string ): Promise< DesignProject | null > {
	try {
		return designProjectSchema.parse(
			JSON.parse( await readFile( getDesignProjectManifestPath( sitePath ), 'utf8' ) )
		);
	} catch ( error ) {
		if ( ( error as NodeJS.ErrnoException ).code === 'ENOENT' ) {
			return null;
		}
		throw error;
	}
}

export async function initializeDesignProject( input: {
	sitePath: string;
	siteId: string;
	brief: string;
	sessionId?: string;
} ): Promise< DesignProject > {
	return withProjectLock( input.sitePath, async () => {
		const existing = await readDesignProject( input.sitePath );
		if ( existing ) {
			return existing;
		}
		const now = new Date().toISOString();
		const project: DesignProject = {
			schema: 'studio/design-project/v1',
			projectId: crypto.randomUUID(),
			siteId: input.siteId,
			sessionId: input.sessionId ?? null,
			phase: 'briefing',
			manifestRevision: 0,
			brief: input.brief.trim(),
			artifacts: [],
			selectedArtifactId: null,
			acceptedArtifactId: null,
			materialization: {
				status: 'not-started',
				reportPath: null,
				themeSlug: null,
				error: null,
			},
			createdAt: now,
			updatedAt: now,
		};
		await fs.promises.mkdir( path.join( getDesignProjectRoot( input.sitePath ), 'artifacts' ), {
			recursive: true,
		} );
		await fs.promises.mkdir( path.join( getDesignProjectRoot( input.sitePath ), 'reports' ), {
			recursive: true,
		} );
		await writeProject( input.sitePath, project );
		return project;
	} );
}

export async function updateDesignProject(
	sitePath: string,
	update: ( project: DesignProject ) => DesignProject | Promise< DesignProject >
): Promise< DesignProject > {
	return withProjectLock( sitePath, async () => {
		const current = await readDesignProject( sitePath );
		if ( ! current ) {
			throw new Error( 'Design project not found.' );
		}
		const next = designProjectSchema.parse( await update( current ) );
		const updated: DesignProject = {
			...next,
			manifestRevision: current.manifestRevision + 1,
			updatedAt: new Date().toISOString(),
		};
		await writeProject( sitePath, updated );
		return updated;
	} );
}

export async function registerDesignArtifact( input: {
	sitePath: string;
	relativeIndexPath: string;
	label: string;
	rationale?: string;
	parentArtifactId?: string;
} ): Promise< DesignProject > {
	const absoluteIndexPath = resolveDesignProjectPath( input.sitePath, input.relativeIndexPath );
	if ( path.basename( absoluteIndexPath ) !== 'index.html' ) {
		throw new Error( 'A design artifact must point to an index.html file.' );
	}
	const contents = await fs.promises.readFile( absoluteIndexPath );
	const digest = `sha256:${ crypto.createHash( 'sha256' ).update( contents ).digest( 'hex' ) }`;
	return updateDesignProject( input.sitePath, ( project ) => {
		if (
			input.parentArtifactId &&
			! project.artifacts.some( ( artifact ) => artifact.id === input.parentArtifactId )
		) {
			throw new Error( 'Parent design artifact not found.' );
		}
		const revision = project.artifacts.length + 1;
		const artifact: DesignArtifact = {
			id: `direction-${ revision }-${ digest.slice( 7, 15 ) }`,
			revision,
			kind: 'direction',
			label: input.label.trim(),
			parentArtifactId: input.parentArtifactId,
			rationale: input.rationale?.trim() ?? '',
			path: input.relativeIndexPath.split( path.sep ).join( '/' ),
			digest,
			createdAt: new Date().toISOString(),
		};
		return {
			...project,
			phase: input.parentArtifactId ? 'refining' : 'directions',
			artifacts: [ ...project.artifacts, artifact ],
			selectedArtifactId: input.parentArtifactId ? artifact.id : project.selectedArtifactId,
		};
	} );
}

export async function selectDesignArtifact(
	sitePath: string,
	artifactId: string
): Promise< DesignProject > {
	return updateDesignProject( sitePath, ( project ) => {
		if ( ! project.artifacts.some( ( artifact ) => artifact.id === artifactId ) ) {
			throw new Error( 'Design artifact not found.' );
		}
		return { ...project, selectedArtifactId: artifactId, phase: 'refining' };
	} );
}

export async function acceptDesignArtifact(
	sitePath: string,
	artifactId: string
): Promise< DesignProject > {
	return updateDesignProject( sitePath, ( project ) => {
		if ( project.selectedArtifactId !== artifactId ) {
			throw new Error( 'Select the design artifact before accepting it.' );
		}
		return { ...project, acceptedArtifactId: artifactId, phase: 'accepted' };
	} );
}
