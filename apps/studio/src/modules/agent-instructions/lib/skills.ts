import fs from 'fs/promises';
import nodePath from 'path';
import { installSkillsToSite, installSkillToSite } from '@studio/common/lib/agent-skills';
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

export async function installAllSkills(
	sitePath: string,
	overwrite: boolean = false
): Promise< void > {
	await installSkillsToSite( sitePath, getBundledSkillsPath(), overwrite );
}

export async function installSkillById(
	sitePath: string,
	skillId: string,
	overwrite: boolean = false
): Promise< void > {
	await installSkillToSite( sitePath, getBundledSkillsPath(), skillId, overwrite );
}
