import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import {
	archive,
	code,
	desktop,
	navigation,
	preformatted,
	styles,
	symbolFilled,
	layout,
	page,
} from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { ArrowIcon } from 'src/components/arrow-icon';
import { ButtonsSection } from 'src/components/buttons-section';
import { isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';
import { useVipContext } from './vip-context';
import type { VipEnvironment } from '../types';
import type { ButtonsSectionProps } from 'src/components/buttons-section';

interface VipContentTabOverviewProps {
	selectedEnvironment: VipEnvironment;
}

function CustomizeSection( {
	selectedEnvironment,
}: Pick< VipContentTabOverviewProps, 'selectedEnvironment' > ) {
	const { loadingEnvironments, startEnvironment } = useVipContext();
	const isLoading = loadingEnvironments[ selectedEnvironment.slug ] ?? false;

	const handleCustomizeClick = ( path: string ) => async () => {
		if ( isLoading ) return;
		if ( ! selectedEnvironment.running ) {
			await startEnvironment( selectedEnvironment.slug );
		}
		if ( selectedEnvironment.urls.length > 0 ) {
			const baseUrl = selectedEnvironment.urls[ 0 ];
			let url: string;
			if ( selectedEnvironment.autologinKey ) {
				const redirectTo = encodeURIComponent( path );
				url = `${ baseUrl }wp-login.php?vip-autologin=${ selectedEnvironment.autologinKey }&redirect_to=${ redirectTo }`;
			} else {
				url = `${ baseUrl }${ path.startsWith( '/' ) ? path.slice( 1 ) : path }`;
			}
			getIpcApi().openURL( url );
		}
	};

	const blockThemeButtons: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: __( 'Site Editor' ),
			icon: desktop,
			onClick: handleCustomizeClick( '/wp-admin/site-editor.php' ),
			disabled: isLoading,
		},
		{
			label: __( 'Styles' ),
			icon: styles,
			onClick: handleCustomizeClick( '/wp-admin/site-editor.php?path=%2Fwp_global_styles' ),
			disabled: isLoading,
		},
		{
			label: __( 'Patterns' ),
			icon: symbolFilled,
			onClick: handleCustomizeClick( '/wp-admin/site-editor.php?path=%2Fpatterns' ),
			disabled: isLoading,
		},
		{
			label: __( 'Navigation' ),
			icon: navigation,
			onClick: handleCustomizeClick( '/wp-admin/site-editor.php?path=%2Fnavigation' ),
			disabled: isLoading,
		},
		{
			label: __( 'Templates' ),
			icon: layout,
			onClick: handleCustomizeClick( '/wp-admin/site-editor.php?path=%2Fwp_template' ),
			disabled: isLoading,
		},
		{
			label: __( 'Pages' ),
			icon: page,
			onClick: handleCustomizeClick( '/wp-admin/site-editor.php?path=%2Fpage' ),
			disabled: isLoading,
		},
	];

	return <ButtonsSection buttonsArray={ blockThemeButtons } title={ __( 'Customize' ) } />;
}

function ShortcutsSection( {
	selectedEnvironment,
}: Pick< VipContentTabOverviewProps, 'selectedEnvironment' > ) {
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();

	const filePath = selectedEnvironment.appCodePath || selectedEnvironment.path;

	const buttonsArray: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: isWindows() ? __( 'File Explorer' ) : __( 'Finder' ),
			className: 'text-nowrap',
			icon: archive,
			onClick: () => {
				if ( filePath ) {
					getIpcApi().openLocalPath( filePath );
				}
			},
			disabled: ! filePath,
		},
	];

	const editorConfig = editor ? supportedEditorConfig[ editor ] : false;
	if ( editor && editorConfig ) {
		buttonsArray.push( {
			label: editorConfig.label,
			className: 'text-nowrap',
			icon: code,
			onClick: async () => {
				if ( filePath ) {
					await getIpcApi().openAppAtPath( editor, filePath );
				}
			},
			disabled: ! filePath,
		} );
	}

	const terminalName = getTerminalName( terminal );
	buttonsArray.push( {
		label: terminalName,
		className: 'text-nowrap',
		icon: preformatted,
		onClick: async () => {
			if ( filePath ) {
				try {
					await getIpcApi().openTerminalAtPath( filePath );
				} catch ( error ) {
					Sentry.captureException( error );
					alert( __( 'Could not open the terminal.' ) );
				}
			}
		},
		disabled: ! filePath,
	} );

	return <ButtonsSection buttonsArray={ buttonsArray } title={ __( 'Open in…' ) } />;
}

