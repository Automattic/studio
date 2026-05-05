import fs from 'fs';
import path from 'path';

/**
 * A skill parsed from the plugin directory. The frontmatter is YAML-ish but we
 * only extract `name` and `description` — everything else we need (workflow,
 * constraints) lives in the body and is loaded on demand by the runtime's
 * Skill tool. Keep the parser deliberately minimal so we don't pull in a YAML
 * dependency for this one narrow use case.
 */
export interface Skill {
	name: string;
	description: string;
	body: string;
}

function parseSkillFile( filePath: string ): Skill | null {
	const contents = fs.readFileSync( filePath, 'utf-8' );
	const match = contents.match( /^---\n([\s\S]*?)\n---\n([\s\S]*)$/ );
	if ( ! match ) return null;
	const [ , frontmatter, body ] = match;

	const name = frontmatter.match( /^name:\s*(.+)$/m )?.[ 1 ]?.trim();
	const description = frontmatter.match( /^description:\s*(.+)$/m )?.[ 1 ]?.trim();
	if ( ! name || ! description ) return null;

	return { name, description, body: body.trim() };
}

let cachedSkills: Skill[] | null = null;

/**
 * Discover all `SKILL.md` files under the bundled plugin directory.
 *
 * The plugin directory is the same one the Anthropic runtime hands to the
 * Agent SDK as a `type: 'local'` plugin. The Anthropic runtime relies on the
 * SDK's built-in skill machinery (frontmatter goes into the prompt index, the
 * body is fetched via the SDK's native `Skill` tool). The OpenAI runtime
 * doesn't have an SDK to lean on, so it consumes these parsed entries
 * directly: a short index goes into the system prompt, and a hand-rolled
 * `Skill` tool returns the body on demand.
 *
 * Results are cached on the first call — skills never change at runtime.
 */
export function loadSkills(): Skill[] {
	if ( cachedSkills ) return cachedSkills;

	const pluginRoot = path.resolve( import.meta.dirname, 'plugin' );
	const skillsRoot = path.join( pluginRoot, 'skills' );

	if ( ! fs.existsSync( skillsRoot ) ) {
		cachedSkills = [];
		return cachedSkills;
	}

	const skills: Skill[] = [];
	for ( const entry of fs.readdirSync( skillsRoot, { withFileTypes: true } ) ) {
		if ( ! entry.isDirectory() ) continue;
		const skillPath = path.join( skillsRoot, entry.name, 'SKILL.md' );
		if ( ! fs.existsSync( skillPath ) ) continue;
		const skill = parseSkillFile( skillPath );
		if ( skill ) skills.push( skill );
	}
	cachedSkills = skills;
	return skills;
}

export function findSkill( name: string ): Skill | undefined {
	return loadSkills().find( ( skill ) => skill.name === name );
}
