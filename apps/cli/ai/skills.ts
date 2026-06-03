import fs from 'fs';
import path from 'path';

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

// A skill body is authored harness-agnostically (no tool names) so it can be
// shared across agent surfaces. The Studio-specific mapping of each capability
// to a concrete tool lives in `skill-overlays/<name>.md`; append it here at load
// time so the skill body itself stays portable. Skills with no overlay load
// unchanged. See `skill-overlays/README.md`.
function applyStudioOverlay( skill: Skill, overlaysRoot: string ): Skill {
	const overlayPath = path.join( overlaysRoot, `${ skill.name }.md` );
	if ( ! fs.existsSync( overlayPath ) ) {
		return skill;
	}
	const overlay = fs.readFileSync( overlayPath, 'utf-8' ).trim();
	if ( ! overlay ) {
		return skill;
	}
	return { ...skill, body: `${ skill.body }\n\n## In Studio\n\n${ overlay }` };
}

// Discovers `apps/cli/ai/skills/<name>/SKILL.md` files at startup; cached
// for the process lifetime since skills never change at runtime.
export function loadSkills(): Skill[] {
	if ( cachedSkills ) return cachedSkills;

	const skillsRoot = path.resolve( import.meta.dirname, 'skills' );
	const overlaysRoot = path.resolve( import.meta.dirname, 'skill-overlays' );

	if ( ! fs.existsSync( skillsRoot ) ) {
		// Loud warning so a broken bundle path doesn't silently disable Skill.
		console.warn(
			`[skills] skills directory not found at ${ skillsRoot } — Skill tool will be unavailable.`
		);
		cachedSkills = [];
		return cachedSkills;
	}

	const skills: Skill[] = [];
	for ( const entry of fs.readdirSync( skillsRoot, { withFileTypes: true } ) ) {
		if ( ! entry.isDirectory() ) continue;
		const skillPath = path.join( skillsRoot, entry.name, 'SKILL.md' );
		if ( ! fs.existsSync( skillPath ) ) continue;
		const skill = parseSkillFile( skillPath );
		if ( skill ) skills.push( applyStudioOverlay( skill, overlaysRoot ) );
	}
	cachedSkills = skills;
	return skills;
}

export function findSkill( name: string ): Skill | undefined {
	return loadSkills().find( ( skill ) => skill.name === name );
}
