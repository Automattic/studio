import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import { cloudUpload, archive, code, commentContent, grid, preformatted } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback } from 'react';
import { ButtonsSection, ButtonsSectionProps } from 'src/components/buttons-section';
import { useAuth } from 'src/hooks/use-auth';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isWindows } from 'src/lib/app-globals';
import { generateCheckoutUrl } from 'src/lib/generate-checkout-url';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ConnectButton } from 'src/modules/sync/components/connect-button';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';
import { syncOperationsSelectors } from 'src/stores/sync';
import { useGetConnectedSitesForLocalSiteQuery } from 'src/stores/sync/connected-sites';
import { createNewTask } from 'src/stores/tasks-slice';

interface ContentTabOverviewProps {
	selectedSite: SiteDetails;
}

function ShortcutsSection( { selectedSite }: Pick< ContentTabOverviewProps, 'selectedSite' > ) {
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();
	const { startServer, loadingServer } = useSiteDetails();
	const dispatch = useAppDispatch();
	const isServerLoading = loadingServer[ selectedSite.id ];

	const buttonsArray: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: __( 'New task' ),
			className: 'text-nowrap',
			icon: commentContent,
			onClick: () => {
				void dispatch( createNewTask( selectedSite.id ) );
			},
		},
		{
			label: isWindows()
				? // translators: name of app used to navigate files and folders on Windows
				  __( 'File Explorer' )
				: // translators: name of app used to navigate files and folders on macOS
				  __( 'Finder' ),
			className: 'text-nowrap',
			icon: archive,
			onClick: () => {
				getIpcApi().openLocalPath( selectedSite.path );
			},
		},
	];

	const editorConfig = editor ? supportedEditorConfig[ editor ] : false;
	if ( editor && editorConfig ) {
		buttonsArray.push( {
			label: editorConfig.label,
			className: 'text-nowrap',
			icon: code,
			onClick: async () => {
				await getIpcApi().openAppAtPath( editor, selectedSite.path );
			},
		} );
	}

	const terminalName = getTerminalName( terminal );
	buttonsArray.push( {
		label: terminalName,
		className: 'text-nowrap',
		icon: preformatted,
		onClick: async () => {
			try {
				await getIpcApi().openTerminalAtPath( selectedSite.path );
			} catch ( error ) {
				Sentry.captureException( error );
				alert( __( 'Could not open the terminal.' ) );
			}
		},
	} );

	buttonsArray.push( {
		label: __( 'phpMyAdmin' ),
		className: 'text-nowrap',
		icon: grid,
		disabled: isServerLoading,
		onClick: async () => {
			if ( ! selectedSite.running ) {
				await startServer( selectedSite );
			}
			getIpcApi().openSiteURL(
				selectedSite.id,
				'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
			);
		},
	} );

	return <ButtonsSection buttonsArray={ buttonsArray } title={ __( 'Open in…' ) } />;
}

function PublishSection( { selectedSite }: Pick< ContentTabOverviewProps, 'selectedSite' > ) {
	const { __ } = useI18n();
	const { user } = useAuth();
	const { data: connectedSites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite.id,
		userId: user?.id,
	} );
	const isAnySitePulling = useRootSelector( syncOperationsSelectors.selectIsAnySitePulling );
	const isAnySitePushing = useRootSelector( syncOperationsSelectors.selectIsAnySitePushing );
	const isAnySiteSyncing = isAnySitePulling || isAnySitePushing;

	const handlePublishClick = useCallback( () => {
		getIpcApi().openURL(
			generateCheckoutUrl( selectedSite, 'publish-site', { autoOpenPush: true } )
		);
	}, [ selectedSite ] );

	if ( connectedSites.length !== 0 ) return null;

	return (
		<div className="w-full">
			<h2 className="a8c-subtitle-small mb-1">{ __( 'Publish' ) }</h2>
			<p className="text-frame-text-secondary text-[13px] leading-[140%] mb-3">
				{ __( 'Make your site live on WordPress.com with a custom domain.' ) }
			</p>
			<ConnectButton
				variant="primary"
				icon={ cloudUpload }
				connectSite={ handlePublishClick }
				disabled={ isAnySiteSyncing }
				tooltipText={
					isAnySiteSyncing
						? __(
								'Another site is syncing. Please wait for the sync to finish before you publish your site.'
						  )
						: __( 'Publishing your site requires an internet connection.' )
				}
			>
				{ __( 'Publish site' ) }
			</ConnectButton>
		</div>
	);
}

export function ContentTabOverview( { selectedSite }: ContentTabOverviewProps ) {
	return (
		<div className="p-8 flex flex-col gap-8 max-w-4xl">
			<ShortcutsSection selectedSite={ selectedSite } />
			<PublishSection selectedSite={ selectedSite } />
		</div>
	);
}
