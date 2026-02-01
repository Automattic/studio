/**
 * Skill installer for downloading and managing skills from GitHub.
 *
 * Handles downloading skills from GitHub repositories and installing them
 * into the site's .claude/skills directory.
 */

import fs from 'fs/promises';
import https from 'https';
import nodePath from 'path';
import { DEFAULT_BRANCH, DEFAULT_SKILLS_REPO, SKILL_FILE_NAME } from './constants';
import { ensureSkillsDirectory, getSkillPath, skillExists } from './skill-discovery';
import { parseSkillFile } from './skill-parser';
import type { AvailableSkill, Skill, SkillInstallResult } from '../types';

// Re-export constants for backward compatibility
export { DEFAULT_BRANCH, DEFAULT_SKILLS_REPO } from './constants';

/**
 * Make an HTTPS GET request and return the response body.
 *
 * @param url - URL to fetch
 * @returns Response body as string
 */
async function fetchUrl( url: string ): Promise< string > {
	return new Promise( ( resolve, reject ) => {
		const request = https.get(
			url,
			{
				headers: {
					'User-Agent': 'WordPress-Studio',
					Accept: 'application/vnd.github.v3+json',
				},
			},
			( response ) => {
				// Handle redirects
				if ( response.statusCode === 301 || response.statusCode === 302 ) {
					if ( response.headers.location ) {
						fetchUrl( response.headers.location ).then( resolve ).catch( reject );
						return;
					}
				}

				if ( response.statusCode !== 200 ) {
					reject( new Error( `HTTP ${ response.statusCode }: ${ response.statusMessage }` ) );
					return;
				}

				let data = '';
				response.on( 'data', ( chunk ) => ( data += chunk ) );
				response.on( 'end', () => resolve( data ) );
				response.on( 'error', reject );
			}
		);

		request.on( 'error', reject );
		request.end();
	} );
}

/**
 * Download raw file content from GitHub.
 *
 * @param repo - Repository in "owner/repo" format
 * @param filePath - Path to the file within the repo
 * @param branch - Branch to download from
 * @returns File content
 */
async function downloadRawFile(
	repo: string,
	filePath: string,
	branch: string = DEFAULT_BRANCH
): Promise< string > {
	const url = `https://raw.githubusercontent.com/${ repo }/${ branch }/${ filePath }`;
	return fetchUrl( url );
}

/**
 * List contents of a directory in a GitHub repository using the API.
 *
 * @param repo - Repository in "owner/repo" format
 * @param path - Path within the repo
 * @param branch - Branch to list from
 * @returns Array of directory entries
 */
async function listGitHubDirectory(
	repo: string,
	path: string,
	branch: string = DEFAULT_BRANCH
): Promise< Array< { name: string; path: string; type: 'file' | 'dir' } > > {
	const url = `https://api.github.com/repos/${ repo }/contents/${ path }?ref=${ branch }`;
	const response = await fetchUrl( url );
	const entries = JSON.parse( response );

	if ( ! Array.isArray( entries ) ) {
		throw new Error( 'Expected directory listing from GitHub API' );
	}

	return entries.map( ( entry: { name: string; path: string; type: string } ) => ( {
		name: entry.name,
		path: entry.path,
		type: entry.type === 'dir' ? 'dir' : 'file',
	} ) );
}

/**
 * Recursively download a directory from GitHub.
 *
 * @param repo - Repository in "owner/repo" format
 * @param remotePath - Path within the repo
 * @param localPath - Local path to download to
 * @param branch - Branch to download from
 */
async function downloadDirectory(
	repo: string,
	remotePath: string,
	localPath: string,
	branch: string = DEFAULT_BRANCH
): Promise< void > {
	await fs.mkdir( localPath, { recursive: true } );

	const entries = await listGitHubDirectory( repo, remotePath, branch );

	for ( const entry of entries ) {
		const localEntryPath = nodePath.join( localPath, entry.name );

		if ( entry.type === 'dir' ) {
			await downloadDirectory( repo, entry.path, localEntryPath, branch );
		} else {
			const content = await downloadRawFile( repo, entry.path, branch );
			await fs.writeFile( localEntryPath, content, 'utf-8' );
		}
	}
}

