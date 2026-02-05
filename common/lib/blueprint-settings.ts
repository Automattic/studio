import type { Blueprint } from '@wp-playground/blueprints';

type BlueprintSiteSettings = Partial<
	Pick< StoppedSiteDetails, 'phpVersion' | 'customDomain' | 'enableHttps' >
> & {
	wpVersion?: string;
	adminUsername?: string;
	adminPassword?: string;
};

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

		// Extract login credentials from login step
		const loginStep = blueprintJson.steps.find(
			( step: { step?: string } ) => step.step === 'login'
		);
		if ( loginStep ) {
			const { username, password } = loginStep as { username?: string; password?: string };
			if ( typeof username === 'string' ) {
				values.adminUsername = username;
			}
			if ( typeof password === 'string' ) {
				values.adminPassword = password;
			}
		}
	}

	// Check top-level login property (shorthand syntax).
	// login: true just enables auto-login with defaults, login: false disables it — neither has credentials to extract.
	if ( blueprintJson.login !== undefined && blueprintJson.login !== true ) {
		if ( typeof blueprintJson.login === 'object' && blueprintJson.login !== null ) {
			const { username, password } = blueprintJson.login as {
				username?: string;
				password?: string;
			};
			if ( typeof username === 'string' ) {
				values.adminUsername = username;
			}
			if ( typeof password === 'string' ) {
				values.adminPassword = password;
			}
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
	}

	return updated;
}
