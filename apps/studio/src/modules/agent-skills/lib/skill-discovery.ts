import fs from 'fs/promises';
import nodePath from 'path';
import { SKILLS_DIRECTORY_PATH, SKILL_FILE_NAME } from './constants';
import { parseSkillFile } from './skill-parser';
import type { Skill } from '../types';

export function getSkillsPath( sitePath: string ): string {
	return nodePath.join( sitePath, SKILLS_DIRECTORY_PATH );
}

export function getSkillPath( sitePath: string, skillName: string ): string {
	return nodePath.join( getSkillsPath( sitePath ), skillName );
}

export async function skillExists( sitePath: string, skillName: string ): Promise< boolean > {
	const skillFilePath = nodePath.join( getSkillPath( sitePath, skillName ), SKILL_FILE_NAME );
	try {
		await fs.access( skillFilePath );
		return true;
	} catch {
		return false;
	}
}

async function hasSubdirectory( dirPath: string, subdirName: string ): Promise< boolean > {
	try {
		const stat = await fs.stat( nodePath.join( dirPath, subdirName ) );
		return stat.isDirectory();
	} catch {
		return false;
	}
}

async function parseSkillFromDirectory( skillDirPath: string ): Promise< Skill | null > {
	const skillFilePath = nodePath.join( skillDirPath, SKILL_FILE_NAME );
	try {
		const content = await fs.readFile( skillFilePath, 'utf-8' );
		const { metadata, body } = parseSkillFile( content );

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

export async function discoverSiteSkills( sitePath: string ): Promise< Skill[] > {
	const skillsPath = getSkillsPath( sitePath );

	try {
		const entries = await fs.readdir( skillsPath, { withFileTypes: true } );
		const skills: Skill[] = [];

		for ( const entry of entries ) {
			if ( ! entry.isDirectory() || entry.name.startsWith( '.' ) ) {
				continue;
			}

			const skill = await parseSkillFromDirectory( nodePath.join( skillsPath, entry.name ) );
			if ( skill ) {
				skills.push( skill );
			}
		}

		skills.sort( ( a, b ) => a.name.localeCompare( b.name ) );
		return skills;
	} catch ( error ) {
		if ( ( error as NodeJS.ErrnoException ).code === 'ENOENT' ) {
			return [];
		}
		console.error( `Failed to discover skills at ${ skillsPath }:`, error );
		return [];
	}
}

export async function ensureSkillsDirectory( sitePath: string ): Promise< string > {
	const skillsPath = getSkillsPath( sitePath );
	try {
		await fs.mkdir( skillsPath, { recursive: true } );
	} catch ( error ) {
		if ( ( error as NodeJS.ErrnoException ).code !== 'EEXIST' ) {
			throw error;
		}
	}
	return skillsPath;
}
