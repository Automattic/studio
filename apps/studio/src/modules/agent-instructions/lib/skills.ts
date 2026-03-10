import fs from 'fs/promises';
import nodePath from 'path';
import { getAgentSkillsPath } from 'src/lib/server-files-paths';
import { BUNDLED_SKILLS, type SkillStatus } from './skills-constants';

export { BUNDLED_SKILLS, type SkillConfig, type SkillStatus } from './skills-constants';

export function getBundledSkillsPath(): string {
	return getAgentSkillsPath();
}

export async function getSkillsStatus( sitePath: string ): Promise< SkillStatus[] > {
	return Promise.all(
		BUNDLED_SKILLS.map( async ( skill ) => {
			const skillMdPath = nodePath.join( sitePath, '.agents', 'skills', skill.id, 'SKILL.md' );
			let installed = false;
			try {
				await fs.access( skillMdPath );
				installed = true;
			} catch {
				// Skill not installed or incomplete
			}
			return { ...skill, installed };
		} )
	);
}

async function copyDir( src: string, dest: string ): Promise< void > {
	await fs.mkdir( dest, { recursive: true } );
	const entries = await fs.readdir( src, { withFileTypes: true } );
	for ( const entry of entries ) {
		const srcPath = nodePath.join( src, entry.name );
		const destPath = nodePath.join( dest, entry.name );
		if ( entry.isDirectory() ) {
			await copyDir( srcPath, destPath );
		} else {
			await fs.copyFile( srcPath, destPath );
		}
	}
}

export async function installSkill(
	sitePath: string,
	skillId: string,
	overwrite: boolean = false
): Promise< void > {
	const bundledPath = nodePath.join( getBundledSkillsPath(), skillId );
	const agentsSkillPath = nodePath.join( sitePath, '.agents', 'skills', skillId );
	const claudeSkillPath = nodePath.join( sitePath, '.claude', 'skills', skillId );

	// Check if already installed by verifying SKILL.md exists
	if ( ! overwrite ) {
		try {
			await fs.access( nodePath.join( agentsSkillPath, 'SKILL.md' ) );
			return; // Already installed, skip
		} catch {
			// Not installed or incomplete, proceed
		}
	}

	// Copy skill files to .agents/skills/<skill-id>/
	if ( overwrite ) {
		await fs.rm( agentsSkillPath, { recursive: true, force: true } );
	}
	await copyDir( bundledPath, agentsSkillPath );

	// Create symlink at .claude/skills/<skill-id> → ../../.agents/skills/<skill-id>
	await fs.mkdir( nodePath.join( sitePath, '.claude', 'skills' ), { recursive: true } );
	const relativePath = nodePath.relative(
		nodePath.join( sitePath, '.claude', 'skills' ),
		agentsSkillPath
	);

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

export async function installAllSkills(
	sitePath: string,
	overwrite: boolean = false
): Promise< void > {
	for ( const skill of BUNDLED_SKILLS ) {
		try {
			await installSkill( sitePath, skill.id, overwrite );
		} catch {
			// Continue installing remaining skills if one fails
		}
	}
}
