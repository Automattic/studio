// What a skill is made from, in a form or by an agent. Browser-safe.
export interface SkillDraft {
	// As the user typed it: "Lookbook post". The folder and command come from it.
	name: string;
	// When agents use the skill.
	description: string;
	// The steps the agent follows: the body of SKILL.md.
	instructions: string;
}

// A skill opened to change it.
export interface SkillDetails {
	id: string;
	displayName: string;
	description: string;
	instructions: string;
	// The files in the skill's folder, by their path from it. SKILL.md is first.
	files: string[];
}

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;
export const SKILL_INSTRUCTIONS_MAX_LENGTH = 20000;

// "Lookbook post" is saved in the folder `lookbook-post` and runs as `/lookbook-post`.
// Empty when the name has no letter or number the folder can hold.
export function getSkillId( name: string ): string {
	return name
		.normalize( 'NFKD' )
		.replace( /[̀-ͯ]/g, '' )
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' );
}

// "lookbook-post" reads as "Lookbook post".
export function getSkillDisplayName( id: string ): string {
	const words = id.replace( /-/g, ' ' );
	return words.charAt( 0 ).toUpperCase() + words.slice( 1 );
}

// The WordPress skills earlier Studio versions copied into a site (`getBundledSkills`). They
// guide agents; nobody runs them as a command, so the `/` menu leaves them out.
export const SHIPPED_SKILL_IDS = [
	'studio-cli',
	'wp-plugin-development',
	'wp-block-development',
	'wp-block-themes',
	'wp-rest-api',
	'wp-wpcli-and-ops',
];
