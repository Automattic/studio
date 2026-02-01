/**
 * Prompt builder for integrating skills into AI agent system prompts.
 *
 * Generates XML-formatted skill information that can be injected into
 * the system prompt to make the AI agent aware of installed skills.
 */

import nodePath from 'path';
import { SKILL_FILE_NAME } from './skill-discovery';
import type { Skill } from '../types';

/**
 * Escape XML special characters in a string.
 *
 * @param str - String to escape
 * @returns Escaped string safe for XML
 */
function escapeXml( str: string ): string {
	return str
		.replace( /&/g, '&amp;' )
		.replace( /</g, '&lt;' )
		.replace( />/g, '&gt;' )
		.replace( /"/g, '&quot;' )
		.replace( /'/g, '&apos;' );
}

/**
 * Build XML representation of a single skill for the system prompt.
 *
 * @param skill - The skill to convert to XML
 * @returns XML string for the skill
 */
function buildSkillXml( skill: Skill ): string {
	const skillMdPath = nodePath.join( skill.path, SKILL_FILE_NAME );

	const lines = [
		'  <skill>',
		`    <name>${ escapeXml( skill.name ) }</name>`,
		`    <description>${ escapeXml( skill.description ) }</description>`,
		`    <location>${ escapeXml( skillMdPath ) }</location>`,
	];

	// Add optional fields if present
	if ( skill.allowedTools && skill.allowedTools.length > 0 ) {
		lines.push(
			`    <allowed_tools>${ escapeXml( skill.allowedTools.join( ', ' ) ) }</allowed_tools>`
		);
	}

	if ( skill.hasScripts ) {
		lines.push(
			`    <scripts_dir>${ escapeXml( nodePath.join( skill.path, 'scripts' ) ) }</scripts_dir>`
		);
	}

	if ( skill.hasReferences ) {
		lines.push(
			`    <references_dir>${ escapeXml(
				nodePath.join( skill.path, 'references' )
			) }</references_dir>`
		);
	}

	lines.push( '  </skill>' );

	return lines.join( '\n' );
}

/**
 * Build the complete XML block for all skills to include in the system prompt.
 *
 * @param skills - Array of skills to include
 * @returns XML string for all skills, or empty string if no skills
 */
export function buildSkillsPromptXml( skills: Skill[] ): string {
	if ( skills.length === 0 ) {
		return '';
	}

	const skillsXml = skills.map( buildSkillXml ).join( '\n' );

	return `<available_skills>
${ skillsXml }
</available_skills>

When a user's request matches a skill's description, read the skill's SKILL.md file at the location shown to get detailed instructions for that task. The SKILL.md contains step-by-step guidance and best practices that will help you complete the task effectively.`;
}

/**
 * Build a simple skills summary for display purposes (not for prompts).
 *
 * @param skills - Array of skills
 * @returns Human-readable summary of installed skills
 */
export function buildSkillsSummary( skills: Skill[] ): string {
	if ( skills.length === 0 ) {
		return 'No skills installed.';
	}

	const lines = [ `${ skills.length } skill${ skills.length > 1 ? 's' : '' } installed:` ];

	for ( const skill of skills ) {
		lines.push( `- ${ skill.name }: ${ skill.description }` );
	}

	return lines.join( '\n' );
}
