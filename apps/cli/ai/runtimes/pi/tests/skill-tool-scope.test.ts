import { SessionManager } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { SkillToolScope } from '../skill-tool-scope';

const ALL = [
	'Read',
	'wp_cli',
	'scaffold_theme',
	'pick_design',
	'install_taxonomy_scripts',
	'need_for_speed',
];

function sessionWithSkillCall( skill?: string ): SessionManager {
	const session = SessionManager.inMemory();
	if ( skill ) {
		session.appendMessage( {
			role: 'assistant',
			content: [ { type: 'toolCall', id: 't1', name: 'Skill', arguments: { name: skill } } ],
			api: 'anthropic-messages',
			provider: 'anthropic',
			model: 'x',
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: 'toolUse',
			timestamp: 0,
		} );
	}
	return session;
}

describe( 'SkillToolScope', () => {
	it( 'keeps the tools skills bring out until a skill brings them', () => {
		const scope = new SkillToolScope( sessionWithSkillCall() );
		expect( scope.activeToolNames( ALL ) ).toEqual( [ 'Read', 'wp_cli' ] );
		scope.unlock( 'visual-design' );
		expect( scope.activeToolNames( ALL ) ).toEqual( [
			'Read',
			'wp_cli',
			'scaffold_theme',
			'pick_design',
		] );
	} );

	it( 'restores tools from skills loaded earlier in the conversation', () => {
		const scope = new SkillToolScope( sessionWithSkillCall( 'taxonomist' ) );
		expect( scope.activeToolNames( ALL ) ).toContain( 'install_taxonomy_scripts' );
		expect( scope.activeToolNames( ALL ) ).not.toContain( 'need_for_speed' );
	} );
} );
