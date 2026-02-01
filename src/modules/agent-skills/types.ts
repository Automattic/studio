/**
 * Types for AgentSkills module.
 *
 * AgentSkills are AI agent instructions that can be installed per-site
 * to provide specialized capabilities and knowledge.
 */

/**
 * Metadata extracted from a SKILL.md file's YAML frontmatter.
 */
export interface SkillMetadata {
	/** Required: skill identifier/name */
	name: string;
	/** Required: what the skill does */
	description: string;
	/** Optional: license (e.g., "MIT", "Apache-2.0") */
	license?: string;
	/** Optional: compatibility notes (e.g., "WordPress 6.0+") */
	compatibility?: string;
	/** Optional: additional metadata key-value pairs */
	metadata?: Record< string, string >;
	/** Optional: tools the skill is allowed to use */
	allowedTools?: string[];
}

/**
 * A fully parsed skill including metadata and content.
 */
export interface Skill extends SkillMetadata {
	/** Absolute path to the skill directory */
	path: string;
	/** Markdown content after the YAML frontmatter */
	body: string;
	/** Whether the skill has a scripts/ directory */
	hasScripts: boolean;
	/** Whether the skill has a references/ directory */
	hasReferences: boolean;
	/** Whether the skill has an assets/ directory */
	hasAssets: boolean;
}

/**
 * Source information for installing a skill from GitHub.
 */
export interface SkillInstallSource {
	type: 'github';
	/** Repository in format "owner/repo" (e.g., "WordPress/agent-skills") */
	repo: string;
	/** Path within the repo to the skill (e.g., "skills/wordpress") */
	skillPath: string;
	/** Branch to install from (default: "main") */
	branch?: string;
}

/**
 * Record of an installed skill for tracking purposes.
 */
export interface InstalledSkill {
	/** Skill name */
	name: string;
	/** Unix timestamp when the skill was installed */
	installedAt: number;
	/** Where the skill was installed from */
	source: SkillInstallSource;
}

/**
 * Result of a skill installation attempt.
 */
export interface SkillInstallResult {
	success: boolean;
	error?: string;
	skill?: Skill;
}

/**
 * Information about a skill available for installation from a repository.
 */
export interface AvailableSkill {
	/** Skill name */
	name: string;
	/** Skill description */
	description: string;
	/** Path within the repository */
	path: string;
}
