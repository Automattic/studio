import { validateSelectedSitePath } from '@studio/common/lib/site-path-validation';
import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { usePublishPreviewSite } from '@/data/queries/use-preview-site';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import { usePullSiteFromLive } from '@/data/queries/use-sync-site';
import { resolveSettingsLink } from '@/data/settings-sections';
import { getSnapshotHostname } from '@/data/snapshot-url';
import { requestHeaderPanel } from '@/data/use-open-header-panel';
import { useOpenSettings } from '@/data/use-open-settings';
import { useOpenSite } from '@/data/use-open-site';
import { useStartSiteWithChat } from '@/data/use-start-site-with-chat';
import {
	useOpenAddSite,
	createSelectedBlueprint,
	pendingBlueprintSlot,
	pendingRemoteSiteSlot,
	pendingSiteFolderSlot,
} from '@/features/sites';
import { replaceOpenDialogs } from '@/lib/ui';

export function useAppMenuNavigation() {
	const connector = useConnector();
	const openSettings = useOpenSettings();
	const openAddSite = useOpenAddSite();
	const openSite = useOpenSite();
	const { mutate: startSite } = useStartSiteWithChat();
	const queryClient = useQueryClient();
	const { mutate: pullSite } = usePullSiteFromLive();
	const { mutate: publishPreview } = usePublishPreviewSite();

	const pickingFolder = useRef( false );

	useEffect(
		() =>
			connector.onOpenFolder( () => {
				if ( pickingFolder.current ) return;
				replaceOpenDialogs( () => {
					pickingFolder.current = true;
					void ( async () => {
						try {
							const folder = await connector.selectSiteFolder( '', { allowBlueprints: true } );
							if ( ! folder ) return;
							if ( folder.blueprint ) {
								const source = folder.blueprint;
								try {
									const blueprint = await createSelectedBlueprint(
										source.blueprintJson,
										{ name: folder.name, size: 0 },
										{ filePath: source.blueprintJsonPath, tempDir: source.tempDir }
									);
									pendingBlueprintSlot.set( blueprint );
									openAddSite();
								} catch ( error ) {
									if ( source.tempDir ) await connector.cleanupBlueprintTempDir( source.tempDir );
									throw error;
								}
								return;
							}
							const sites = await connector.getSites();
							const matches = await Promise.all(
								sites.map( ( site ) => connector.comparePaths( site.path, folder.path ) )
							);
							const existing = sites.find( ( _site, index ) => matches[ index ] );
							if ( existing ) {
								openSite( existing );
								if ( ! existing.running ) startSite( existing.id );
								return;
							}
							const result = validateSelectedSitePath( folder, false );
							if ( result.error ) {
								toast.error( result.error );
								return;
							}
							pendingSiteFolderSlot.set( folder );
							openAddSite();
						} catch {
							toast.error( __( 'WordPress Studio could not open the folder. Please try again.' ) );
						} finally {
							pickingFolder.current = false;
						}
					} )();
				} );
			} ),
		[ connector, openAddSite, openSite, startSite ]
	);

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
	// Opens the Pull view of the local site connected to the remote one, or sets up a new
	// local site for it. Either way, the user starts the pull.
	useEffect(
		() =>
			connector.onPullSite( ( { remoteSiteId } ) => {
				void ( async () => {
					const [ snapshots, connected, sites ] = await Promise.all( [
						connector.getSnapshots().catch( () => [] ),
						connector.getConnectedWpcomSites().catch( () => [] ),
						queryClient.fetchQuery( {
							queryKey: SITES_QUERY_KEY,
							queryFn: () => connector.getSites(),
						} ),
					] );
					const findSite = ( siteId?: string ) => sites.find( ( site ) => site.id === siteId );

					// A preview opens on the local site it was pushed from or pulled into, which is
					// brought up to date with it when only the preview changed since.
					const snapshot = snapshots.find(
						( item ) => item.atomicSiteId === remoteSiteId && findSite( item.localSiteId )
					);
					const previewSite = findSite( snapshot?.localSiteId );
					if ( snapshot && previewSite ) {
						const { localChanged, previewChanged } = await connector
							.getPreviewStatus( getSnapshotHostname( snapshot ) )
							.catch( () => ( { localChanged: null, previewChanged: null } ) );
						if ( previewChanged && localChanged === false ) {
							pullSite( { siteId: previewSite.id, remoteSiteId } );
						} else if ( previewChanged ) {
							toast.info( __( 'This site and its preview both changed' ), {
								description: __( 'Pulling the preview replaces the changes made here.' ),
								action: {
									label: __( 'Pull preview' ),
									onClick: () => pullSite( { siteId: previewSite.id, remoteSiteId } ),
								},
							} );
						} else if ( localChanged ) {
							toast.info( __( "This site has changes its preview doesn't" ), {
								action: {
									label: __( 'Update preview' ),
									onClick: () =>
										publishPreview( {
											siteId: previewSite.id,
											existingHostname: getSnapshotHostname( snapshot ),
										} ),
								},
							} );
						}
						openSite( previewSite );
						return;
					}

					const localSiteIds = new Set(
						connected
							.filter( ( remote ) => remote.id === remoteSiteId )
							.map( ( remote ) => remote.localSiteId )
					);
					const site = sites.find( ( candidate ) => localSiteIds.has( candidate.id ) );
					if ( site ) {
						requestHeaderPanel( {
							panel: 'publish',
							siteId: site.id,
							view: 'pull',
							remoteSiteId,
						} );
						openSite( site );
						return;
					}
					pendingRemoteSiteSlot.set( { remoteSiteId } );
					openAddSite( 'connect' );
				} )().catch( () => toast.error( __( 'WordPress Studio could not open the site.' ) ) );
			} ),
		[ connector, openAddSite, openSite, queryClient, pullSite, publishPreview ]
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
