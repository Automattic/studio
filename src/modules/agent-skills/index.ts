/**
 * AgentSkills module - Renderer-safe exports.
 *
 * This file exports only renderer-compatible code (hooks, components, types).
 * For main process code (Node.js functions), import from './main' instead.
 */

// React hooks (renderer-safe, use IPC)
export { useSiteSkills, useAvailableSkills, useInstallSkill } from './hooks/use-site-skills';

// React components (renderer-safe)
export { SkillsPanel } from './components/skills-panel';

// Type exports (renderer-safe)
export type {
	Skill,
	SkillMetadata,
	SkillInstallSource,
	InstalledSkill,
	SkillInstallResult,
	AvailableSkill,
} from './types';

// Constants (renderer-safe, no Node.js dependencies)
export {
	SKILLS_DIRECTORY_PATH,
	SKILL_FILE_NAME,
	DEFAULT_SKILLS_REPO,
	DEFAULT_BRANCH,
} from './lib/constants';
