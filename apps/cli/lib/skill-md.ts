import fs from 'fs';
import path from 'path';
import { AI_INSTRUCTIONS_MANIFEST } from '@studio/common/ai-instructions';

const SKILL_DIR = path.join( '.agents', 'skills', 'studio-cli' );
const SKILL_MD_FILENAME = 'SKILL.md';
const CLAUDE_SKILLS_DIR = path.join( '.claude', 'skills' );
const SYMLINK_NAME = 'studio-cli';

const SKILL_MD_TEMPLATE = AI_INSTRUCTIONS_MANIFEST.skills.find(
	( s ) => s.id === 'studio-cli'
)!.content;

/**
 * Writes the default SKILL.md file to `.agents/skills/studio-cli/SKILL.md` within the
 * site directory and creates a `.claude/skills/studio-cli` symlink pointing to it.
 *
 * Skips writing if the SKILL.md already exists so user-customised files are preserved.
 * Skips creating the symlink if it already exists.
 */
export async function writeSkillMd( sitePath: string ): Promise< void > {
	const skillDirPath = path.join( sitePath, SKILL_DIR );
	const skillMdPath = path.join( skillDirPath, SKILL_MD_FILENAME );
	const claudeSkillsPath = path.join( sitePath, CLAUDE_SKILLS_DIR );
	const symlinkPath = path.join( claudeSkillsPath, SYMLINK_NAME );

	const skillMdExists = fs.existsSync( skillMdPath );
	const symlinkExists = fs.existsSync( symlinkPath );

	if ( skillMdExists && symlinkExists ) {
		return;
	}

	if ( ! skillMdExists ) {
		await fs.promises.mkdir( skillDirPath, { recursive: true } );
		await fs.promises.writeFile( skillMdPath, SKILL_MD_TEMPLATE, 'utf-8' );
	}

	if ( ! symlinkExists ) {
		await fs.promises.mkdir( claudeSkillsPath, { recursive: true } );
		const relativeTarget = path.relative( claudeSkillsPath, skillDirPath );
		await fs.promises.symlink( relativeTarget, symlinkPath );
	}
}
