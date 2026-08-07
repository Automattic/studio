import * as Sentry from '@sentry/electron/renderer';
import {
	TRACKS_EVENTS,
	type TracksCustomizeEntryPoint,
} from '@studio/common/lib/record-tracks-event';
import { __ } from '@wordpress/i18n';
import {
	archive,
	code,
	desktop,
	grid,
	pencil,
	layout,
	navigation,
	page,
	preformatted,
	styles,
	symbolFilled,
	widget,
} from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useEffect, useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import { ButtonsSection, ButtonsSectionProps } from 'src/components/buttons-section';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useThemeDetails } from 'src/hooks/use-theme-details';
import { recordRendererTracksEvent } from 'src/lib/analytics';
import { cx } from 'src/lib/cx';
import { getFileManagerLabel } from 'src/lib/file-manager';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';

interface ContentTabOverviewProps {
	selectedSite: SiteDetails;
}

const ButtonSectionSkeleton = ( { title }: { title: string } ) => {
	return (
		<div className="w-full max-w-96">
			<h2 className="a8c-subtitle-small mb-3">{ title }</h2>
			<div className="w-full h-20 my-1 skeleton-bg"></div>
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

	const handleCustomizeClick =
		( url: string, entryPoint: TracksCustomizeEntryPoint ) => async () => {
			if ( isLoading ) return;
			recordRendererTracksEvent( TRACKS_EVENTS.SITE_OPEN_CUSTOMIZE, {
				entry_point: entryPoint,
				browser: 'external',
			} );
			if ( ! selectedSite.running ) {
				await startServer( selectedSite );
			}
			getIpcApi().openSiteURL( selectedSite.id, url );
		};

	const blockThemeButtons: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: __( 'Site Editor' ),
			icon: desktop,
			onClick: handleCustomizeClick( '/wp-admin/site-editor.php', 'editor' ),
		},
		{
			label: __( 'Styles' ),
			icon: styles,
			onClick: handleCustomizeClick(
				'/wp-admin/site-editor.php?path=%2Fwp_global_styles',
				'editor_styles'
			),
		},
		{
			label: __( 'Patterns' ),
			icon: symbolFilled,
			onClick: handleCustomizeClick(
				'/wp-admin/site-editor.php?path=%2Fpatterns',
				'editor_patterns'
			),
		},
		{
			label: __( 'Navigation' ),
			icon: navigation,
			onClick: handleCustomizeClick(
				'/wp-admin/site-editor.php?path=%2Fnavigation',
				'editor_navigation'
			),
		},
		{
			label: __( 'Templates' ),
			icon: layout,
			onClick: handleCustomizeClick(
				'/wp-admin/site-editor.php?path=%2Fwp_template',
				'editor_templates'
			),
		},
		{
			label: __( 'Pages' ),
			icon: page,
			onClick: handleCustomizeClick( '/wp-admin/site-editor.php?path=%2Fpage', 'editor_pages' ),
		},
	];

	const classicThemeButtons: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: __( 'Customizer' ),
			icon: pencil,
			onClick: handleCustomizeClick( '/wp-admin/customize.php', 'customizer' ),
		},
	];

	if ( themeDetails?.supportsMenus ) {
		classicThemeButtons.push( {
			label: __( 'Menus' ),
			icon: navigation,
			onClick: handleCustomizeClick( '/wp-admin/nav-menus.php', 'menus' ),
		} );
	}

	if ( themeDetails?.supportsWidgets ) {
		classicThemeButtons.push( {
			label: __( 'Widgets' ),
			icon: widget,
			onClick: handleCustomizeClick( '/wp-admin/widgets.php', 'widgets' ),
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
	const { startServer, loadingServer } = useSiteDetails();
	const isServerLoading = loadingServer[ selectedSite.id ];

	const buttonsArray: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: getFileManagerLabel(),
			className: 'text-nowrap',
			icon: archive,
			onClick: () => {
				recordRendererTracksEvent( TRACKS_EVENTS.SITE_OPEN_FOLDER );
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
				recordRendererTracksEvent( TRACKS_EVENTS.SITE_OPEN_IN_EDITOR, { editor } );
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
			recordRendererTracksEvent( TRACKS_EVENTS.SITE_OPEN_PHPMYADMIN, { browser: 'external' } );
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

	useEffect( () => {
		setIsThumbnailError( false );
	}, [ thumbnailData ] );

	const handleThumbnailClick = async () => {
		if ( isServerLoading ) return;

		recordRendererTracksEvent( TRACKS_EVENTS.SITE_OPEN_IN_BROWSER, { browser: 'external' } );
		if ( ! selectedSite.running ) {
			await startServer( selectedSite );
		}
		getIpcApi().openSiteURL( selectedSite.id, '', { autoLogin: false } );
	};

	return (
		<div className="p-8 flex max-w-4xl">
			<div className="w-52 ltr:mr-8 rtl:ml-8 flex-col justify-start items-start gap-8">
				<h2 className="mb-3 a8c-subtitle-small">{ __( 'Theme' ) }</h2>
				<div
					className={ cx(
						'w-full min-h-40 max-h-64 rounded-sm border border-frame-border bg-frame-surface mb-2 flex justify-center',
						loading && 'h-64 skeleton-bg',
						isThumbnailError && 'border-none',
						! loading && 'hover:border-frame-theme duration-300'
					) }
				>
					{ ! loading && (
						<button
							aria-label={ __( 'Open site' ) }
							className={ cx(
								'w-full relative group focus-visible:outline-frame-theme',
								isServerLoading && 'cursor-not-allowed'
							) }
							onClick={ handleThumbnailClick }
							disabled={ isServerLoading }
						>
							<div
								className={ cx(
									'opacity-0 group-hover:bg-frame group-focus:bg-frame duration-300 absolute size-full flex justify-center items-center bg-frame text-frame-theme',
									isThumbnailError
										? 'group-hover:opacity-100 group-focus:opacity-100'
										: 'group-hover:opacity-90 group-focus:opacity-90'
								) }
							>
								{ __( 'Open site' ) }
								<ArrowIcon />
							</div>
							{ isThumbnailError ? (
								<div className="flex w-full items-center justify-center h-64 leading-5 text-frame-text-secondary text-center">
									{ __( 'Preview unavailable' ) }
								</div>
							) : (
								<img
									onError={ () => setIsThumbnailError( true ) }
									onLoad={ () => setIsThumbnailError( false ) }
									className="w-full h-full"
									src={ thumbnailData || '' }
									alt={ themeDetails?.name }
								/>
							) }
						</button>
					) }
				</div>
				<div className="flex justify-between items-center w-full">
					{ loading && <div className="w-[100px] min-h-4 skeleton-bg"></div> }
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
