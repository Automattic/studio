import fs from 'fs/promises';
import https from 'https';
import nodePath from 'path';
import { DEFAULT_BRANCH, DEFAULT_SKILLS_REPO, SKILL_FILE_NAME } from './constants';
import { ensureSkillsDirectory, getSkillPath, skillExists } from './skill-discovery';
import { parseSkillFile } from './skill-parser';
import type { AvailableSkill, Skill, SkillInstallResult } from '../types';

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

async function downloadRawFile(
	repo: string,
	filePath: string,
	branch: string = DEFAULT_BRANCH
): Promise< string > {
	const url = `https://raw.githubusercontent.com/${ repo }/${ branch }/${ filePath }`;
	return fetchUrl( url );
}

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
		type: entry.type === 'dir' ? ( 'dir' as const ) : ( 'file' as const ),
	} ) );
}

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

export async function installSkillFromGitHub(
	sitePath: string,
	repo: string,
	skillPath: string,
	branch: string = DEFAULT_BRANCH
): Promise< SkillInstallResult > {
	try {
		const skillMdPath = `${ skillPath }/${ SKILL_FILE_NAME }`;
		const skillContent = await downloadRawFile( repo, skillMdPath, branch );
		const { metadata, body } = parseSkillFile( skillContent );

		if ( await skillExists( sitePath, metadata.name ) ) {
			return {
				success: false,
				error: `Skill "${ metadata.name }" is already installed`,
			};
		}

		await ensureSkillsDirectory( sitePath );

		const localSkillPath = getSkillPath( sitePath, metadata.name );
		await downloadDirectory( repo, skillPath, localSkillPath, branch );

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

		return { success: true, skill };
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		console.error( `Failed to install skill from ${ repo }/${ skillPath }:`, error );
		return { success: false, error: `Failed to install skill: ${ errorMessage }` };
	}
}

export async function removeSkill( sitePath: string, skillName: string ): Promise< void > {
	if ( ! ( await skillExists( sitePath, skillName ) ) ) {
		throw new Error( `Skill "${ skillName }" is not installed` );
	}

	await fs.rm( getSkillPath( sitePath, skillName ), { recursive: true, force: true } );
}

export async function listAvailableSkills(
	repo: string = DEFAULT_SKILLS_REPO,
	branch: string = DEFAULT_BRANCH
): Promise< AvailableSkill[] > {
	let entries;
	try {
		entries = await listGitHubDirectory( repo, 'skills', branch );
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		throw new Error(
			`Could not access skills in ${ repo }. ${ errorMessage }. Make sure the repository exists and has a "skills/" directory.`
		);
	}

	const availableSkills: AvailableSkill[] = [];

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
			console.warn( `Failed to parse skill at ${ entry.path }:`, skillError );
		}
	}

	return availableSkills;
}
