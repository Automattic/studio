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

	// Check if already installed by verifying SKILL.md exists
	if ( ! overwrite ) {
		if ( await pathExists( path.join( agentsSkillPath, 'SKILL.md' ) ) ) {
			return;
		}
	}

	// Copy skill files to .agents/skills/<skill-id>/
	if ( overwrite ) {
		await fs.rm( agentsSkillPath, { recursive: true, force: true } );
	}
	await recursiveCopyDirectory( src, agentsSkillPath );

	// Create symlink at .claude/skills/<skill-id> → ../../.agents/skills/<skill-id>
	await fs.mkdir( path.join( sitePath, '.claude', 'skills' ), { recursive: true } );
	const relativePath = path.relative( path.join( sitePath, '.claude', 'skills' ), agentsSkillPath );

	try {
		await fs.lstat( claudeSkillPath );
		if ( overwrite ) {
			await fs.rm( claudeSkillPath, { recursive: true, force: true } );
		} else {
			return;
		}
	} catch {
		// Symlink doesn't exist, proceed
	}

	await fs.symlink( relativePath, claudeSkillPath );
}
