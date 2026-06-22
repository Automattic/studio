import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';
import { LOCKFILE_STALE_TIME, LOCKFILE_WAIT_TIME } from '../constants';
import { hideDirectoryOnWindows } from './hide-dir-windows';
import { lockFileAsync, unlockFileAsync } from './lockfile';
import { discoverPluginProject, inferPluginSlug } from './plugin-projects';
import {
	getConfigDirectory,
	getPublishingConfigLockFilePath,
	getPublishingConfigPath,
} from './well-known-paths';
import type {
	DevelopmentProject,
	DevelopmentProjectSource,
	DevelopmentProjectType,
	PublishingConfig,
} from '../types/publishing';

const PUBLISHING_CONFIG_VERSION = 1;

const storedProjectSchema = z
	.object( {
		id: z.string(),
		type: z.enum( [ 'plugin', 'theme' ] ),
		source: z.enum( [ 'manual', 'clone' ] ),
		path: z.string(),
		name: z.string().optional(),
		slug: z.string().optional(),
		addedAt: z.string(),
		updatedAt: z.string(),
		linkedSiteId: z.string().optional(),
	} )
	.loose();

const storedPublishingConfigSchema = z
	.object( {
		version: z.literal( PUBLISHING_CONFIG_VERSION ),
		projects: z.array( storedProjectSchema ).default( [] ),
	} )
	.loose();

type StoredPublishingConfig = z.infer< typeof storedPublishingConfigSchema >;
type StoredDevelopmentProject = z.infer< typeof storedProjectSchema >;

const DEFAULT_PUBLISHING_CONFIG: StoredPublishingConfig = {
	version: PUBLISHING_CONFIG_VERSION,
	projects: [],
};

function getErrorMessage( error: unknown ): string {
	if ( error instanceof Error ) {
		return error.message;
	}
	return String( error );
}

function getProjectId( type: DevelopmentProjectType, projectPath: string ): string {
	const hash = crypto.createHash( 'sha256' ).update( path.resolve( projectPath ) ).digest( 'hex' );
	return `${ type }-${ hash.slice( 0, 24 ) }`;
}

function getFallbackProjectName( projectPath: string ): string {
	return path.basename( projectPath ) || projectPath;
}

function getFallbackProjectSlug( projectPath: string ): string {
	return inferPluginSlug( projectPath, {} );
}

function toPublicConfig( config: StoredPublishingConfig ): PublishingConfig {
	return {
		version: PUBLISHING_CONFIG_VERSION,
		projects: config.projects.map( ( project ) => ( {
			...project,
			name: project.name || getFallbackProjectName( project.path ),
			slug: project.slug || getFallbackProjectSlug( project.path ),
			exists: fs.existsSync( project.path ),
		} ) ),
	};
}

async function hydrateProject( project: StoredDevelopmentProject ): Promise< DevelopmentProject > {
	const fallback = {
		...project,
		name: project.name || getFallbackProjectName( project.path ),
		slug: project.slug || getFallbackProjectSlug( project.path ),
		exists: fs.existsSync( project.path ),
	};

	if ( ! fallback.exists ) {
		return {
			...fallback,
			error: 'Project folder not found.',
		};
	}

	if ( project.type !== 'plugin' ) {
		return {
			...fallback,
			error: 'Theme projects are planned but not available yet.',
		};
	}

	try {
		const info = await discoverPluginProject( project.path );
		return {
			...project,
			path: info.rootDir,
			name: info.name,
			slug: info.slug,
			exists: true,
			info,
		};
	} catch ( error ) {
		return {
			...fallback,
			error: getErrorMessage( error ),
		};
	}
}

export async function readPublishingConfig(): Promise< PublishingConfig > {
	const configPath = getPublishingConfigPath();

	if ( ! fs.existsSync( configPath ) ) {
		return toPublicConfig( DEFAULT_PUBLISHING_CONFIG );
	}

	try {
		const fileContent = await readFile( configPath, { encoding: 'utf8' } );
		const parsed = storedPublishingConfigSchema.parse( JSON.parse( fileContent ) );
		return toPublicConfig( parsed );
	} catch ( error ) {
		if ( error instanceof SyntaxError || error instanceof z.ZodError ) {
			return toPublicConfig( DEFAULT_PUBLISHING_CONFIG );
		}
		throw new Error( 'Failed to read publishing config file.' );
	}
}

