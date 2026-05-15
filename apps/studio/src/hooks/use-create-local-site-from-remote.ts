import * as Sentry from '@sentry/electron/renderer';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback } from 'react';
import { useAuth } from 'src/hooks/use-auth';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { canCreateLocalSiteFromRemote } from 'src/modules/sync/lib/sync-support-ui';
import { useAppDispatch } from 'src/stores';
import { syncOperationsThunks } from 'src/stores/sync';
import { useConnectSiteMutation } from 'src/stores/sync/connected-sites';
import type { SyncSite } from '@studio/common/types/sync';
import type { SyncOption } from 'src/types';

export type RemoteLocalSiteProposal = {
	siteName: string;
	sitePath: string;
	error?: string;
};

type CreateLocalSiteFromRemoteOptions = {
	siteName?: string;
	sitePath?: string;
	wpVersion?: string;
	customDomain?: string;
	enableHttps?: boolean;
	phpVersion?: string;
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
};

export function useCreateLocalSiteFromRemote() {
	const { __ } = useI18n();
	const { client } = useAuth();
	const {
		createSite,
		sites = [],
		wpcomSiteActivity = {},
		setWpcomSiteActivity = () => undefined,
	} = useSiteDetails();
	const [ connectSite ] = useConnectSiteMutation();
	const dispatch = useAppDispatch();
	const { setSelectedTab } = useContentTabs();

	const checkPathExists = useCallback(
		async ( path: string ): Promise< boolean > => {
			const results = await Promise.all(
				sites.map( ( site ) => getIpcApi().comparePaths( site.path, path ) )
			);
			return results.some( Boolean );
		},
		[ sites ]
	);

	const getLocalSiteProposal = useCallback(
		async ( remoteSite: SyncSite ): Promise< RemoteLocalSiteProposal > => {
			const { path, name, isEmpty, isWordPress, isNameTooLong } =
				await getIpcApi().generateProposedSitePath( remoteSite.name );
			const siteName = name ?? remoteSite.name;

			if ( isNameTooLong ) {
				return {
					siteName,
					sitePath: path,
					error: __( 'The site name is too long. Please choose a shorter site name.' ),
				};
			}

			if ( await checkPathExists( path ) ) {
				return {
					siteName,
					sitePath: path,
					error: __(
						'The directory is already associated with another Studio site. Please choose a different site name or a custom local path.'
					),
				};
			}

			if ( ! isEmpty && ! isWordPress ) {
				return {
					siteName,
					sitePath: path,
					error: __(
						'This directory is not empty. Please select an empty directory or an existing WordPress folder.'
					),
				};
			}

			return { siteName, sitePath: path };
		},
		[ __, checkPathExists ]
	);

	const connectAndPullRemoteSite = useCallback(
		async ( localSite: SiteDetails, remoteSite: SyncSite ) => {
			if ( ! client ) {
				throw new Error( __( 'Log in to WordPress.com to create a local site.' ) );
			}

			await connectSite( { site: remoteSite, localSiteId: localSite.id } );
			const pullOptions: SyncOption[] = [ 'all' ];
			void dispatch(
				syncOperationsThunks.pullSite( {
					client,
					connectedSite: remoteSite,
					selectedSite: localSite,
					options: { optionsToSync: pullOptions },
				} )
			);
			setSelectedTab( 'sync' );
		},
		[ __, client, connectSite, dispatch, setSelectedTab ]
	);

	const createLocalSiteFromRemote = useCallback(
		async (
			remoteSite: SyncSite,
			options: CreateLocalSiteFromRemoteOptions = {}
		): Promise< SiteDetails | void > => {
			if ( ! canCreateLocalSiteFromRemote( remoteSite ) ) {
				throw new Error( __( 'This WordPress.com site is not available for local sync.' ) );
			}

			if ( wpcomSiteActivity[ remoteSite.id ]?.isCreatingLocalSite ) {
				return;
			}

			const proposal =
				options.siteName && options.sitePath
					? { siteName: options.siteName, sitePath: options.sitePath }
					: await getLocalSiteProposal( remoteSite );

			if ( proposal.error ) {
				throw new Error( proposal.error );
			}

			setWpcomSiteActivity( remoteSite.id, { isCreatingLocalSite: true } );

			try {
				return await createSite(
					proposal.sitePath,
					proposal.siteName,
					options.wpVersion ?? DEFAULT_WORDPRESS_VERSION,
					options.customDomain,
					options.enableHttps ?? false,
					undefined,
					options.phpVersion ?? DEFAULT_PHP_VERSION,
					async ( newSite ) => connectAndPullRemoteSite( newSite, remoteSite ),
					true,
					options.adminUsername,
					options.adminPassword,
					options.adminEmail
				);
			} finally {
				setWpcomSiteActivity( remoteSite.id, { isCreatingLocalSite: false } );
			}
		},
		[
			__,
			connectAndPullRemoteSite,
			createSite,
			getLocalSiteProposal,
			setWpcomSiteActivity,
			wpcomSiteActivity,
		]
	);

	const confirmCreateLocalSiteFromRemote = useCallback(
		async ( remoteSite: SyncSite ): Promise< SiteDetails | void > => {
			try {
				const proposal = await getLocalSiteProposal( remoteSite );

				if ( proposal.error ) {
					getIpcApi().showErrorMessageBox( {
						title: __( 'Could not create local site' ),
						message: proposal.error,
					} );
					return;
				}

				const { response } = await getIpcApi().showMessageBox( {
					type: 'question',
					message: __( 'Create local site' ),
					detail: sprintf(
						/* translators: %1$s is a WordPress.com site name, %2$s is a local site name, %3$s is a local filesystem path. */
						__(
							'Studio will create a local copy of %1$s and start syncing it from WordPress.com.\n\nName: %2$s\nPath: %3$s'
						),
						remoteSite.name,
						proposal.siteName,
						proposal.sitePath
					),
					buttons: [ __( 'Create local site' ), __( 'Cancel' ) ],
					cancelId: 1,
				} );

				if ( response !== 0 ) {
					return;
				}

				return await createLocalSiteFromRemote( remoteSite, proposal );
			} catch ( error ) {
				Sentry.captureException( error );
				getIpcApi().showErrorMessageBox( {
					title: __( 'Could not create local site' ),
					message:
						error instanceof Error
							? error.message
							: __( 'Studio could not create a local site. Please try again.' ),
				} );
			}
		},
		[ __, createLocalSiteFromRemote, getLocalSiteProposal ]
	);

	const isCreatingLocalSite = useCallback(
		( siteId?: number ) => Boolean( siteId && wpcomSiteActivity[ siteId ]?.isCreatingLocalSite ),
		[ wpcomSiteActivity ]
	);

	return {
		connectAndPullRemoteSite,
		createLocalSiteFromRemote,
		confirmCreateLocalSiteFromRemote,
		getLocalSiteProposal,
		isCreatingLocalSite,
	};
}
