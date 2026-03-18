import fs from 'fs/promises';
import nodePath from 'path';
import { installSkillToSite } from '@studio/common/lib/agent-skills';
import { getAiInstructionsPath } from 'src/lib/server-files-paths';
import { BUNDLED_SKILLS, type SkillStatus } from './skills-constants';

export { BUNDLED_SKILLS, type SkillConfig, type SkillStatus } from './skills-constants';

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

export async function installAllSkills(
	sitePath: string,
	overwrite: boolean = false
): Promise< void > {
	const bundledPath = getAiInstructionsPath();
	for ( const skill of BUNDLED_SKILLS ) {
		try {
			await installSkillToSite( sitePath, bundledPath, skill.id, overwrite );
		} catch {
			console.error( `[ai-skills] Failed to install ${ skill.id }` );
		}
	}
}
