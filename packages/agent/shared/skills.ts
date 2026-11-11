/// <reference types="vite/client" />

export interface Skill {
	name: string;
	description: string;
	body: string;
	// A top-level skill: something users ask for directly (`user-invokable: true`),
	// as opposed to a runbook other skills load. Plugins expose these as their own skills.
	userInvokable: boolean;
	// Tools this skill brings (`tools: a, b`). A tool any skill declares is
	// available only once a skill that declares it is loaded.
	tools: string[];
	// The skill's folder, for a skill the user added: its body may name files beside it.
	folder?: string;
}

// Every file of every skill, by its path from here (`./skills/<name>/…`),
// bundled as text so the skills load the same in Node and in a browser.
const SKILL_FILES = import.meta.glob< string >( './skills/**/*.{md,php}', {
	query: '?raw',
	import: 'default',
	eager: true,
} );

export function parseSkillFile( contents: string ): Skill | null {
	const match = contents.match( /^---\n([\s\S]*?)\n---\n([\s\S]*)$/ );
	if ( ! match ) return null;
	const [ , frontmatter, body ] = match;

	const name = frontmatter.match( /^name:\s*(.+)$/m )?.[ 1 ]?.trim();
	const description = frontmatter.match( /^description:\s*(.+)$/m )?.[ 1 ]?.trim();
	if ( ! name || ! description ) return null;

	const userInvokable = /^user-invokable:\s*true\s*$/m.test( frontmatter );
	const tools = ( frontmatter.match( /^tools:\s*(.+)$/m )?.[ 1 ] ?? '' )
		.split( ',' )
		.map( ( tool ) => tool.trim() )
		.filter( Boolean );
	return { name, description, body: body.trim(), userInvokable, tools };
}

// The files in one folder of a skill, such as `skillFiles( 'taxonomist', 'scripts' )`,
// as [ name, contents ] pairs sorted by name.
export function skillFiles( skillName: string, folder: string ): [ string, string ][] {
	const prefix = `./skills/${ skillName }/${ folder }/`;
	return Object.entries( SKILL_FILES )
		.filter(
			( [ file ] ) => file.startsWith( prefix ) && ! file.slice( prefix.length ).includes( '/' )
		)
		.map( ( [ file, contents ] ): [ string, string ] => [ file.slice( prefix.length ), contents ] )
		.sort( ( [ a ], [ b ] ) => a.localeCompare( b ) );
}

let cachedSkills: Skill[] | null = null;

// The skills in `skills/<name>/SKILL.md`, in folder order.
export function loadSkills(): Skill[] {
	cachedSkills ??= Object.keys( SKILL_FILES )
		.filter( ( file ) => /^\.\/skills\/[^/]+\/SKILL\.md$/.test( file ) )
		.sort()
		.flatMap( ( file ) => parseSkillFile( SKILL_FILES[ file ] ) ?? [] );
	return cachedSkills;
}

interface SkillCatalog {
	skills: Skill[];
	// User skills left out because a Studio skill has the same name.
	shadowed: string[];
}

// Studio's skills, then `userSkills`, the user's own. A Studio skill keeps its name.
export function loadSkillCatalog( userSkills: Skill[] = [] ): SkillCatalog {
	const studio = loadSkills();
	const taken = new Set( studio.map( ( skill ) => skill.name ) );
	return {
		skills: [ ...studio, ...userSkills.filter( ( skill ) => ! taken.has( skill.name ) ) ],
		shadowed: userSkills
			.filter( ( skill ) => taken.has( skill.name ) )
			.map( ( skill ) => skill.folder ?? skill.name ),
	};
}

export function findSkill( name: string, userSkills: Skill[] = [] ): Skill | undefined {
	return loadSkillCatalog( userSkills ).skills.find( ( skill ) => skill.name === name );
}

// Every tool a Studio skill brings; these start inactive. A user skill can name
// one to bring it, and naming any other tool hides nothing.
export function getSkillScopedToolNames(): Set< string > {
	return new Set( loadSkills().flatMap( ( skill ) => skill.tools ) );
}
