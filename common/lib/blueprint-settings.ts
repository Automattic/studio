import { __, _n, sprintf } from '@wordpress/i18n';
import type { Blueprint } from '@wp-playground/blueprints';

type BlueprintSiteSettings = Partial<
	Pick< StoppedSiteDetails, 'phpVersion' | 'customDomain' | 'enableHttps' >
> & {
	wpVersion?: string;
	siteName?: string;
	requiresCustomDomain?: boolean;
};

/**
 * Checks if a blueprint contains the enableMultisite step.
 */
export function blueprintHasMultisite( blueprintJson: Blueprint ): boolean {
	return (
		Array.isArray( blueprintJson.steps ) &&
		blueprintJson.steps.some( ( step: { step?: string } ) => step.step === 'enableMultisite' )
	);
}

/**
 * Extracts form-relevant values from a blueprint.
 */
export function extractFormValuesFromBlueprint( blueprintJson: Blueprint ): BlueprintSiteSettings {
	const values: BlueprintSiteSettings = {};

	if ( blueprintJson.preferredVersions ) {
		if ( blueprintJson.preferredVersions.php && blueprintJson.preferredVersions.php !== 'latest' ) {
			values.phpVersion = blueprintJson.preferredVersions.php;
		}
		if ( blueprintJson.preferredVersions.wp && blueprintJson.preferredVersions.wp !== 'latest' ) {
			values.wpVersion = blueprintJson.preferredVersions.wp;
		}
	}

	if ( blueprintHasMultisite( blueprintJson ) ) {
		values.requiresCustomDomain = true;
	}

	if ( blueprintJson.steps && Array.isArray( blueprintJson.steps ) ) {
		const defineSiteUrlStep = blueprintJson.steps.find(
			( step: { step?: string } ) => step.step === 'defineSiteUrl'
		);
		if ( defineSiteUrlStep?.siteUrl ) {
			try {
				const url = new URL( defineSiteUrlStep.siteUrl );
				values.customDomain = url.hostname;
				values.enableHttps = url.protocol === 'https:';
			} catch {
				// Invalid URL, skip
			}
		}

		const setSiteOptionsStep = blueprintJson.steps.find(
			( step: { step?: string; options?: Record< string, unknown > } ) =>
				step.step === 'setSiteOptions' && step.options?.blogname
		);
		if ( setSiteOptionsStep?.options?.blogname ) {
			values.siteName = String( setSiteOptionsStep.options.blogname );
		}
	}

	return values;
}

/**
 * Updates a blueprint with form values. Only updates properties that already exist.
 */
export function updateBlueprintWithFormValues(
	blueprintJson: Blueprint,
	formValues: BlueprintSiteSettings
): Blueprint {
	const updated = { ...blueprintJson };

	// Update preferred versions (only if they already exist)
	if ( updated.preferredVersions ) {
		updated.preferredVersions = { ...updated.preferredVersions };

		if ( updated.preferredVersions.php !== undefined && formValues.phpVersion ) {
			updated.preferredVersions.php = formValues.phpVersion;
		}
		if ( updated.preferredVersions.wp !== undefined && formValues.wpVersion ) {
			updated.preferredVersions.wp = formValues.wpVersion;
		}
	}

	// Update defineSiteUrl step (only if it already exists)
	if ( updated.steps && Array.isArray( updated.steps ) ) {
		const stepIndex = updated.steps.findIndex(
			( step: { step?: string } ) => step.step === 'defineSiteUrl'
		);

		if ( stepIndex >= 0 && formValues.customDomain ) {
			const protocol = formValues.enableHttps ? 'https' : 'http';
			updated.steps = [ ...updated.steps ];
			updated.steps[ stepIndex ] = {
				...updated.steps[ stepIndex ],
				siteUrl: `${ protocol }://${ formValues.customDomain }`,
			};
		}

		// Update setSiteOptions blogname (only if it already exists)
		if ( formValues.siteName ) {
			const siteOptionsIndex = updated.steps.findIndex(
				( step: { step?: string; options?: Record< string, unknown > } ) =>
					step.step === 'setSiteOptions' && step.options?.blogname
			);

			if ( siteOptionsIndex >= 0 ) {
				if ( updated.steps === blueprintJson.steps ) {
					updated.steps = [ ...updated.steps ];
				}
				updated.steps[ siteOptionsIndex ] = {
					...updated.steps[ siteOptionsIndex ],
					options: {
						...updated.steps[ siteOptionsIndex ].options,
						blogname: formValues.siteName,
					},
				};
			}
		}
	}

	return updated;
}

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
	if ( ! blueprintJson.steps || ! Array.isArray( blueprintJson.steps ) ) {
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

	for ( const step of blueprintJson.steps ) {
		const stepName = ( step as { step?: string } ).step;
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
