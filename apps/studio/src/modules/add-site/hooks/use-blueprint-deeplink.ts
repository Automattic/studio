import { getBlueprintDisplayDetails } from '@studio/common/lib/blueprint-selection';
import { BlueprintPreferredVersions } from '@studio/common/lib/blueprint-validation';
import { SupportedPHPVersion } from '@studio/common/types/php-versions';
import { useCallback } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { Blueprint } from 'src/stores/wpcom-api';
import { applyBlueprintFormValues } from '../lib/apply-blueprint-form-values';
import type { BlueprintV1Declaration } from '@wp-playground/blueprints';

interface UseBlueprintDeeplinkOptions {
	isAnySiteProcessing: boolean;
	setSelectedBlueprint: ( blueprint?: Blueprint ) => void;
	setPhpVersion: ( version: SupportedPHPVersion ) => void;
	setWpVersion: ( version: string ) => void;
	setBlueprintPreferredVersions: ( versions: BlueprintPreferredVersions | undefined ) => void;
	setBlueprintSuggestedDomain: ( domain: string | undefined ) => void;
	setBlueprintSuggestedHttps: ( https: boolean | undefined ) => void;
	setBlueprintSuggestedSiteName: ( name: string | undefined ) => void;
	setBlueprintRequiresCustomDomain: ( requires: boolean ) => void;
	setIsDeeplinkFlow: ( isDeeplink: boolean ) => void;
	onModalOpen?: () => void;
}

export function useBlueprintDeeplink( options: UseBlueprintDeeplinkOptions ): void {
	const {
		isAnySiteProcessing,
		setSelectedBlueprint,
		setPhpVersion,
		setWpVersion,
		setBlueprintPreferredVersions,
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
				}: {
					blueprintPath: string;
				}
			) => {
				if ( isAnySiteProcessing ) {
					return;
				}
				try {
					const blueprintJson = await getIpcApi().readBlueprintFile( blueprintPath );
					const fileName = blueprintPath.split( /[/\\]/ ).pop() || 'blueprint.json';
					const details = getBlueprintDisplayDetails( blueprintJson as BlueprintV1Declaration, '' );

					const fileBlueprint: Blueprint = {
						slug: `file:${ fileName }`,
						title: details.title,
						excerpt: details.excerpt,
						image: '',
						playground_url: '',
						blueprint: blueprintJson,
					};

					setSelectedBlueprint( fileBlueprint );

					applyBlueprintFormValues( blueprintJson, {
						setBlueprintPreferredVersions,
						setPhpVersion,
						setWpVersion,
						setBlueprintSuggestedDomain,
						setBlueprintSuggestedHttps,
						setBlueprintSuggestedSiteName,
						setBlueprintRequiresCustomDomain,
					} );

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
