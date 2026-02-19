import { useI18n } from '@wordpress/react-i18n';
import { useCallback } from 'react';
import {
	extractFormValuesFromBlueprint,
	generateDefaultBlueprintDescription,
} from 'common/lib/blueprint-settings';
import {
	BlueprintValidationWarning,
	BlueprintPreferredVersions,
} from 'common/lib/blueprint-validation';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { Blueprint } from 'src/stores/wpcom-api';

type BlueprintMetadata = {
	title?: string;
	description?: string;
};

interface UseBlueprintDeeplinkOptions {
	isAnySiteProcessing: boolean;
	setSelectedBlueprint: ( blueprint?: Blueprint ) => void;
	setPhpVersion: ( version: string ) => void;
	setWpVersion: ( version: string ) => void;
	setBlueprintPreferredVersions: ( versions: BlueprintPreferredVersions | undefined ) => void;
	setBlueprintWarnings: ( warnings: BlueprintValidationWarning[] | undefined ) => void;
	setBlueprintSuggestedDomain: ( domain: string | undefined ) => void;
	setBlueprintSuggestedHttps: ( https: boolean | undefined ) => void;
	setBlueprintSuggestedSiteName: ( name: string | undefined ) => void;
	setBlueprintRequiresCustomDomain: ( requires: boolean ) => void;
	setIsDeeplinkFlow: ( isDeeplink: boolean ) => void;
	onModalOpen?: () => void;
}

export function useBlueprintDeeplink( options: UseBlueprintDeeplinkOptions ): void {
	const { __ } = useI18n();
	const {
		isAnySiteProcessing,
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
		setBlueprintPreferredVersions,
		setBlueprintWarnings,
		setBlueprintSuggestedDomain,
		setBlueprintSuggestedHttps,
		setBlueprintSuggestedSiteName,
		setBlueprintRequiresCustomDomain,
		setIsDeeplinkFlow,
		onModalOpen,
	} = options;

	useIpcListener(
		'add-site-with-blueprint',
		useCallback(
			async (
				_event: unknown,
				{
					blueprintPath,
					warnings,
				}: {
					blueprintPath: string;
					warnings?: BlueprintValidationWarning[];
				}
			) => {
				if ( isAnySiteProcessing ) {
					return;
				}
				try {
					const blueprintJson = await getIpcApi().readBlueprintFile( blueprintPath );
					const fileName = blueprintPath.split( /[/\\]/ ).pop() || 'blueprint.json';
					const blueprintMeta = blueprintJson.meta as BlueprintMetadata | undefined;

					const fileBlueprint: Blueprint = {
						slug: `file:${ fileName }`,
						title: blueprintMeta?.title || '',
						excerpt:
							blueprintMeta?.description || generateDefaultBlueprintDescription( blueprintJson ),
						image: '',
						playground_url: '',
						blueprint: blueprintJson,
					};

					setSelectedBlueprint( fileBlueprint );

					const formValues = extractFormValuesFromBlueprint( blueprintJson );

					if ( blueprintJson.preferredVersions ) {
						setBlueprintPreferredVersions(
							blueprintJson.preferredVersions as BlueprintPreferredVersions
						);
					}
					if ( formValues.phpVersion ) {
						setPhpVersion( formValues.phpVersion );
					}
					if ( formValues.wpVersion ) {
						setWpVersion( formValues.wpVersion );
					}
					if ( formValues.customDomain ) {
						setBlueprintSuggestedDomain( formValues.customDomain );
						setBlueprintSuggestedHttps( formValues.enableHttps );
					}
					if ( formValues.siteName ) {
						setBlueprintSuggestedSiteName( formValues.siteName );
					}
					setBlueprintRequiresCustomDomain( !! formValues.requiresCustomDomain );

					setBlueprintWarnings( warnings );
					setIsDeeplinkFlow( true );
					onModalOpen?.();
				} catch ( error ) {
					console.error( 'Failed to load blueprint from URL:', error );
				}
			},
			[
				isAnySiteProcessing,
				setSelectedBlueprint,
				setPhpVersion,
				setWpVersion,
				setBlueprintPreferredVersions,
				setBlueprintWarnings,
				setBlueprintSuggestedDomain,
				setBlueprintSuggestedHttps,
				setBlueprintSuggestedSiteName,
				setBlueprintRequiresCustomDomain,
				setIsDeeplinkFlow,
				onModalOpen,
			]
		)
	);
}
