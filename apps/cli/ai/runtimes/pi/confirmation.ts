import type { AskUserHandler, AskUserQuestion } from 'cli/ai/types';

// The harness asks the user before calls that need their yes, so the agent
// cannot skip the question and needs no rule telling it to ask. Calls that
// delete or replace the user's work in a way WordPress cannot undo (no trash,
// no revision) are described here; site-pin.ts describes changes to a site
// other than the request's.

export interface Confirmation {
	question: string;
	consequence: string;
	/** What follows from No, where it is more than nothing changing. */
	declined?: string;
}

const CONFIRM = 'Yes, go ahead';
const DECLINE = 'No';

function stringArg( params: unknown, key: string ): string {
	const value = ( params as Record< string, unknown > | undefined )?.[ key ];
	return typeof value === 'string' || typeof value === 'number' ? String( value ) : '';
}

export function describeDestructiveCall(
	toolName: string,
	params: unknown
): Confirmation | undefined {
	const site = stringArg( params, 'nameOrPath' );
	const remote = stringArg( params, 'remoteSite' );
	switch ( toolName ) {
		case 'site_push':
			return {
				question: `Push the local site "${ site }" to ${ remote }?`,
				consequence: `Replaces ${ remote }'s ${
					stringArg( params, 'options' ) || 'all'
				} content with the local site's.`,
			};
		case 'site_pull':
			return {
				question: `Pull ${ remote } into the local site "${ site }"?`,
				consequence: `Replaces the local site's ${
					stringArg( params, 'options' ) || 'all'
				} content with ${ remote }'s.`,
			};
		case 'site_delete':
			return {
				question: `Delete the site "${ site }"?`,
				consequence:
					( params as { deleteFiles?: boolean } )?.deleteFiles === false
						? 'Removes it from Studio and keeps its files.'
						: 'Removes it from Studio and moves its files to the Trash.',
			};
		case 'site_import': {
			const file = stringArg( params, 'importFile' );
			// A WordPress export (WXR) adds content; every other format replaces it.
			if ( /\.xml$/i.test( file ) ) {
				return undefined;
			}
			return {
				question: `Import ${ file } into "${ site }"?`,
				consequence: "Replaces the site's database and files with the backup's.",
			};
		}
		case 'preview_delete':
			return {
				question: `Delete the preview site ${ stringArg( params, 'host' ) }?`,
				consequence: 'Deletes it from WordPress.com.',
			};
		default:
			return undefined;
	}
}

// Returns why the call did not run, or undefined once the user confirms (or
// nothing needs confirming). Questions are asked one at a time.
export type Confirmer = ( call: Confirmation | undefined ) => Promise< string | undefined >;

export function createConfirmer( onAskUser: AskUserHandler | undefined ): Confirmer {
	let queue: Promise< unknown > = Promise.resolve();
	return async ( call ) => {
		if ( ! call ) {
			return undefined;
		}
		const then = call.declined ? ` ${ call.declined }` : '';
		if ( ! onAskUser ) {
			return `Not run: ${ call.question } needs the user's confirmation, and this session cannot ask for it.${ then }`;
		}
		const question: AskUserQuestion = {
			question: call.question,
			options: [
				{ label: CONFIRM, description: call.consequence },
				{ label: DECLINE, description: call.declined ?? 'Nothing changes.' },
			],
			allowFreeForm: false,
		};
		const answer = queue.then( () => onAskUser( [ question ] ) );
		queue = answer.catch( () => undefined );
		const answers = await answer;
		return answers[ call.question ] === CONFIRM
			? undefined
			: `Not run: the user answered "${ answers[ call.question ] ?? DECLINE }" to: ${
					call.question
			  }${ then }`;
	};
}
