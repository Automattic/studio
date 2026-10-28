import { findSkill, getSkillScopedToolNames } from '@studio/agent/node/skills';
import type { SessionManager } from '@earendil-works/pi-coding-agent';

// Tools a skill brings stay out of the model's tool list until that skill is
// loaded in the conversation. A skill loaded in an earlier turn keeps its
// tools: each turn rebuilds the scope from the session's Skill calls.
export class SkillToolScope {
	private readonly scoped = getSkillScopedToolNames();
	private readonly unlocked = new Set< string >();

	constructor( session: SessionManager ) {
		for ( const message of session.buildSessionContext().messages ) {
			if ( message.role !== 'assistant' ) continue;
			for ( const part of message.content ) {
				if ( part.type === 'toolCall' && part.name === 'Skill' ) {
					this.unlock( String( part.arguments?.name ?? '' ) );
				}
			}
		}
	}

	unlock( skillName: string ): void {
		for ( const tool of findSkill( skillName )?.tools ?? [] ) {
			this.unlocked.add( tool );
		}
	}

	activeToolNames( allToolNames: string[] ): string[] {
		return allToolNames.filter(
			( name ) => ! this.scoped.has( name ) || this.unlocked.has( name )
		);
	}
}
