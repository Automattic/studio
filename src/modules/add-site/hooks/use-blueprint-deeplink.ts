import { useI18n } from '@wordpress/react-i18n';
import { useCallback } from 'react';
import { BlueprintValidationWarning } from 'common/lib/blueprint-validation';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { Blueprint } from 'src/stores/wpcom-api';

interface UseBlueprintDeeplinkOptions {
	isAnySiteProcessing: boolean;
	setSelectedBlueprint: ( blueprint?: Blueprint ) => void;
	setPhpVersion: ( version: string ) => void;
	setWpVersion: ( version: string ) => void;
	setBlueprintPreferredVersions: ( versions: { php?: string; wp?: string } | undefined ) => void;
	setBlueprintDeeplinkWarnings: ( warnings: BlueprintValidationWarning[] | undefined ) => void;
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
		setBlueprintDeeplinkWarnings,
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
					const blueprintMeta = blueprintJson.meta as
						| { title?: string; description?: string }
						| undefined;

					const fileBlueprint: Blueprint = {
						slug: `file:${ fileName }`,
						title: blueprintMeta?.title || fileName.replace( '.json', '' ),
						excerpt: blueprintMeta?.description || __( 'Blueprint loaded from URL' ),
						image: '',
						playground_url: '',
						blueprint: blueprintJson,
					};

					setSelectedBlueprint( fileBlueprint );

					if ( blueprintJson.preferredVersions ) {
						const preferredVersions = blueprintJson.preferredVersions as {
							php?: string;
							wp?: string;
						};
						setBlueprintPreferredVersions( preferredVersions );
						if ( preferredVersions.php && preferredVersions.php !== 'latest' ) {
							setPhpVersion( preferredVersions.php );
						}
						if ( preferredVersions.wp && preferredVersions.wp !== 'latest' ) {
							setWpVersion( preferredVersions.wp );
						}
					}

					setBlueprintDeeplinkWarnings( warnings );
					setIsDeeplinkFlow( true );
					onModalOpen?.();
				} catch ( error ) {
					console.error( 'Failed to load blueprint from URL:', error );
				}
			},
			[
				isAnySiteProcessing,
				__,
				setSelectedBlueprint,
				setPhpVersion,
				setWpVersion,
				setBlueprintPreferredVersions,
				setBlueprintDeeplinkWarnings,
				setIsDeeplinkFlow,
				onModalOpen,
			]
		)
	);
}
