import fs from 'fs';
import path from 'path';

/**
 * A skill parsed from the plugin directory. The frontmatter is YAML-ish but we
 * only extract `name` and `description` — everything else we need (workflow,
 * constraints) lives in the body and is injected verbatim into the system
 * prompt. Keep the parser deliberately minimal so we don't pull in a YAML
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

/**
 * Discovers all `SKILL.md` files under the Claude Code plugin directory. This
 * is the same directory the Anthropic runtime hands to the Agent SDK as a
 * `type: 'local'` plugin; for the OpenAI runtime we load the markdown bodies
 * directly and splice them into the system prompt.
 *
 * Results are cached on the first call — skills never change at runtime.
 */
let cachedSkills: Skill[] | null = null;

export function loadSkills(): Skill[] {
	if ( cachedSkills ) return cachedSkills;

	const pluginRoot = path.resolve( import.meta.dirname, '..', '..', 'plugin' );
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

/**
 * Skills that auto-apply as part of a normal workflow — their bodies are
 * spliced into the GPT system prompt so the model follows them at the right
 * point during a build. Today this is just \`site-spec\`: the multi-step
 * "gather name + layout before site_create" interaction.
 *
 * Every other skill in the plugin directory is "tool-shaped" — \`rank-me-up\`,
 * \`need-for-speed\`, \`taxonomist\` each map 1:1 to a Studio tool with a
 * sufficient description in the runtime tool list. They run only on explicit
 * user request, and we rely on the tool description (not the skill body) to
 * tell the model what they do. The Anthropic SDK gates these to slash-command
 * invocation; the OpenAI runtime has no equivalent gating, and GPT is eager
 * enough that putting "Run a performance audit" in the system prompt makes it
 * run one on every site build. So we omit them entirely from the appendix.
 *
 * Add a skill name here when (and only when) it's a workflow that the model
 * should auto-follow during normal usage, not a tool-shaped on-demand skill.
 */
const AUTO_APPLY_SKILLS = new Set( [ 'site-spec' ] );

/**
 * Renders auto-apply skills as an appendix to the system prompt. Returns the
 * empty string if no skills qualify so the caller can append unconditionally.
 */
export function buildSkillsAppendix(): string {
	const skills = loadSkills().filter( ( skill ) => AUTO_APPLY_SKILLS.has( skill.name ) );
	if ( ! skills.length ) return '';

	const sections = skills.map(
		( skill ) => `### ${ skill.name }\n\n_${ skill.description }_\n\n${ skill.body }`
	);

	return [
		'## Workflow skills',
		'',
		'The following skill is a runbook to follow at its trigger point during normal builds. Read it in full and follow its steps when its description matches what you are about to do.',
		'',
		sections.join( '\n\n---\n\n' ),
	].join( '\n' );
}
