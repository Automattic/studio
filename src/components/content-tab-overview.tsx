import * as Sentry from '@sentry/electron/renderer';
import { Icon } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import {
	archive,
	code,
	desktop,
	pencil,
	info,
	layout,
	navigation,
	page,
	preformatted,
	styles,
	symbolFilled,
	widget,
} from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { ButtonsSection, ButtonsSectionProps } from 'src/components/buttons-section';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useThemeDetails } from 'src/hooks/use-theme-details';
import { isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import { useAppDispatch } from 'src/stores';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';
import { connectedSitesActions, useConnectedSitesData } from 'src/stores/sync';

interface ContentTabOverviewProps {
	selectedSite: SiteDetails;
}

const skeletonBg = 'animate-pulse bg-gradient-to-r from-[#F6F7F7] via-[#DCDCDE] to-[#F6F7F7]';

const ButtonSectionSkeleton = ( { title }: { title: string } ) => {
	return (
		<div className="w-full max-w-96">
			<h2 className="a8c-subtitle-small mb-3">{ title }</h2>
			<div className={ `w-full h-20 my-1 ${ skeletonBg }` }></div>
		</div>
	);
};

function CustomizeSection( {
	selectedSite,
	themeDetails,
	loading,
}: Pick< ContentTabOverviewProps, 'selectedSite' > & {
	themeDetails?: SiteDetails[ 'themeDetails' ];
	loading?: boolean;
} ) {
	const { startServer, loadingServer } = useSiteDetails();
	const isLoading = selectedSite?.id ? loadingServer[ selectedSite.id ] : false;

	const handleCustomizeClick = ( url: string ) => async () => {
		if ( isLoading ) return;
		if ( ! selectedSite.running ) {
			await startServer( selectedSite.id );
		}
		getIpcApi().openSiteURL( selectedSite.id, url );
	};

	const blockThemeButtons: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: __( 'Site Editor' ),
			icon: desktop,
			onClick: handleCustomizeClick( '/wp-admin/site-editor.php' ),
		},
		{
			label: __( 'Styles' ),
			icon: styles,
			onClick: handleCustomizeClick( '/wp-admin/site-editor.php?path=%2Fwp_global_styles' ),
		},
		{
			label: __( 'Patterns' ),
			icon: symbolFilled,
			onClick: handleCustomizeClick( '/wp-admin/site-editor.php?path=%2Fpatterns' ),
		},
		{
			label: __( 'Navigation' ),
			icon: navigation,
			onClick: handleCustomizeClick( '/wp-admin/site-editor.php?path=%2Fnavigation' ),
		},
		{
			label: __( 'Templates' ),
			icon: layout,
			onClick: handleCustomizeClick( '/wp-admin/site-editor.php?path=%2Fwp_template' ),
		},
		{
			label: __( 'Pages' ),
			icon: page,
			onClick: handleCustomizeClick( '/wp-admin/site-editor.php?path=%2Fpage' ),
		},
	];

	const classicThemeButtons: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: __( 'Customizer' ),
			icon: pencil,
			onClick: handleCustomizeClick( '/wp-admin/customize.php' ),
		},
	];

	if ( themeDetails?.supportsMenus ) {
		classicThemeButtons.push( {
			label: __( 'Menus' ),
			icon: navigation,
			onClick: handleCustomizeClick( '/wp-admin/nav-menus.php' ),
		} );
	}

	if ( themeDetails?.supportsWidgets ) {
		classicThemeButtons.push( {
			label: __( 'Widgets' ),
			icon: widget,
			onClick: handleCustomizeClick( '/wp-admin/widgets.php' ),
		} );
	}

	const buttonsArray = themeDetails?.isBlockTheme ? blockThemeButtons : classicThemeButtons;

	const processedButtons = buttonsArray.map( ( button ) => ( {
		...button,
		disabled: isLoading,
	} ) );

	const sectionHeading = __( 'Customize' );

	return loading ? (
		<ButtonSectionSkeleton title={ sectionHeading } />
	) : (
		<ButtonsSection buttonsArray={ processedButtons } title={ sectionHeading } />
	);
}