async function readStoredPublishingConfig(): Promise< StoredPublishingConfig > {
	const publicConfig = await readPublishingConfig();
	return {
		version: PUBLISHING_CONFIG_VERSION,
		projects: publicConfig.projects.map( ( { exists, info, error, ...project } ) => project ),
	};
}

export async function savePublishingConfig( config: StoredPublishingConfig ): Promise< void > {
	const configDir = getConfigDirectory();
	if ( ! fs.existsSync( configDir ) ) {
		fs.mkdirSync( configDir, { recursive: true } );
		await hideDirectoryOnWindows( configDir );
	}

	const fileContent =
		JSON.stringify( { ...config, version: PUBLISHING_CONFIG_VERSION }, null, 2 ) + '\n';
	await writeFile( getPublishingConfigPath(), fileContent, { encoding: 'utf8' } );
}

export async function lockPublishingConfig(): Promise< void > {
	await lockFileAsync( getPublishingConfigLockFilePath(), {
		wait: LOCKFILE_WAIT_TIME,
		stale: LOCKFILE_STALE_TIME,
	} );
}

export async function unlockPublishingConfig(): Promise< void > {
	await unlockFileAsync( getPublishingConfigLockFilePath() );
}

export async function listDevelopmentProjects(): Promise< DevelopmentProject[] > {
	const config = await readStoredPublishingConfig();
	return Promise.all( config.projects.map( hydrateProject ) );
}

export async function addDevelopmentProject(
	projectPath: string,
	source: DevelopmentProjectSource = 'manual',
	type: DevelopmentProjectType = 'plugin'
): Promise< DevelopmentProject > {
	if ( type !== 'plugin' ) {
		throw new Error( 'Theme projects are planned but not available yet.' );
	}

	const info = await discoverPluginProject( projectPath );
	const now = new Date().toISOString();
	const id = getProjectId( type, info.rootDir );
	let storedProject: StoredDevelopmentProject;

	try {
		await lockPublishingConfig();
		const config = await readStoredPublishingConfig();
		const existingProject = config.projects.find( ( project ) => project.id === id );
		storedProject = {
			id,
			type,
			source: existingProject?.source ?? source,
			path: info.rootDir,
			name: info.name,
			slug: info.slug,
			addedAt: existingProject?.addedAt ?? now,
			updatedAt: now,
			linkedSiteId: existingProject?.linkedSiteId,
		};

		config.projects = [
			storedProject,
			...config.projects.filter( ( project ) => project.id !== id ),
		];
		await savePublishingConfig( config );
	} finally {
		await unlockPublishingConfig();
	}

	return hydrateProject( storedProject );
}

export async function removeDevelopmentProject(
	projectId: string
): Promise< DevelopmentProject[] > {
	try {
		await lockPublishingConfig();
		const config = await readStoredPublishingConfig();
		config.projects = config.projects.filter( ( project ) => project.id !== projectId );
		await savePublishingConfig( config );
	} finally {
		await unlockPublishingConfig();
	}

	return listDevelopmentProjects();
}

export async function refreshDevelopmentProject(
	projectId: string
): Promise< DevelopmentProject > {
	try {
		await lockPublishingConfig();
		const config = await readStoredPublishingConfig();
		const project = config.projects.find( ( item ) => item.id === projectId );

		if ( ! project ) {
			throw new Error( 'Project not found.' );
		}

		if ( project.type === 'plugin' ) {
			try {
				const info = await discoverPluginProject( project.path );
				project.path = info.rootDir;
				project.name = info.name;
				project.slug = info.slug;
			} catch {
				// Keep stale metadata visible; the hydrated project will carry the error.
			}
		}

		project.updatedAt = new Date().toISOString();
		await savePublishingConfig( config );
		return hydrateProject( project );
	} finally {
		await unlockPublishingConfig();
	}
}

export async function updateDevelopmentProjectLinkedSite(
	projectId: string,
	linkedSiteId: string | undefined
): Promise< DevelopmentProject > {
	try {
		await lockPublishingConfig();
		const config = await readStoredPublishingConfig();
		const project = config.projects.find( ( item ) => item.id === projectId );

		if ( ! project ) {
			throw new Error( 'Project not found.' );
		}

		project.linkedSiteId = linkedSiteId;
		project.updatedAt = new Date().toISOString();
		await savePublishingConfig( config );
		return hydrateProject( project );
	} finally {
		await unlockPublishingConfig();
	}
}