function ServicesSection( {
	selectedEnvironment,
}: Pick< VipContentTabOverviewProps, 'selectedEnvironment' > ) {
	const { __ } = useI18n();

	const phpMyAdminUrl = selectedEnvironment.phpmyadmin
		? `http://${ selectedEnvironment.slug }-phpmyadmin.vipdev.lndo.site/`
		: null;
	const mailpitUrl = selectedEnvironment.mailpit
		? `http://${ selectedEnvironment.slug }-mailpit.vipdev.lndo.site/`
		: null;

	const services = [
		{ name: __( 'Elasticsearch' ), enabled: selectedEnvironment.elasticsearch, url: null },
		{ name: __( 'phpMyAdmin' ), enabled: selectedEnvironment.phpmyadmin, url: phpMyAdminUrl },
		{ name: __( 'Xdebug' ), enabled: selectedEnvironment.xdebug, url: null },
		{ name: __( 'Mailpit' ), enabled: selectedEnvironment.mailpit, url: mailpitUrl },
	];

	const enabledServices = services.filter( ( s ) => s.enabled );

	if ( enabledServices.length === 0 ) {
		return null;
	}

	const handleServiceClick = ( url: string | null ) => {
		if ( url && selectedEnvironment.running ) {
			getIpcApi().openURL( url );
		}
	};

	return (
		<div className="w-full max-w-96">
			<h2 className="a8c-subtitle-small mb-3">{ __( 'Services' ) }</h2>
			<div className="flex flex-wrap gap-2">
				{ enabledServices.map( ( service ) => {
					const isClickable = service.url && selectedEnvironment.running;
					return isClickable ? (
						<button
							type="button"
							key={ service.name }
							onClick={ () => handleServiceClick( service.url ) }
							className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-a8c-blueberry-5 text-a8c-blueberry-70 hover:bg-a8c-blueberry-10 transition-colors cursor-pointer"
						>
							{ service.name }
							<span className="ml-1 opacity-70">↗</span>
						</button>
					) : (
						<span
							key={ service.name }
							className={ cx(
								'inline-flex items-center px-2.5 py-1 rounded text-xs font-medium',
								service.url && ! selectedEnvironment.running
									? 'bg-a8c-gray-5 text-a8c-gray-50'
									: 'bg-a8c-gray-0 text-a8c-gray-70'
							) }
							title={
								service.url && ! selectedEnvironment.running
									? __( 'Start the environment to access this service' )
									: undefined
							}
						>
							{ service.name }
						</span>
					);
				} ) }
			</div>
		</div>
	);
}

export function VipContentTabOverview( { selectedEnvironment }: VipContentTabOverviewProps ) {
	const { __ } = useI18n();
	const { loadingEnvironments, startEnvironment } = useVipContext();
	const isLoading = loadingEnvironments[ selectedEnvironment.slug ] ?? false;

	const handleThumbnailClick = async () => {
		if ( isLoading ) return;
		if ( ! selectedEnvironment.running ) {
			await startEnvironment( selectedEnvironment.slug );
		}
		if ( selectedEnvironment.urls.length > 0 ) {
			getIpcApi().openURL( selectedEnvironment.urls[ 0 ] );
		}
	};

	return (
		<div className="p-8 flex max-w-4xl">
			{ /* Left column: Site preview / VIP badge */ }
			<div className="w-52 ltr:mr-8 rtl:ml-8 flex-col justify-start items-start gap-8">
				<h2 className="mb-3 a8c-subtitle-small">{ __( 'Site' ) }</h2>
				<div
					className={ cx(
						'w-full min-h-40 max-h-64 rounded-sm border border-a8c-gray-5 bg-a8c-gray-0 mb-2 flex justify-center items-center',
						! isLoading && 'hover:border-a8c-blue-50 duration-300'
					) }
				>
					<button
						type="button"
						aria-label={ __( 'Open site' ) }
						className={ cx(
							'w-full h-40 relative group focus-visible:outline-a8c-blue-50',
							isLoading && 'cursor-not-allowed'
						) }
						onClick={ () => {
							void handleThumbnailClick();
						} }
						disabled={ isLoading }
					>
						<div className="opacity-0 group-hover:bg-white group-focus:bg-white duration-300 absolute size-full flex justify-center items-center bg-white text-a8c-blue-50 group-hover:opacity-90 group-focus:opacity-90">
							{ __( 'Open site' ) }
							<ArrowIcon />
						</div>
						<div className="flex flex-col w-full h-full items-center justify-center text-a8c-gray-50">
							<div className="text-2xl font-bold text-a8c-blueberry-50 mb-1">VIP</div>
							<div className="text-xs">
								{ selectedEnvironment.running ? __( 'Running' ) : __( 'Stopped' ) }
							</div>
						</div>
					</button>
				</div>
				<div className="flex justify-between items-center w-full">
					<p className="text-sm text-a8c-gray-70">
						{ __( 'WordPress' ) } { selectedEnvironment.wordpressVersion }
					</p>
				</div>
			</div>

			{ /* Right column: Customize + Shortcuts + Services */ }
			<div className="flex flex-1 flex-col justify-start items-start gap-8">
				<CustomizeSection selectedEnvironment={ selectedEnvironment } />
				<ShortcutsSection selectedEnvironment={ selectedEnvironment } />
				<ServicesSection selectedEnvironment={ selectedEnvironment } />
			</div>
		</div>
	);
}
