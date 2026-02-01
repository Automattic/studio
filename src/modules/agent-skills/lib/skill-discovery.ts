/**
 * Skill discovery functions for scanning and finding installed skills.
 *
 * Skills are stored in a .claude/skills/ directory within each site's path.
 * This matches Claude Code's standard skill discovery location, making skills
 * automatically available to both Studio's built-in agent and Claude Code.
 *
 * Each skill is a subdirectory containing a SKILL.md file and optional
 * scripts/, references/, and assets/ directories.
 */

import fs from 'fs/promises';
import nodePath from 'path';
import { SKILLS_DIRECTORY_PATH, SKILL_FILE_NAME } from './constants';
import { parseSkillFile } from './skill-parser';
import type { Skill } from '../types';

// Re-export constants for backward compatibility
export { SKILLS_DIRECTORY_PATH, SKILL_FILE_NAME } from './constants';

/**
 * Get the path to the skills directory for a site.
 *
 * @param sitePath - Absolute path to the WordPress site
 * @returns Absolute path to the .claude/skills directory
 */
export function getSkillsPath( sitePath: string ): string {
	return nodePath.join( sitePath, SKILLS_DIRECTORY_PATH );
}

/**
 * Get the path to a specific skill's directory.
 *
 * @param sitePath - Absolute path to the WordPress site
 * @param skillName - Name of the skill
 * @returns Absolute path to the skill's directory
 */
export function getSkillPath( sitePath: string, skillName: string ): string {
	return nodePath.join( getSkillsPath( sitePath ), skillName );
}

/**
 * Check if a skill exists in a site.
 *
 * @param sitePath - Absolute path to the WordPress site
 * @param skillName - Name of the skill to check
 * @returns True if the skill exists
 */
export async function skillExists( sitePath: string, skillName: string ): Promise< boolean > {
	const skillPath = getSkillPath( sitePath, skillName );
	const skillFilePath = nodePath.join( skillPath, SKILL_FILE_NAME );

	try {
		await fs.access( skillFilePath );
		return true;
	} catch {
		return false;
	}
}

/**
 * Check if a directory has a subdirectory with the given name.
 *
 * @param dirPath - Path to check in
 * @param subdirName - Name of subdirectory to look for
 * @returns True if the subdirectory exists
 */
async function hasSubdirectory( dirPath: string, subdirName: string ): Promise< boolean > {
	try {
		const stat = await fs.stat( nodePath.join( dirPath, subdirName ) );
		return stat.isDirectory();
	} catch {
		return false;
	}
}

/**
 * Parse a single skill from its directory.
 *
 * @param skillDirPath - Absolute path to the skill's directory
 * @returns Parsed skill object or null if invalid
 */
async function parseSkillFromDirectory( skillDirPath: string ): Promise< Skill | null > {
	const skillFilePath = nodePath.join( skillDirPath, SKILL_FILE_NAME );

	try {
		const content = await fs.readFile( skillFilePath, 'utf-8' );
		const { metadata, body } = parseSkillFile( content );

		// Check for optional directories
		const [ hasScripts, hasReferences, hasAssets ] = await Promise.all( [
			hasSubdirectory( skillDirPath, 'scripts' ),
			hasSubdirectory( skillDirPath, 'references' ),
			hasSubdirectory( skillDirPath, 'assets' ),
		] );

		return {
			...metadata,
			path: skillDirPath,
			body,
			hasScripts,
			hasReferences,
			hasAssets,
		};
	} catch ( error ) {
		console.error( `Failed to parse skill at ${ skillDirPath }:`, error );
		return null;
	}
}

/**
 * Discover all skills installed in a site's .claude/skills directory.
 *
 * @param sitePath - Absolute path to the WordPress site
 * @returns Array of discovered skills
 */
export async function discoverSiteSkills( sitePath: string ): Promise< Skill[] > {
	const skillsPath = getSkillsPath( sitePath );

	try {
		const entries = await fs.readdir( skillsPath, { withFileTypes: true } );
		const skills: Skill[] = [];

		for ( const entry of entries ) {
			// Skip non-directories and hidden directories (except .agentskills itself)
			if ( ! entry.isDirectory() || entry.name.startsWith( '.' ) ) {
				continue;
			}

			const skillDirPath = nodePath.join( skillsPath, entry.name );
			const skill = await parseSkillFromDirectory( skillDirPath );

			if ( skill ) {
				skills.push( skill );
			}
		}

		// Sort by name for consistent ordering
		skills.sort( ( a, b ) => a.name.localeCompare( b.name ) );

		return skills;
	} catch ( error ) {
		// If directory doesn't exist, return empty array
		if ( ( error as NodeJS.ErrnoException ).code === 'ENOENT' ) {
			return [];
		}
		console.error( `Failed to discover skills at ${ skillsPath }:`, error );
		return [];
	}
}

/**
 * Get a single skill by name from a site.
 *
 * @param sitePath - Absolute path to the WordPress site
 * @param skillName - Name of the skill to get
 * @returns The skill if found, null otherwise
 */
export async function getSkillByName(
	sitePath: string,
	skillName: string
): Promise< Skill | null > {
	const skillDirPath = getSkillPath( sitePath, skillName );
	return parseSkillFromDirectory( skillDirPath );
}

/**
 * Ensure the .claude/skills directory exists for a site.
 *
 * @param sitePath - Absolute path to the WordPress site
 * @returns Path to the created/existing directory
 */
export async function ensureSkillsDirectory( sitePath: string ): Promise< string > {
	const skillsPath = getSkillsPath( sitePath );

	try {
		await fs.mkdir( skillsPath, { recursive: true } );
	} catch ( error ) {
		// Ignore if directory already exists
		if ( ( error as NodeJS.ErrnoException ).code !== 'EEXIST' ) {
			throw error;
		}
	}

	return skillsPath;
}
