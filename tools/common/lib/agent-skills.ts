import fs from 'fs';
import path from 'path';
import { pathExists, recursiveCopyDirectory } from './fs-utils';
import { isErrnoException } from './is-errno-exception';

/**
 * Managed instruction files that are always kept up-to-date on server start.
 * These are overwritten with the bundled version whenever they already exist in a site.
 */
const MANAGED_INSTRUCTION_FILES = [ 'STUDIO.md' ];

/**
 * Install all bundled AI instructions and skills from a source directory into a site.
 *
 * Source directory layout (flat):
 *   AGENTS.md, CLAUDE.md, STUDIO.md — loose .md files copied to site root
 *   studio-cli/SKILL.md             — directories are skills, installed to .agents/skills/
 *   wp-plugin-development/SKILL.md
 *
 * Site directory layout after install:
 *   AGENTS.md, CLAUDE.md, STUDIO.md
 *   .agents/skills/<id>/SKILL.md
 *   .claude/skills/<id> -> ../../.agents/skills/<id>
 */
export async function installAiInstructionsToSite(
	sitePath: string,
	bundledPath: string,
	userSelectedGlobalSkills: string[] = [],
	overwrite: boolean = false
): Promise< void > {
	if ( ! ( await pathExists( bundledPath ) ) ) {
		return;
	}

	const entries = await fs.promises.readdir( bundledPath, { withFileTypes: true } );

	const tasks: Promise< void >[] = [];
	for ( const entry of entries ) {
		if ( entry.isFile() && entry.name.endsWith( '.md' ) ) {
			tasks.push( installInstructionFile( sitePath, bundledPath, entry.name, overwrite ) );
		} else if ( entry.isDirectory() && userSelectedGlobalSkills.includes( entry.name ) ) {
			tasks.push( installSkillToSite( sitePath, bundledPath, entry.name, overwrite ) );
		}
	}

	const results = await Promise.allSettled( tasks );
	for ( const result of results ) {
		if ( result.status === 'rejected' ) {
			console.error( '[ai-skills] Failed to install:', result.reason );
		}
	}
}

/**
 * Update managed instruction files in a site if they already exist, replacing them
 * with the bundled version. Called on server start to keep Studio-managed instructions current.
 */
export async function updateManagedInstructionFiles(
	sitePath: string,
	bundledPath: string
): Promise< void > {
	for ( const fileName of MANAGED_INSTRUCTION_FILES ) {
		const dest = path.join( sitePath, fileName );
		const src = path.join( bundledPath, fileName );

		if ( ! ( await pathExists( dest ) ) || ! ( await pathExists( src ) ) ) {
			continue;
		}

		await fs.promises.copyFile( src, dest );
	}
}

async function installInstructionFile(
	sitePath: string,
	bundledPath: string,
	fileName: string,
	overwrite: boolean
): Promise< void > {
	const dest = path.join( sitePath, fileName );
	if ( ( await pathExists( dest ) ) && ! overwrite ) {
		return;
	}
	await fs.promises.copyFile( path.join( bundledPath, fileName ), dest );
}

export async function removeSkillFromSite( sitePath: string, skillId: string ): Promise< void > {
	const agentsSkillPath = path.join( sitePath, '.agents', 'skills', skillId );
	const claudeSkillPath = path.join( sitePath, '.claude', 'skills', skillId );
	await fs.promises.rm( agentsSkillPath, { recursive: true, force: true } );
	await fs.promises.rm( claudeSkillPath, { recursive: true, force: true } );
}

export async function installSkillToSite(
	sitePath: string,
	bundledPath: string,
	skillId: string,
	overwrite: boolean
): Promise< void > {
	const src = path.join( bundledPath, skillId );
	if ( ! ( await pathExists( src ) ) ) {
		return;
	}

	const agentsSkillPath = path.join( sitePath, '.agents', 'skills', skillId );
	const claudeSkillPath = path.join( sitePath, '.claude', 'skills', skillId );

	const isInstalled = await pathExists( path.join( agentsSkillPath, 'SKILL.md' ) );

	if ( ! isInstalled || overwrite ) {
		if ( overwrite ) {
			await fs.promises.rm( agentsSkillPath, { recursive: true, force: true } );
		}
		await recursiveCopyDirectory( src, agentsSkillPath );
	}

	await ensureSkillSymlink( sitePath, agentsSkillPath, claudeSkillPath, overwrite );
}

async function ensureSkillSymlink(
	sitePath: string,
	agentsSkillPath: string,
	claudeSkillPath: string,
	overwrite: boolean
): Promise< void > {
	await fs.promises.mkdir( path.join( sitePath, '.claude', 'skills' ), { recursive: true } );
	const relativePath = path.relative( path.join( sitePath, '.claude', 'skills' ), agentsSkillPath );

	if ( overwrite ) {
		await fs.promises.rm( claudeSkillPath, { recursive: true, force: true } );
	} else if ( await pathExists( claudeSkillPath ) ) {
		return;
	}

	try {
		await fs.promises.symlink( relativePath, claudeSkillPath );
	} catch ( error ) {
		// On Windows, symlinks may require admin privileges or Developer Mode.
		// Fall back to a directory junction which doesn't require elevated permissions.
		if ( isErrnoException( error ) && error.code === 'EPERM' && process.platform === 'win32' ) {
			await fs.promises.symlink( path.resolve( agentsSkillPath ), claudeSkillPath, 'junction' );
		} else {
			throw error;
		}
	}
}
