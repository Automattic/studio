import nodePath from 'path';
import { installSkillToSite, removeSkillFromSite } from '@studio/common/lib/agent-skills';
import { pathExists } from '@studio/common/lib/fs-utils';
import { getAiInstructionsPath } from 'src/lib/server-files-paths';
import { getBundledSkills, type SkillStatus } from './skills-constants';

export { getBundledSkills, type SkillConfig, type SkillStatus } from './skills-constants';

export async function getSkillsStatus( sitePath: string ): Promise< SkillStatus[] > {
	return Promise.all(
		getBundledSkills().map( async ( skill ) => {
			const skillMdPath = nodePath.join( sitePath, '.agents', 'skills', skill.id, 'SKILL.md' );
			const installed = await pathExists( skillMdPath );
			return { ...skill, installed };
		} )
	);
}

export async function installAllSkills(
	sitePath: string,
	overwrite: boolean = false
): Promise< void > {
	const bundledPath = getAiInstructionsPath();
	const tasks = getBundledSkills().map( ( skill ) =>
		installSkillToSite( sitePath, bundledPath, skill.id, overwrite )
	);
	const results = await Promise.allSettled( tasks );
	for ( const result of results ) {
		if ( result.status === 'rejected' ) {
			console.error( '[ai-skills] Failed to install skill:', result.reason );
		}
	}
}

export async function installSkillById(
	sitePath: string,
	skillId: string,
	overwrite: boolean = false
): Promise< void > {
	await installSkillToSite( sitePath, getAiInstructionsPath(), skillId, overwrite );
}

export async function removeSkillById( sitePath: string, skillId: string ): Promise< void > {
	await removeSkillFromSite( sitePath, skillId );
}