/**
 * Install a skill from a GitHub repository.
 *
 * @param sitePath - Absolute path to the WordPress site
 * @param repo - Repository in "owner/repo" format
 * @param skillPath - Path to the skill within the repo
 * @param branch - Branch to install from
 * @returns Installation result
 */
export async function installSkillFromGitHub(
	sitePath: string,
	repo: string,
	skillPath: string,
	branch: string = DEFAULT_BRANCH
): Promise< SkillInstallResult > {
	try {
		// First, fetch the SKILL.md to get the skill name
		const skillMdPath = `${ skillPath }/${ SKILL_FILE_NAME }`;
		const skillContent = await downloadRawFile( repo, skillMdPath, branch );
		const { metadata, body } = parseSkillFile( skillContent );

		// Check if skill already exists
		if ( await skillExists( sitePath, metadata.name ) ) {
			return {
				success: false,
				error: `Skill "${ metadata.name }" is already installed`,
			};
		}

		// Ensure .agentskills directory exists
		await ensureSkillsDirectory( sitePath );

		// Create the skill directory using the skill name
		const localSkillPath = getSkillPath( sitePath, metadata.name );

		// Download the entire skill directory
		await downloadDirectory( repo, skillPath, localSkillPath, branch );

		// Check for optional directories
		const [ hasScripts, hasReferences, hasAssets ] = await Promise.all( [
			fs
				.stat( nodePath.join( localSkillPath, 'scripts' ) )
				.then( ( s ) => s.isDirectory() )
				.catch( () => false ),
			fs
				.stat( nodePath.join( localSkillPath, 'references' ) )
				.then( ( s ) => s.isDirectory() )
				.catch( () => false ),
			fs
				.stat( nodePath.join( localSkillPath, 'assets' ) )
				.then( ( s ) => s.isDirectory() )
				.catch( () => false ),
		] );

		const skill: Skill = {
			...metadata,
			path: localSkillPath,
			body,
			hasScripts,
			hasReferences,
			hasAssets,
		};

		return {
			success: true,
			skill,
		};
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		console.error( `Failed to install skill from ${ repo }/${ skillPath }:`, error );
		return {
			success: false,
			error: `Failed to install skill: ${ errorMessage }`,
		};
	}
}

/**
 * Remove an installed skill from a site.
 *
 * @param sitePath - Absolute path to the WordPress site
 * @param skillName - Name of the skill to remove
 */
export async function removeSkill( sitePath: string, skillName: string ): Promise< void > {
	const skillPath = getSkillPath( sitePath, skillName );

	// Verify the skill exists
	if ( ! ( await skillExists( sitePath, skillName ) ) ) {
		throw new Error( `Skill "${ skillName }" is not installed` );
	}

	// Remove the skill directory recursively
	await fs.rm( skillPath, { recursive: true, force: true } );
}

/**
 * List available skills from a GitHub repository.
 *
 * Expects the repository to have a skills/ directory containing subdirectories
 * for each skill, each with a SKILL.md file.
 *
 * @param repo - Repository in "owner/repo" format
 * @param branch - Branch to list from
 * @returns Array of available skills
 */
export async function listAvailableSkills(
	repo: string = DEFAULT_SKILLS_REPO,
	branch: string = DEFAULT_BRANCH
): Promise< AvailableSkill[] > {
	// List the skills directory in the repo
	let entries;
	try {
		entries = await listGitHubDirectory( repo, 'skills', branch );
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		console.error( `Failed to list skills from ${ repo }:`, error );
		// Re-throw with a more helpful message
		throw new Error(
			`Could not access skills in ${ repo }. ${ errorMessage }. Make sure the repository exists and has a "skills/" directory.`
		);
	}

	const availableSkills: AvailableSkill[] = [];

	// For each directory, try to read its SKILL.md
	for ( const entry of entries ) {
		if ( entry.type !== 'dir' ) {
			continue;
		}

		try {
			const skillMdPath = `${ entry.path }/${ SKILL_FILE_NAME }`;
			const content = await downloadRawFile( repo, skillMdPath, branch );
			const { metadata } = parseSkillFile( content );

			availableSkills.push( {
				name: metadata.name,
				description: metadata.description,
				path: entry.path,
			} );
		} catch ( skillError ) {
			// Skip skills that can't be parsed
			console.warn( `Failed to parse skill at ${ entry.path }:`, skillError );
		}
	}

	return availableSkills;
}
