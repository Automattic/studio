import { readFileSync } from 'fs';
import { closedWithoutAnswering } from 'cli/ai/tools/ask-user-question';
import type { AskUserHandler, AskUserQuestion } from 'cli/ai/types';

// The harness asks the user before calls that need their yes, so the agent
// cannot skip the question and needs no rule telling it to ask. Calls that
// delete or replace the user's work in a way WordPress cannot undo (no trash,
// no revision), or that change a whole site's content at once, are described
// here; site-pin.ts describes changes to a site other than the request's.

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

// How many entries a JSON array file lists, when it can be read.
function entries( file: string | undefined ): number | undefined {
	try {
		const list: unknown = file && JSON.parse( readFileSync( file, 'utf8' ) );
		return Array.isArray( list ) ? list.length : undefined;
	} catch {
		return undefined;
	}
}

// The taxonomist skill's apply-changes.php in apply mode, run with `wp eval-file`
// from a shell or wp_cli: it saves the plan's categories and sets every
// suggested post's. Its preview (the default mode) changes nothing.
function describeCategoryPlan( command: string ): Confirmation | undefined {
	const arg = ( key: string ) =>
		command.match( new RegExp( `(?:^|\\s)${ key }=["']?([^\\s"']+)` ) )?.[ 1 ];
	if ( ! /\bapply-changes\.php\b/.test( command ) || arg( 'mode' ) !== 'apply' ) {
		return undefined;
	}
	const plural = ( count: number, one: string, many: string ) =>
		`${ count } ${ count === 1 ? one : many }`;
	const posts = entries( arg( 'suggestions' ) );
	const categories = entries( arg( 'categories' ) );
	const postsSet = `the categories of ${
		posts === undefined ? 'every post in the plan' : plural( posts, 'post', 'posts' )
	}`;
	return {
		question: 'Apply the category plan?',
		consequence: `${
			categories
				? `Creates or updates ${ plural(
						categories,
						'category',
						'categories'
				  ) }, and sets ${ postsSet }`
				: `Sets ${ postsSet }`
		}, logging each change. The backup taken before the analysis restores them.`,
		declined: 'Ask the user what to change in the plan, then preview it again.',
	};
}

export function describeDestructiveCall(
	toolName: string,
	params: unknown
): Confirmation | undefined {
	const site = stringArg( params, 'nameOrPath' );
	const remote = stringArg( params, 'remoteSite' );
	const command = stringArg( params, 'command' );
	if ( command ) {
		return describeCategoryPlan( command );
	}
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

/** Why a call did not run; a question the user closed without answering ends the turn. */
export interface Refusal {
	text: string;
	endsTurn?: boolean;
}

// Returns why the call did not run, or undefined once the user confirms (or
// nothing needs confirming). Questions are asked one at a time.
export type Confirmer = ( call: Confirmation | undefined ) => Promise< Refusal | undefined >;

export function createConfirmer( onAskUser: AskUserHandler | undefined ): Confirmer {
	let queue: Promise< unknown > = Promise.resolve();
	return async ( call ) => {
		if ( ! call ) {
			return undefined;
		}
		const then = call.declined ? ` ${ call.declined }` : '';
		if ( ! onAskUser ) {
			return {
				text: `Not run: ${ call.question } needs the user's confirmation, and this session cannot ask for it.${ then }`,
			};
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
		const given = ( await answer )[ call.question ]?.trim();
		if ( ! given ) {
			return { text: `Not run: ${ closedWithoutAnswering( [ call.question ] ) }`, endsTurn: true };
		}
		return given === CONFIRM
			? undefined
			: { text: `Not run: the user answered "${ given }" to: ${ call.question }${ then }` };
	};
}
