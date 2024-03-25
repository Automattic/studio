import * as Sentry from '@sentry/electron/renderer';
import { __, sprintf } from '@wordpress/i18n';
import {
	archive,
	code,
	desktop,
	edit,
	layout,
	navigation,
	page,
	styles,
	symbolFilled,
	widget,
} from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { useCheckInstalledApps } from '../hooks/use-check-installed-apps';
import { useThemeDetails } from '../hooks/use-theme-details';
import { isMac } from '../lib/app-globals';
import { cx } from '../lib/cx';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { ButtonsSection, ButtonsSectionProps } from './buttons-section';

interface ContentTabOverviewProps {
	selectedSite: SiteDetails;
}

function CustomizeSection( {
	selectedSite,
	themeDetails,
}: Pick< ContentTabOverviewProps, 'selectedSite' > & {
	themeDetails?: SiteDetails[ 'themeDetails' ];
} ) {
	const blockThemeButtons: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: __( 'Site Editor' ),
			icon: desktop,
			className: 'cursor-pointer',
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php' );
			},
		},
		{
			label: __( 'Styles' ),
			icon: styles,
			className: 'cursor-pointer',
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
			className: 'cursor-pointer',
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php?path=%2Fpatterns' );
			},
		},
		{
			label: __( 'Navigation' ),
			icon: navigation,
			className: 'cursor-pointer',
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php?path=%2Fnavigation' );
			},
		},
		{
			label: __( 'Templates' ),
			icon: layout,
			className: 'cursor-pointer',
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php?path=%2Fwp_template' );
			},
		},
		{
			label: __( 'Pages' ),
			icon: page,
			className: 'cursor-pointer',
			onClick: () => {
				getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/site-editor.php?path=%2Fpage' );
			},
		},
	];

	const classicThemeButtons: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: __( 'Customizer' ),
			icon: edit,
			className: 'cursor-pointer',
			onClick: () => getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/customize.php' ),
		},
	];

	if ( themeDetails?.supportsMenus ) {
		classicThemeButtons.push( {
			label: __( 'Menus' ),
			icon: navigation,
			className: 'cursor-pointer',
			onClick: () => getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/nav-menus.php' ),
		} );
	}

	if ( themeDetails?.supportsWidgets ) {
		classicThemeButtons.push( {
			label: __( 'Widgets' ),
			icon: widget,
			className: 'cursor-pointer',
			onClick: () => getIpcApi().openSiteURL( selectedSite.id, '/wp-admin/widgets.php' ),
		} );
	}

	const buttonsArray = themeDetails?.isBlockTheme ? blockThemeButtons : classicThemeButtons;

	const processedButtons = buttonsArray.map( ( button ) => ( {
		...button,
		disabled: ! selectedSite.running,
	} ) );

	return <ButtonsSection buttonsArray={ processedButtons } title={ __( 'Customize' ) } />;
}

function ShortcutsSection( { selectedSite }: Pick< ContentTabOverviewProps, 'selectedSite' > ) {
	const installedApps = useCheckInstalledApps();
	const buttonsArray: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: isMac() ? __( 'Finder' ) : __( 'File explorer' ),
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
			label: __( 'VS Code' ),
			className: 'text-nowrap',
			icon: code,
			onClick: async () => {
				try {
					await getIpcApi().openURL( `vscode://file/${ selectedSite.path }?windowId=_blank` );
				} catch ( error ) {
					Sentry.captureException( error );
					alert(
						sprintf(
							__( "Could not open the site code in %s. Please check if it's installed correctly." ),
							'VS Code'
						)
					);
				}
			},
		} );
	} else if ( installedApps.phpstorm ) {
		buttonsArray.push( {
			label: __( 'PhpStorm' ),
			className: 'text-nowrap',
			icon: code,
			onClick: async () => {
				try {
					await getIpcApi().openURL( `phpstorm://open?file=${ selectedSite.path }` );
				} catch ( error ) {
					Sentry.captureException( error );
					alert(
						sprintf(
							__( "Could not open the site code in %s. Please check if it's installed correctly." ),
							'PhpStorm'
						)
					);
				}
			},
		} );
	}
	return <ButtonsSection buttonsArray={ buttonsArray } title={ __( 'Open in…' ) } />;
}

export function ContentTabOverview( { selectedSite }: ContentTabOverviewProps ) {
	const [ isThumbnailError, setIsThumbnailError ] = useState( false );
	const { __ } = useI18n();
	const themeDetails = useThemeDetails( selectedSite );

	return (
		<div className="pb-10 flex">
			<div className="w-52 mr-8 flex-col justify-start items-start gap-8">
				<div className="mb-3 a8c-subtitle-small">{ __( 'Theme' ) }</div>
				<div
					className={ cx(
						'w-full h-60 rounded-sm border border-a8c-gray-5 bg-a8c-gray-0 mb-2 flex items-center justify-center',
						isThumbnailError && 'border-none'
					) }
				>
					{ isThumbnailError && (
						<div className="flex items-center justify-center w-full h-full leading-5 text-a8c-gray-50">
							{ __( 'Preview unavailable' ) }
						</div>
					) }
					<img
						onError={ () => setIsThumbnailError( true ) }
						onLoad={ () => setIsThumbnailError( false ) }
						className={ ! isThumbnailError ? 'w-full h-full' : 'absolute invisible' }
						src={ themeDetails?.thumbnailData || '' }
						alt={ themeDetails?.name }
					/>
				</div>
				{ ! isThumbnailError && (
					<div className="flex justify-between items-center w-full">
						<Button className="!px-0">{ themeDetails?.name }</Button>
					</div>
				) }
			</div>
			<div className="flex flex-1 flex-col justify-start items-start gap-8">
				<CustomizeSection selectedSite={ selectedSite } themeDetails={ themeDetails } />
				<ShortcutsSection selectedSite={ selectedSite } />
			</div>
		</div>
	);
}
