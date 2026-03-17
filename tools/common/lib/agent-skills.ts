import fs from 'fs/promises';
import path from 'path';
import { pathExists, recursiveCopyDirectory } from './fs-utils';

export const BUNDLED_SKILL_IDS = [
	'wp-plugin-development',
	'wp-block-development',
	'wp-block-themes',
	'wp-rest-api',
	'wp-wpcli-and-ops',
] as const;

export type BundledSkillId = ( typeof BUNDLED_SKILL_IDS )[ number ];

/**
 * Install all bundled agent skills from a source directory into a site's
 * `.agents/skills/` directory, with symlinks at `.claude/skills/`.
 */
export async function installSkillsToSite(
	sitePath: string,
	bundledSkillsPath: string,
	overwrite: boolean = false
): Promise< void > {
	for ( const skillId of BUNDLED_SKILL_IDS ) {
		try {
			await installSkillToSite( sitePath, bundledSkillsPath, skillId, overwrite );
		} catch {
			// Continue installing remaining skills if one fails
		}
	}
}

async function installSkillToSite(
	sitePath: string,
	bundledSkillsPath: string,
	skillId: string,
	overwrite: boolean
): Promise< void > {
	const src = path.join( bundledSkillsPath, skillId );
	if ( ! ( await pathExists( src ) ) ) {
		return;
	}

	const agentsSkillPath = path.join( sitePath, '.agents', 'skills', skillId );
	const claudeSkillPath = path.join( sitePath, '.claude', 'skills', skillId );

	const isInstalled = await pathExists( path.join( agentsSkillPath, 'SKILL.md' ) );

	// Copy skill files to .agents/skills/<skill-id>/
	if ( ! isInstalled || overwrite ) {
		if ( overwrite ) {
			await fs.rm( agentsSkillPath, { recursive: true, force: true } );
		}
		await recursiveCopyDirectory( src, agentsSkillPath );
	}

	// Ensure symlink at .claude/skills/<skill-id> exists, even if .agents/ copy was already present
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

function isErrnoException( error: unknown ): error is NodeJS.ErrnoException {
	return error instanceof Error && 'code' in error;
}
