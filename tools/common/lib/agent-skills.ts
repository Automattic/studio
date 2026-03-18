import fs from 'fs/promises';
import path from 'path';
import { pathExists, recursiveCopyDirectory } from './fs-utils';
import { isErrnoException } from './is-errno-exception';

/**
 * Install all bundled AI instructions and skills from a source directory into a site.
 *
 * Source directory layout (flat):
 *   AGENTS.md, STUDIO.md            — loose .md files copied to site root
 *   studio-cli/SKILL.md             — directories are skills, installed to .agents/skills/
 *   wp-plugin-development/SKILL.md
 *
 * Site directory layout after install:
 *   AGENTS.md, STUDIO.md
 *   .agents/skills/<id>/SKILL.md
 *   .claude/skills/<id> -> ../../.agents/skills/<id>
 */
export async function installAiInstructionsToSite(
	sitePath: string,
	bundledPath: string,
	overwrite: boolean = false
): Promise< void > {
	if ( ! ( await pathExists( bundledPath ) ) ) {
		return;
	}

	const entries = await fs.readdir( bundledPath, { withFileTypes: true } );

	for ( const entry of entries ) {
		if ( entry.isFile() && entry.name.endsWith( '.md' ) ) {
			await installInstructionFile( sitePath, bundledPath, entry.name, overwrite );
		} else if ( entry.isDirectory() ) {
			try {
				await installSkillToSite( sitePath, bundledPath, entry.name, overwrite );
			} catch {
				// Continue installing remaining skills if one fails
			}
		}
	}
}

/**
 * Update STUDIO.md in a site if it already exists, replacing it with the bundled version.
 * This is called on server start to keep Studio-managed instructions current.
 */
export async function updateStudioMdIfExists(
	sitePath: string,
	bundledPath: string
): Promise< void > {
	const fileName = 'STUDIO.md';
	const dest = path.join( sitePath, fileName );
	const src = path.join( bundledPath, fileName );

	if ( ! ( await pathExists( dest ) ) || ! ( await pathExists( src ) ) ) {
		return;
	}

	await fs.copyFile( src, dest );
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
	await fs.copyFile( path.join( bundledPath, fileName ), dest );
}

export async function installSkillToSite(
	sitePath: string,
	bundledPath: string,
	skillId: string,
	overwrite: boolean
): Promise< void > {
	const src = path.join( bundledPath, skillId );
	const agentsSkillPath = path.join( sitePath, '.agents', 'skills', skillId );
	const claudeSkillPath = path.join( sitePath, '.claude', 'skills', skillId );

	const isInstalled = await pathExists( path.join( agentsSkillPath, 'SKILL.md' ) );

	if ( ! isInstalled || overwrite ) {
		if ( overwrite ) {
			await fs.rm( agentsSkillPath, { recursive: true, force: true } );
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
	await fs.mkdir( path.join( sitePath, '.claude', 'skills' ), { recursive: true } );
	const relativePath = path.relative( path.join( sitePath, '.claude', 'skills' ), agentsSkillPath );

	const symlinkExists = await pathExists( claudeSkillPath );
	if ( symlinkExists && ! overwrite ) {
		return;
	}
	if ( symlinkExists && overwrite ) {
		await fs.rm( claudeSkillPath, { recursive: true, force: true } );
	}

	try {
		await fs.symlink( relativePath, claudeSkillPath );
	} catch ( error ) {
		// On Windows, symlinks may require admin privileges or Developer Mode.
		// Fall back to a directory junction which doesn't require elevated permissions.
		if ( isErrnoException( error ) && error.code === 'EPERM' && process.platform === 'win32' ) {
			await fs.symlink( path.resolve( agentsSkillPath ), claudeSkillPath, 'junction' );
		} else {
			throw error;
		}
	}
}
