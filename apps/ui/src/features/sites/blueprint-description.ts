import { __, _n, sprintf } from '@wordpress/i18n';
import type { Blueprint } from '@studio/blueprints';
import type { StepDefinition } from '@wp-playground/blueprints';

/**
 * Joins a list of items with commas and "and" for the last item.
 * e.g. ["a", "b", "c"] → "a, b, and c"
 */
function joinWithAnd( items: string[] ): string {
	if ( items.length === 0 ) {
		return '';
	}
	if ( items.length === 1 ) {
		return items[ 0 ];
	}
	if ( items.length === 2 ) {
		return sprintf(
			/* translators: Used to join two items, e.g. "3 plugins and 2 themes". %1$s is the first item, %2$s is the second item. */
			__( '%1$s and %2$s' ),
			items[ 0 ],
			items[ 1 ]
		);
	}
	const allButLast = items.slice( 0, -1 ).join( ', ' );
	return sprintf(
		/* translators: Used to join a comma-separated list with "and" before the last item. %1$s is the comma-separated items, %2$s is the last item. */
		__( '%1$s, and %2$s' ),
		allButLast,
		items[ items.length - 1 ]
	);
}

/**
 * Generates a default description from a blueprint's steps array.
 * Returns a human-readable summary like "Installs 3 plugins and 2 themes. Runs 1 block of PHP code."
 */
export function generateDefaultBlueprintDescription( blueprintJson: Blueprint ): string {
	const steps = Array.isArray( blueprintJson.steps )
		? blueprintJson.steps.filter( ( step ): step is StepDefinition =>
				Boolean( step && typeof step === 'object' )
		  )
		: [];

	if ( ! steps.length ) {
		return '';
	}

	const counts = {
		plugins: 0,
		themes: 0,
		contentImports: 0,
		phpCode: 0,
		sqlQueries: 0,
		wpCliCommands: 0,
		siteConfig: 0,
	};

	for ( const step of steps ) {
		const stepName = step.step;
		switch ( stepName ) {
			case 'installPlugin':
				counts.plugins++;
				break;
			case 'installTheme':
				counts.themes++;
				break;
			case 'importWxr':
			case 'importThemeStarterContent':
			case 'importWordPressFiles':
				counts.contentImports++;
				break;
			case 'runPHP':
			case 'runPHPWithOptions':
				counts.phpCode++;
				break;
			case 'runSql':
				counts.sqlQueries++;
				break;
			case 'wp-cli':
				counts.wpCliCommands++;
				break;
			case 'setSiteOptions':
			case 'setSiteLanguage':
			case 'defineWpConfigConsts':
			case 'updateUserMeta':
				counts.siteConfig++;
				break;
		}
	}

	const sentences: string[] = [];

	// "Installs" sentence — plugins and/or themes
	const installParts: string[] = [];
	if ( counts.plugins > 0 ) {
		installParts.push(
			sprintf(
				/* translators: %d is the number of plugins to install. */
				_n( '%d plugin', '%d plugins', counts.plugins ),
				counts.plugins
			)
		);
	}
	if ( counts.themes > 0 ) {
		installParts.push(
			sprintf(
				/* translators: %d is the number of themes to install. */
				_n( '%d theme', '%d themes', counts.themes ),
				counts.themes
			)
		);
	}
	if ( installParts.length > 0 ) {
		sentences.push(
			sprintf(
				/* translators: %s is a list of items to install, e.g. "3 plugins and 2 themes". */
				__( 'Installs %s.' ),
				joinWithAnd( installParts )
			)
		);
	}

	// "Imports content." sentence
	if ( counts.contentImports > 0 ) {
		sentences.push( __( 'Imports content.' ) );
	}

	// "Runs" sentence — PHP blocks, SQL queries, and/or WP-CLI commands
	const runParts: string[] = [];
	if ( counts.phpCode > 0 ) {
		runParts.push(
			sprintf(
				/* translators: %d is the number of PHP code blocks to run. */
				_n( '%d block of PHP code', '%d blocks of PHP code', counts.phpCode ),
				counts.phpCode
			)
		);
	}
	if ( counts.sqlQueries > 0 ) {
		runParts.push(
			sprintf(
				/* translators: %d is the number of SQL queries to run. */
				_n( '%d SQL query', '%d SQL queries', counts.sqlQueries ),
				counts.sqlQueries
			)
		);
	}
	if ( counts.wpCliCommands > 0 ) {
		runParts.push(
			sprintf(
				/* translators: %d is the number of WP-CLI commands to run. */
				_n( '%d WP-CLI command', '%d WP-CLI commands', counts.wpCliCommands ),
				counts.wpCliCommands
			)
		);
	}
	if ( runParts.length > 0 ) {
		sentences.push(
			sprintf(
				/* translators: %s is a list of items to run, e.g. "2 blocks of PHP code and 1 SQL query". */
				__( 'Runs %s.' ),
				joinWithAnd( runParts )
			)
		);
	}

	// "Applies site configuration." sentence
	if ( counts.siteConfig > 0 ) {
		sentences.push( __( 'Applies site configuration.' ) );
	}

	return sentences.join( ' ' );
}
