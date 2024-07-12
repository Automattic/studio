import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import {
	archive,
	code,
	desktop,
	edit,
	external,
	Icon,
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
import { useCheckInstalledApps } from '../hooks/use-check-installed-apps';
import { useFeatureFlags } from '../hooks/use-feature-flags';
import { useThemeDetails } from '../hooks/use-theme-details';
import { isMac } from '../lib/app-globals';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import { ButtonsSection, ButtonsSectionProps } from './buttons-section';

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
	const blockThemeButtons: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: __( 'Site Editor' ),
			icon: desktop,
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php' );
			},
		},
		{
			label: __( 'Styles' ),
			icon: styles,
			onClick: () => {
				getIpcApi().openSiteURL(
					selectedSite.id,
					'/wp-admin/site-editor.php?path=%2Fwp_global_styles'
				);
			},
		},
		{
			label: __( 'Patterns' ),
			icon: symbolFilled,
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php?path=%2Fpatterns' );
			},
		},
		{
			label: __( 'Navigation' ),
			icon: navigation,
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php?path=%2Fnavigation' );
			},
		},
		{
			label: __( 'Templates' ),
			icon: layout,
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php?path=%2Fwp_template' );
			},
		},
		{
			label: __( 'Pages' ),
			icon: page,
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php?path=%2Fpage' );
			},
		},
	];

	const classicThemeButtons: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: __( 'Customizer' ),
			icon: edit,
			onClick: () => getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/customize.php' ),
		},
	];

	if ( themeDetails?.supportsMenus ) {
		classicThemeButtons.push( {
			label: __( 'Menus' ),
			icon: navigation,
			onClick: () => getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/nav-menus.php' ),
		} );
	}

	if ( themeDetails?.supportsWidgets ) {
		classicThemeButtons.push( {
			label: __( 'Widgets' ),
			icon: widget,
			onClick: () => getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/widgets.php' ),
		} );
	}

	const buttonsArray = themeDetails?.isBlockTheme ? blockThemeButtons : classicThemeButtons;

	const processedButtons = buttonsArray.map( ( button ) => ( {
		...button,
		disabled: ! selectedSite.running,
	} ) );

	const sectionHeading = __( 'Customize' );

	return loading ? (
		<ButtonSectionSkeleton title={ sectionHeading } />
	) : (
		<ButtonsSection buttonsArray={ processedButtons } title={ sectionHeading } />
	);
}

function ShortcutsSection( { selectedSite }: Pick< ContentTabOverviewProps, 'selectedSite' > ) {
	const { terminalWpCliEnabled } = useFeatureFlags();
	const installedApps = useCheckInstalledApps();
	const buttonsArray: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: isMac()
				? // translators: name of app used to navigate files and folders on macOS
				  __( 'Finder' )
				: // translators: name of app used to navigate files and folders on Windows
				  __( 'File explorer' ),
			className: 'text-nowrap',
			icon: archive,
			onClick: () => {
				getIpcApi().openLocalPath( selectedSite.path );
			},
		},
	];
	if ( installedApps.vscode ) {
		// Use VS Code as a default even if none of the editors are installed
		buttonsArray.push( {
			label:
				// translators: "VS Code" is the brand name for an IDE and does not need to be translated
				__( 'VS Code' ),
			className: 'text-nowrap',
			icon: code,
			onClick: async () => {
				try {
					await getIpcApi().openURL( `vscode://file/${ selectedSite.path }?windowId=_blank` );
				} catch ( error ) {
					Sentry.captureException( error );
					alert(
						// translators: "VS Code" is the brand name for an IDE and does not need to be translated
						__(
							"Could not open the site code in VS Code. Please check if it's installed correctly."
						)
					);
				}
			},
		} );
	} else if ( installedApps.phpstorm ) {
		buttonsArray.push( {
			label:
				// translators: "PhpStorm" is the brand name for an IDE and does not need to be translated
				__( 'PhpStorm' ),
			className: 'text-nowrap',
			icon: code,
			onClick: async () => {
				try {
					await getIpcApi().openURL( `phpstorm://open?file=${ selectedSite.path }` );
				} catch ( error ) {
					Sentry.captureException( error );
					alert(
						// translators: "PhpStorm" is the brand name for an IDE and does not need to be translated
						__(
							"Could not open the site code in PhpStorm. Please check if it's installed correctly."
						)
					);
				}
			},
		} );
	}
	buttonsArray.push( {
		label: __( 'Terminal' ),
		className: 'text-nowrap',
		icon: preformatted,
		onClick: async () => {
			try {
				await getIpcApi().openTerminalAtPath( selectedSite.path, {
					wpCliEnabled: terminalWpCliEnabled,
				} );
			} catch ( error ) {
				Sentry.captureException( error );
				alert( __( 'Could not open the terminal.' ) );
			}
		},
	} );
	return <ButtonsSection buttonsArray={ buttonsArray } title={ __( 'Open in…' ) } />;
}

