import { __ } from '@wordpress/i18n';
import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import { resolveSettingsLink } from '@/data/settings-sections';
import { useOpenSettings } from '@/data/use-open-settings';
import { useOpenAddSite, createSelectedBlueprint, pendingBlueprintSlot } from '@/features/sites';

export function useAppMenuNavigation() {
	const connector = useConnector();
	const openSettings = useOpenSettings();
	const openAddSite = useOpenAddSite();

	useEffect( () => connector.onAddSite( () => openAddSite() ), [ connector, openAddSite ] );
	useEffect(
		() =>
			connector.onAddSiteWithBlueprint( ( { blueprintPath } ) => {
				void ( async () => {
					try {
						const blueprintJson = await connector.readBlueprintFile( blueprintPath );
						const blueprint = await createSelectedBlueprint( blueprintJson, {
							name: blueprintPath.split( /[\\/]/ ).pop() || 'blueprint.json',
							size: 0,
						} );
						pendingBlueprintSlot.set( blueprint );
						openAddSite();
					} catch ( error ) {
						console.error( 'Failed to open Blueprint deep link:', error );
						const ipcApi = (
							window as unknown as {
								ipcApi?: {
									showErrorMessageBox( options: {
										title: string;
										message: string;
										error?: unknown;
										showOpenLogs?: boolean;
									} ): void;
								};
							}
						 ).ipcApi;
						ipcApi?.showErrorMessageBox( {
							title: __( 'Failed to load Blueprint' ),
							message: __(
								'WordPress Studio could not open the Blueprint. Please check the file and try again.'
							),
							error,
							showOpenLogs: true,
						} );
					}
				} )();
			} ),
		[ connector, openAddSite ]
	);
	useEffect(
		() =>
			connector.onOpenSettings( ( { settingId } ) =>
				settingId
					? openSettings( resolveSettingsLink( settingId ), undefined, settingId )
					: openSettings()
			),
		[ connector, openSettings ]
	);
}
