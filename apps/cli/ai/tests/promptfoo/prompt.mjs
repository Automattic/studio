import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt } from '../../system-prompt.ts';

const thisDir = path.dirname( fileURLToPath( import.meta.url ) );
const skillsDir = path.resolve( thisDir, '..', '..', 'plugin', 'skills' );

function loadSkill( name ) {
	const p = path.join( skillsDir, name, 'SKILL.md' );
	if ( ! existsSync( p ) ) {
		return null;
	}
	return readFileSync( p, 'utf8' );
}

function loadAllSkills() {
	if ( ! existsSync( skillsDir ) ) {
		return '';
	}
	const parts = [];
	for ( const entry of readdirSync( skillsDir, { withFileTypes: true } ) ) {
		if ( ! entry.isDirectory() ) {
			continue;
		}
		const content = loadSkill( entry.name );
		if ( content ) {
			parts.push( `# Skill: ${ entry.name }\n\n${ content }` );
		}
	}
	return parts.join( '\n\n---\n\n' );
}

const SKILLS_NOTE =
	'# Skills context\n\nThe agent can invoke skills on demand. For these single-turn tests the relevant skill contents are appended below so the model has the same information it would have during a real build turn after a skill has been invoked.';

const systemPrompt = [ buildSystemPrompt(), SKILLS_NOTE, loadAllSkills() ]
	.filter( Boolean )
	.join( '\n\n---\n\n' );

export default async function promptFn( { vars } ) {
	const userPrompt = vars.userPrompt;
	if ( ! userPrompt ) {
		throw new Error( 'Each test must set vars.userPrompt' );
	}
	return JSON.stringify( [
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: String( userPrompt ) },
	] );
}