export function ContentTabOverview( { selectedSite }: ContentTabOverviewProps ) {
	const [ isThumbnailError, setIsThumbnailError ] = useState( false );
	const { __ } = useI18n();
	const {
		selectedThemeDetails: themeDetails,
		selectedThumbnail: thumbnailData,
		selectedLoadingThemeDetails: loadingThemeDetails,
		selectedLoadingThumbnails: loadingThumbnails,
		initialLoading,
	} = useThemeDetails();

	const loading = loadingThemeDetails || loadingThumbnails || initialLoading;
	const siteRunning = selectedSite.running;

	return (
		<div className="p-8 flex max-w-3xl">
			<div className="w-52 ltr:mr-8 rtl:ml-8 flex-col justify-start items-start gap-8">
				<h2 className="mb-3 a8c-subtitle-small">{ __( 'Theme' ) }</h2>
				<div
					className={ cx(
						'w-full min-h-40 max-h-64 rounded-sm border border-a8c-gray-5 bg-a8c-gray-0 mb-2 flex justify-center',
						loading && skeletonBg,
						isThumbnailError && 'border-none',
						siteRunning && 'hover:border-a8c-blueberry duration-300'
					) }
				>
					{ isThumbnailError && ! loading && (
						<div className="flex items-center justify-center w-full h-64 leading-5 text-a8c-gray-50">
							{ __( 'Preview unavailable' ) }
						</div>
					) }
					{ ! loading && siteRunning && (
						<button
							aria-label={ __( 'Open site' ) }
							className={ cx( `relative group focus-visible:outline-a8c-blueberry` ) }
							onClick={ () => getIpcApi().openSiteURL( selectedSite.id ) }
						>
							<div
								className={ cx(
									`opacity-0 group-hover:opacity-90 group-hover:bg-white duration-300 absolute size-full flex justify-center items-center bg-white text-a8c-blueberry`
								) }
							>
								{ __( 'Open site' ) }
								<Icon
									icon={ external }
									className="ltr:ml-0.5 rtl:mr-0.5 rtl:scale-x-[-1] fill-a8c-blueberry"
									size={ 14 }
								/>
							</div>
							<img
								onError={ () => setIsThumbnailError( true ) }
								onLoad={ () => setIsThumbnailError( false ) }
								className={ ! isThumbnailError ? 'w-full h-full' : 'absolute invisible' }
								src={ thumbnailData || '' }
								alt={ themeDetails?.name }
							/>
						</button>
					) }
					{ ! loading && ! siteRunning && (
						<img
							onError={ () => setIsThumbnailError( true ) }
							onLoad={ () => setIsThumbnailError( false ) }
							className={ ! isThumbnailError ? 'w-full h-full' : 'absolute invisible' }
							src={ thumbnailData || '' }
							alt={ themeDetails?.name }
						/>
					) }
				</div>
				<div className="flex justify-between items-center w-full">
					{ loading && <div className={ `w-[100px] min-h-4 ${ skeletonBg }` }></div> }
					{ ! loading && ! isThumbnailError && <p>{ themeDetails?.name }</p> }
				</div>
			</div>
			<div className="flex flex-1 flex-col justify-start items-start gap-8">
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
