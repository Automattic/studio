import { extractFormValuesFromBlueprint } from '@studio/common/lib/blueprint-settings';
import { BlueprintPreferredVersions } from '@studio/common/lib/blueprint-validation';
import type { Blueprint } from '@wp-playground/blueprints';

interface BlueprintFormValueSetters {
	setBlueprintPreferredVersions: ( versions: BlueprintPreferredVersions | undefined ) => void;
	setPhpVersion?: ( version: string ) => void;
	setWpVersion?: ( version: string ) => void;
	setBlueprintSuggestedDomain?: ( domain: string | undefined ) => void;
	setBlueprintSuggestedHttps?: ( https: boolean | undefined ) => void;
	setBlueprintSuggestedSiteName?: ( name: string | undefined ) => void;
	setBlueprintRequiresCustomDomain: ( requires: boolean ) => void;
}

export function applyBlueprintFormValues(
	blueprintJson: Blueprint,
	setters: BlueprintFormValueSetters
): void {
	const formValues = extractFormValuesFromBlueprint( blueprintJson );

	if ( blueprintJson.preferredVersions ) {
		setters.setBlueprintPreferredVersions(
			blueprintJson.preferredVersions as BlueprintPreferredVersions
		);
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
