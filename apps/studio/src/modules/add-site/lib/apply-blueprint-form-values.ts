import { extractFormValuesFromBlueprint } from '@studio/common/lib/blueprint-settings';
import { BlueprintPreferredVersions } from '@studio/common/lib/blueprint-validation';
import { isSupportedPHPVersion, SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

interface BlueprintFormValueSetters {
	setBlueprintPreferredVersions: ( versions: BlueprintPreferredVersions | undefined ) => void;
	setPhpVersion?: ( version: SupportedPHPVersion ) => void;
	setWpVersion?: ( version: string ) => void;
	setBlueprintSuggestedDomain?: ( domain: string | undefined ) => void;
	setBlueprintSuggestedHttps?: ( https: boolean | undefined ) => void;
	setBlueprintSuggestedSiteName?: ( name: string | undefined ) => void;
	setBlueprintRequiresCustomDomain: ( requires: boolean ) => void;
}

export function applyBlueprintFormValues(
	blueprintJson: BlueprintV1Declaration,
	setters: BlueprintFormValueSetters
): void {
	const formValues = extractFormValuesFromBlueprint( blueprintJson );

	if ( blueprintJson.preferredVersions ) {
		const rawPhp = blueprintJson.preferredVersions.php;

		// Normalise unsupported 7.2/7.3 to 7.4 for display; pass all other values through as-is.
		const preferredPhp =
			rawPhp === '7.2' || rawPhp === '7.3' ? '7.4' : rawPhp;

		setters.setBlueprintPreferredVersions( {
			php: preferredPhp,
			wp: blueprintJson.preferredVersions.wp,
		} );
	} else {
		setters.setBlueprintPreferredVersions( undefined );
	}

	if ( formValues.phpVersion ) {
		setters.setPhpVersion?.( formValues.phpVersion );
	}
	if ( formValues.wpVersion ) {
		setters.setWpVersion?.( formValues.wpVersion );
	}

	setters.setBlueprintSuggestedDomain?.( formValues.customDomain );
	setters.setBlueprintSuggestedHttps?.( formValues.enableHttps );
	setters.setBlueprintSuggestedSiteName?.( formValues.siteName );
	setters.setBlueprintRequiresCustomDomain( !! formValues.requiresCustomDomain );
}