function ShortcutsSection( { selectedSite }: Pick< ContentTabOverviewProps, 'selectedSite' > ) {
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();

	const buttonsArray: ButtonsSectionProps[ 'buttonsArray' ] = [
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
	return <ButtonsSection buttonsArray={ buttonsArray } title={ __( 'Open in…' ) } />;
}

function PublishBanner( {
	selectedSite: _selectedSite,
}: Pick< ContentTabOverviewProps, 'selectedSite' > ) {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const { setSelectedTab } = useContentTabs();
	const { connectedSites } = useConnectedSitesData();

	const handlePublishClick = () => {
		// Navigate to Sync tab and open modal with 'push' mode
		setSelectedTab( 'sync' );
		dispatch( connectedSitesActions.openModal( 'push' ) );
	};

	// Only show banner if site has no connected sites
	if ( connectedSites.length > 0 ) {
		return null;
	}

	return (
		<div className="w-full flex items-center gap-3 px-4 py-3 rounded-sm bg-a8c-blue/[4%] border border-black/10">
			<Icon icon={ info } size={ 20 } className="text-a8c-blue-50 flex-shrink-0" />
			{ createInterpolateElement(
				__( '<span>Ready to go live?</span> <button>Publish site</button>' ),
				{
					span: <span className="flex-1 text-gray-900" />,
					button: <Button variant="primary" onClick={ handlePublishClick } disabled={ false } />,
				}
			) }
		</div>
	);
}

export function ContentTabOverview( { selectedSite }: ContentTabOverviewProps ) {
	const [ isThumbnailError, setIsThumbnailError ] = useState( false );
	const { __ } = useI18n();
	const { startServer, loadingServer } = useSiteDetails();
	const {
		selectedThemeDetails: themeDetails,
		selectedThumbnail: thumbnailData,
		selectedLoadingThemeDetails: loadingThemeDetails,
		selectedLoadingThumbnails: loadingThumbnails,
		initialLoading,
	} = useThemeDetails();

	const loading = loadingThemeDetails || loadingThumbnails || initialLoading;
	const isServerLoading = loadingServer[ selectedSite.id ];

	const handleThumbnailClick = async () => {
		if ( isServerLoading ) return;

		if ( ! selectedSite.running ) {
			await startServer( selectedSite.id );
		}
		getIpcApi().openSiteURL( selectedSite.id, '', { autoLogin: false } );
	};

	const thumbnailImage = (
		<img
			onError={ () => setIsThumbnailError( true ) }
			onLoad={ () => setIsThumbnailError( false ) }
			className={ ! isThumbnailError ? 'w-full h-full' : 'absolute invisible' }
			src={ thumbnailData || '' }
			alt={ themeDetails?.name }
		/>
	);

	return (
		<div className="p-8 flex max-w-4xl">
			<div className="w-52 ltr:mr-8 rtl:ml-8 flex-col justify-start items-start gap-8">
				<h2 className="mb-3 a8c-subtitle-small">{ __( 'Theme' ) }</h2>
				<div
					className={ cx(
						'w-full min-h-40 max-h-64 rounded-sm border border-a8c-gray-5 bg-a8c-gray-0 mb-2 flex justify-center',
						loading && `h-64 ${ skeletonBg }`,
						isThumbnailError && 'border-none',
						! loading && 'hover:border-a8c-blue-50 duration-300'
					) }
				>
					{ isThumbnailError && ! loading && (
						<div className="flex items-center justify-center w-full h-64 leading-5 text-a8c-gray-50">
							{ __( 'Preview unavailable' ) }
						</div>
					) }
					{ ! loading && (
						<button
							aria-label={ __( 'Open site' ) }
							className={ cx(
								'relative group focus-visible:outline-a8c-blue-50',
								isServerLoading && 'cursor-not-allowed'
							) }
							onClick={ handleThumbnailClick }
							disabled={ isServerLoading }
						>
							<div
								className={
									'opacity-0 group-hover:opacity-90 group-hover:bg-white group-focus:opacity-90 group-focus:bg-white duration-300 absolute size-full flex justify-center items-center bg-white text-a8c-blue-50'
								}
							>
								{ __( 'Open site' ) }
								<ArrowIcon />
							</div>
							{ thumbnailImage }
						</button>
					) }
				</div>
				<div className="flex justify-between items-center w-full">
					{ loading && <div className={ `w-[100px] min-h-4 ${ skeletonBg }` }></div> }
					{ ! loading && ! isThumbnailError && <p>{ themeDetails?.name }</p> }
				</div>
			</div>
			<div className="flex flex-1 flex-col justify-start items-start gap-8">
				<PublishBanner selectedSite={ selectedSite } />
				<CustomizeSection
					selectedSite={ selectedSite }
					themeDetails={ themeDetails }
					loading={ loading }
				/>
				<ShortcutsSection selectedSite={ selectedSite } />
			</div>
		</div>
	);
}
