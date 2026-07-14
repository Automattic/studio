import nodePath from 'path';
import { installSkillToSite, removeSkillFromSite } from '@studio/common/lib/agent-skills';
import { pathExists } from '@studio/common/lib/fs-utils';
import { getAiInstructionsPath } from 'src/lib/server-files-paths';
import { BUNDLED_SKILLS, type SkillStatus } from './skills-constants';
import type { SiteRuntime } from '@studio/common/lib/site-runtime';

export { BUNDLED_SKILLS, type SkillConfig, type SkillStatus } from './skills-constants';

export async function getSkillsStatus( sitePath: string ): Promise< SkillStatus[] > {
	return Promise.all(
		BUNDLED_SKILLS.map( async ( skill ) => {
			const skillMdPath = nodePath.join( sitePath, '.agents', 'skills', skill.id, 'SKILL.md' );
			const installed = await pathExists( skillMdPath );
			return { ...skill, installed };
		} )
	);
}

export async function installAllSkills(
	site: { path: string; runtime?: SiteRuntime },
	overwrite: boolean = false
): Promise< void > {
	const bundledPath = getAiInstructionsPath();
	const tasks = BUNDLED_SKILLS.map( ( skill ) =>
		installSkillToSite( site, bundledPath, skill.id, overwrite )
	);
	const results = await Promise.allSettled( tasks );
	for ( const result of results ) {
		if ( result.status === 'rejected' ) {
			console.error( '[ai-skills] Failed to install skill:', result.reason );
		}
	}
}

export async function installSkillById(
	site: { path: string; runtime?: SiteRuntime },
	skillId: string,
	overwrite: boolean = false
): Promise< void > {
	await installSkillToSite( site, getAiInstructionsPath(), skillId, overwrite );
}

export async function removeSkillById( sitePath: string, skillId: string ): Promise< void > {
	await removeSkillFromSite( sitePath, skillId );
}
