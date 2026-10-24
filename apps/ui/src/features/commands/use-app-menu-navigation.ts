import { __ } from '@wordpress/i18n';
import { useEffect } from 'react';
import { resolveSettingsLink } from '@/components/settings-dialog/sections';
import { useConnector } from '@/data/core';
import { useOpenAddSite } from '@/hooks/use-open-add-site';
import { useOpenSettings } from '@/hooks/use-open-settings';
import { createSelectedBlueprint } from '@/lib/blueprint-selection';
import { pendingBlueprintSlot } from '@/lib/pending-blueprint';

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
