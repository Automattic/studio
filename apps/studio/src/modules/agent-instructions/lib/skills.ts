import { installSkillToSite, removeSkillFromSite } from '@studio/common/lib/agent-skills';
import { getBundledSkills } from '@studio/common/lib/agent-skills-catalog';
import { getAiInstructionsPath } from 'src/lib/server-files-paths';
import type { SiteRuntime } from '@studio/common/lib/site-runtime';

export {
	getBundledSkills,
	getSkillsStatus,
	type SkillConfig,
	type SkillStatus,
} from '@studio/common/lib/agent-skills-catalog';

export async function installAllSkills(
	site: { path: string; runtime?: SiteRuntime },
	overwrite: boolean = false
): Promise< void > {
	const bundledPath = getAiInstructionsPath();
	const tasks = getBundledSkills().map( ( skill ) =>
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
