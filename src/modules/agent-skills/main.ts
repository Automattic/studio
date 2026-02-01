/**
 * AgentSkills module - Main process exports.
 *
 * This file exports Node.js-dependent code for use in the main process only.
 * For renderer code, import from './index' instead.
 */

// Core functionality (requires Node.js fs/path)
export {
	getSkillsPath,
	getSkillPath,
	skillExists,
	discoverSiteSkills,
	getSkillByName,
	ensureSkillsDirectory,
} from './lib/skill-discovery';

export { parseSkillFile, validateSkillMetadata, extractSkillName } from './lib/skill-parser';

export { installSkillFromGitHub, removeSkill, listAvailableSkills } from './lib/skill-installer';

export { buildSkillsPromptXml, buildSkillsSummary } from './lib/skill-prompt-builder';

// Constants (also available from index.ts)
export {
	SKILLS_DIRECTORY_PATH,
	SKILL_FILE_NAME,
	DEFAULT_SKILLS_REPO,
	DEFAULT_BRANCH,
} from './lib/constants';

// Type exports
export type {
	Skill,
	SkillMetadata,
	SkillInstallSource,
	InstalledSkill,
	SkillInstallResult,
	AvailableSkill,
} from './types';
