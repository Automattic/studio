// Escalates destructive WP-CLI commands to a permission prompt. Gating every
// wp_cli call would make the agent unusable — it is the workhorse tool — so
// only commands that permanently modify or delete data prompt. False positives
// (a safe command that prompts) are acceptable; false negatives are not.

import type { ToolPermissionLevel } from '@studio/common/ai/tool-permissions';

// Subcommands that destroy or bulk-rewrite data, keyed by top-level command.
// `'*'` gates every use of the command.
const DESTRUCTIVE_SUBCOMMANDS: Record< string, '*' | ReadonlySet< string > > = {
	db: new Set( [ 'reset', 'drop', 'clean', 'import', 'query' ] ),
	site: new Set( [ 'empty', 'delete' ] ),
	plugin: new Set( [ 'delete', 'uninstall' ] ),
	theme: new Set( [ 'delete' ] ),
	user: new Set( [ 'delete' ] ),
	term: new Set( [ 'delete' ] ),
	option: new Set( [ 'delete' ] ),
	menu: new Set( [ 'delete' ] ),
	// Bulk rewrites of the whole database.
	'search-replace': '*',
	// Arbitrary PHP execution can do anything, including deletes.
	eval: '*',
	'eval-file': '*',
};

// `post delete` / `comment delete` default to the trash, which is recoverable
// inside WordPress and routine during site builds (e.g. removing the sample
// "Hello World" post). Only `--force` (permanent deletion) prompts.
const TRASH_AWARE_COMMANDS = new Set( [ 'post', 'comment' ] );

// Global WP-CLI flags that execute arbitrary PHP before the command runs.
const DANGEROUS_GLOBAL_FLAGS = [ '--exec', '--require' ];

export interface ParsedWpCliCommand {
	// Positional tokens: command, subcommand, then arguments.
	words: string[];
	// Flag tokens (`--force`, `--path=…`), in order.
	flags: string[];
}

// Rough whitespace tokenization — good enough for classification and for
// building confirmation copy. Quoted values with spaces split apart, but only
// flag values quote in practice and those are never positional words.
export function parseWpCliCommand( command: string ): ParsedWpCliCommand {
	const tokens = command.trim().split( /\s+/ );
	return {
		words: tokens.filter( ( token ) => token !== '' && ! token.startsWith( '-' ) ),
		flags: tokens.filter( ( token ) => token.startsWith( '-' ) ),
	};
}

export function classifyWpCliCommand( command: string ): ToolPermissionLevel {
	const { words, flags } = parseWpCliCommand( command );

	if (
		flags.some( ( flag ) =>
			DANGEROUS_GLOBAL_FLAGS.some(
				( dangerous ) => flag === dangerous || flag.startsWith( `${ dangerous }=` )
			)
		)
	) {
		return 'ask';
	}

	const [ commandName, subcommand ] = words;
	if ( ! commandName ) {
		return 'ask';
	}

	if ( TRASH_AWARE_COMMANDS.has( commandName ) && subcommand === 'delete' ) {
		return flags.includes( '--force' ) ? 'ask' : 'allow';
	}

	const destructive = DESTRUCTIVE_SUBCOMMANDS[ commandName ];
	if ( destructive === '*' ) {
		return 'ask';
	}
	if ( destructive && subcommand && destructive.has( subcommand ) ) {
		return 'ask';
	}

	return 'allow';
}
