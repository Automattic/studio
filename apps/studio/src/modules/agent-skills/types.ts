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

/**
 * Result of a skill installation attempt.
 */
export interface SkillInstallResult {
	success: boolean;
	error?: string;
	skill?: Skill;
}
