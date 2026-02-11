import type { Blueprint } from '@wp-playground/blueprints';

type BlueprintSiteSettings = Partial<
	Pick< StoppedSiteDetails, 'phpVersion' | 'customDomain' | 'enableHttps' >
> & {
	wpVersion?: string;
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
