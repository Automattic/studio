import type { AskUserHandler, AskUserQuestion } from 'cli/ai/types';

// The harness asks the user before calls that need their yes, so the agent
// cannot skip the question and needs no rule telling it to ask. Calls that
// delete or replace the user's work in a way WordPress cannot undo (no trash,
// no revision) are described here; site-pin.ts describes changes to a site
// other than the request's.

export interface Confirmation {
	question: string;
	consequence: string;
}

const CONFIRM = 'Yes, go ahead';
const DECLINE = 'No';

// WP-CLI commands that permanently delete or rewrite site data. `post delete`
// and `comment delete` go to the trash unless forced.
const IRREVERSIBLE_WP_CLI: RegExp[] = [
	/^db\s+(reset|drop|clean|import)\b/,
	/^site\s+(empty|delete)\b/,
	/^(plugin|theme)\s+(delete|uninstall)\b/,
	/^(user|term|menu|option|widget)\s+delete\b/,
	/^(post|comment)\s+delete\b.*\s--force\b/,
	/^search-replace\b(?!.*\s--dry-run\b)/,
];

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
		case 'wpcom_request':
			if ( stringArg( params, 'method' ) !== 'DELETE' ) {
				return undefined;
			}
			return {
				question: `Send DELETE ${ stringArg( params, 'path' ) } to WordPress.com site ${ stringArg(
					params,
					'siteId'
				) }?`,
				consequence: 'Deletes it on the live site.',
			};
		case 'wp_cli': {
			const command = stringArg( params, 'command' )
				.trim()
				.replace( /^wp\s+/, '' );
			if ( ! IRREVERSIBLE_WP_CLI.some( ( pattern ) => pattern.test( command ) ) ) {
				return undefined;
			}
			return {
				question: `Run "wp ${ command }" on "${ site }"?`,
				consequence: 'Deletes or rewrites site data that cannot be restored from the trash.',
			};
		}
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
		if ( ! onAskUser ) {
			return `Not run: ${ call.question } needs the user's confirmation, and this session cannot ask for it.`;
		}
		const question: AskUserQuestion = {
			question: call.question,
			options: [
				{ label: CONFIRM, description: call.consequence },
				{ label: DECLINE, description: 'Nothing changes.' },
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
			  }`;
	};
}
