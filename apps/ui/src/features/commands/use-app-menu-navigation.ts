import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useEffect } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { resolveSettingsLink } from '@/data/settings-sections';
import { useOpenSettings } from '@/data/use-open-settings';
import { useOpenSite } from '@/data/use-open-site';
import { useStartSiteWithChat } from '@/data/use-start-site-with-chat';
import { useOpenAddSite, createSelectedBlueprint, pendingBlueprintSlot } from '@/features/sites';

export function useAppMenuNavigation() {
	const connector = useConnector();
	const openSettings = useOpenSettings();
	const openAddSite = useOpenAddSite();
	const openSite = useOpenSite();
	const { mutate: startSite } = useStartSiteWithChat();
	const queryClient = useQueryClient();

	useEffect( () => connector.onAddSite( () => openAddSite() ), [ connector, openAddSite ] );
	useEffect(
		() =>
			connector.onOpenSite( ( { siteId } ) => {
				void queryClient
					.fetchQuery( { queryKey: SITES_QUERY_KEY, queryFn: () => connector.getSites() } )
					.then( ( sites ) => {
						const site = sites.find( ( candidate ) => candidate.id === siteId );
						if ( site ) {
							openSite( site );
							if ( ! site.running ) {
								startSite( site.id );
							}
						} else {
							toast.error( __( 'This site is no longer available in WordPress Studio.' ) );
						}
					} )
					.catch( () => toast.error( __( 'WordPress Studio could not open the site.' ) ) );
			} ),
		[ connector, openSite, queryClient, startSite ]
	);
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
