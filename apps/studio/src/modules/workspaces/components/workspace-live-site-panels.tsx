import { sprintf, __ } from '@wordpress/i18n';
import {
	desktop,
	layout,
	navigation,
	page,
	pencil,
	styles,
	symbolFilled,
	widget,
} from '@wordpress/icons';
import { useEffect, useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import { ButtonsSection, ButtonsSectionProps } from 'src/components/buttons-section';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import {
	useGetActiveWpcomThemeQuery,
	useGetWpcomSiteSettingsQuery,
	type WpcomSiteSettings,
} from 'src/stores/sync/wpcom-sites';
import type { RemoteTarget } from 'src/modules/workspaces/types';

function resolveLiveSiteUrl( siteUrl: string, path = '' ) {
	try {
		return new URL( path, siteUrl ).toString();
	} catch {
		return siteUrl;
	}
}

function getMshotsUrl( siteUrl: string ) {
	return `https://s0.wp.com/mshots/v1/${ encodeURIComponent( siteUrl ) }?w=600&h=800`;
}

function getTargetLabel( target: RemoteTarget ) {
	return target.id === 'production' ? __( 'Production' ) : __( 'Staging' );
}

function getSettingString(
	settings: WpcomSiteSettings | undefined,
	key: string
): string | undefined {
	const value = settings?.settings[ key ];
	return typeof value === 'string' && value ? value : undefined;
}

function getSettingNumber(
	settings: WpcomSiteSettings | undefined,
	key: string
): number | undefined {
	const value = settings?.settings[ key ];
	if ( typeof value === 'number' ) {
		return value;
	}
	if ( typeof value === 'string' && value.trim() !== '' ) {
		const parsed = Number( value );
		return Number.isFinite( parsed ) ? parsed : undefined;
	}
	return undefined;
}

function getBooleanLikeLabel( value: unknown ) {
	if ( value === true || value === 1 || value === '1' ) {
		return __( 'Enabled' );
	}
	if ( value === false || value === 0 || value === '0' ) {
		return __( 'Disabled' );
	}
	return undefined;
}

function formatVisibility( settings: WpcomSiteSettings | undefined ) {
	const visibility = settings?.settings.blog_public;
	if ( visibility === -1 || visibility === '-1' ) {
		return __( 'Private' );
	}
	if ( visibility === 0 || visibility === '0' ) {
		return __( 'Discourage search engines' );
	}
	if ( visibility === 1 || visibility === '1' ) {
		return __( 'Public' );
	}
	return undefined;
}

function formatHomepage( settings: WpcomSiteSettings | undefined ) {
	const showOnFront = getSettingString( settings, 'show_on_front' );
	if ( showOnFront === 'page' ) {
		const pageOnFront = getSettingNumber( settings, 'page_on_front' );
		if ( pageOnFront ) {
			return sprintf(
				/* translators: %d is a WordPress page ID. */
				__( 'Static page, page ID %d' ),
				pageOnFront
			);
		}
		return __( 'Static page' );
	}
	if ( showOnFront === 'posts' ) {
		return __( 'Latest posts' );
	}
	return undefined;
}

function formatTimezone( settings: WpcomSiteSettings | undefined ) {
	const timezone = getSettingString( settings, 'timezone_string' );
	if ( timezone ) {
		return timezone;
	}
	const offset = getSettingNumber( settings, 'gmt_offset' );
	if ( offset !== undefined ) {
		return sprintf(
			/* translators: %s is a numeric UTC offset, for example -5 or 5.5. */
			__( 'UTC%s' ),
			offset >= 0 ? `+${ offset }` : String( offset )
		);
	}
	return undefined;
}

function SettingsRow( { label, value }: { label: string; value?: string | number | null } ) {
	return (
		<div className="grid grid-cols-[10rem_1fr] gap-4 border-b border-a8c-gray-5 py-3 text-sm last:border-b-0">
			<div className="text-frame-text-secondary">{ label }</div>
			<div className="min-w-0 break-words text-frame-text">{ value || __( 'Unknown' ) }</div>
		</div>
	);
}

function LiveThemeSkeleton() {
	return (
		<div className="w-52 ltr:mr-8 rtl:ml-8">
			<h2 className="mb-3 a8c-subtitle-small">{ __( 'Theme' ) }</h2>
			<div className="h-64 w-full rounded-sm border border-frame-border skeleton-bg" />
			<div className="mt-2 h-4 w-24 skeleton-bg" />
		</div>
	);
}

function createLiveCustomizeButtons( target: RemoteTarget, isBlockTheme: boolean | undefined ) {
	const openAdminPath = ( path: string ) => () =>
		getIpcApi().openURL( resolveLiveSiteUrl( target.site.url, path ) );

	const blockThemeButtons: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: __( 'Site Editor' ),
			icon: desktop,
			onClick: openAdminPath( '/wp-admin/site-editor.php' ),
		},
		{
			label: __( 'Styles' ),
			icon: styles,
			onClick: openAdminPath( '/wp-admin/site-editor.php?path=%2Fwp_global_styles' ),
		},
		{
			label: __( 'Patterns' ),
			icon: symbolFilled,
			onClick: openAdminPath( '/wp-admin/site-editor.php?path=%2Fpatterns' ),
		},
		{
			label: __( 'Navigation' ),
			icon: navigation,
			onClick: openAdminPath( '/wp-admin/site-editor.php?path=%2Fnavigation' ),
		},
		{
			label: __( 'Templates' ),
			icon: layout,
			onClick: openAdminPath( '/wp-admin/site-editor.php?path=%2Fwp_template' ),
		},
		{
			label: __( 'Pages' ),
			icon: page,
			onClick: openAdminPath( '/wp-admin/site-editor.php?path=%2Fpage' ),
		},
	];

	const classicThemeButtons: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: __( 'Customizer' ),
			icon: pencil,
			onClick: openAdminPath( '/wp-admin/customize.php' ),
		},
		{
			label: __( 'Menus' ),
			icon: navigation,
			onClick: openAdminPath( '/wp-admin/nav-menus.php' ),
		},
		{
			label: __( 'Widgets' ),
			icon: widget,
			onClick: openAdminPath( '/wp-admin/widgets.php' ),
		},
	];

	return isBlockTheme === false ? classicThemeButtons : blockThemeButtons;
}

export function WorkspaceLiveSiteOverview( { target }: { target: RemoteTarget } ) {
	const [ isThumbnailError, setIsThumbnailError ] = useState( false );
	const { data: activeTheme, isLoading } = useGetActiveWpcomThemeQuery( {
		siteId: target.site.id,
	} );
	const themeName = activeTheme?.name || __( 'Live site' );
	const thumbnailUrl = getMshotsUrl( target.site.url );

	useEffect( () => {
		setIsThumbnailError( false );
	}, [ target.site.url ] );

	if ( isLoading ) {
		return (
			<div className="flex max-w-4xl p-8">
				<LiveThemeSkeleton />
				<div className="flex flex-1 flex-col items-start gap-8">
					<div className="h-20 w-full max-w-96 skeleton-bg" />
				</div>
			</div>
		);
	}

	return (
		<div className="flex max-w-4xl p-8">
			<div className="w-52 ltr:mr-8 rtl:ml-8 flex-col items-start justify-start gap-8">
				<h2 className="mb-3 a8c-subtitle-small">{ __( 'Theme' ) }</h2>
				<div
					className={ cx(
						'mb-2 flex min-h-40 max-h-64 w-full justify-center rounded-sm border border-frame-border bg-frame-surface',
						isThumbnailError && 'border-none',
						! isThumbnailError && 'duration-300 hover:border-frame-theme'
					) }
				>
					<button
						aria-label={ sprintf(
							/* translators: %s is an environment name, such as Production or Staging. */
							__( 'Open %s site' ),
							getTargetLabel( target )
						) }
						className="group relative w-full focus-visible:outline-frame-theme"
						onClick={ () => getIpcApi().openURL( resolveLiveSiteUrl( target.site.url ) ) }
					>
						<div
							className={ cx(
								'absolute size-full flex items-center justify-center bg-frame text-frame-theme opacity-0 duration-300 group-hover:bg-frame group-focus:bg-frame',
								isThumbnailError
									? 'group-hover:opacity-100 group-focus:opacity-100'
									: 'group-hover:opacity-90 group-focus:opacity-90'
							) }
						>
							{ __( 'Open site' ) }
							<ArrowIcon />
						</div>
						{ isThumbnailError ? (
							<div className="flex h-64 w-full items-center justify-center text-center leading-5 text-frame-text-secondary">
								{ __( 'Preview unavailable' ) }
							</div>
						) : (
							<img
								onError={ () => setIsThumbnailError( true ) }
								onLoad={ () => setIsThumbnailError( false ) }
								className="h-full w-full object-cover"
								src={ thumbnailUrl }
								alt={ themeName }
							/>
						) }
					</button>
				</div>
				<div className="flex w-full items-center justify-between">
					{ ! isThumbnailError && <p>{ themeName }</p> }
				</div>
			</div>
			<div className="flex flex-1 flex-col items-start justify-start gap-8">
				<ButtonsSection
					buttonsArray={ createLiveCustomizeButtons( target, activeTheme?.isBlockTheme ) }
					title={ __( 'Customize' ) }
				/>
			</div>
		</div>
	);
}

function createSettingsButtons( target: RemoteTarget ) {
	const routes = [
		{
			label: __( 'General' ),
			icon: desktop,
			path: '/wp-admin/options-general.php',
		},
		{
			label: __( 'Reading' ),
			icon: page,
			path: '/wp-admin/options-reading.php',
		},
		{
			label: __( 'Discussion' ),
			icon: styles,
			path: '/wp-admin/options-discussion.php',
		},
		{
			label: __( 'Permalinks' ),
			icon: navigation,
			path: '/wp-admin/options-permalink.php',
		},
	];

	return routes.map( ( route ) => ( {
		label: route.label,
		icon: route.icon,
		onClick: () => getIpcApi().openURL( resolveLiveSiteUrl( target.site.url, route.path ) ),
	} ) );
}

export function WorkspaceLiveSiteSettings( { target }: { target: RemoteTarget } ) {
	const { data: siteSettings, isLoading } = useGetWpcomSiteSettingsQuery( {
		siteId: target.site.id,
	} );
	const settings = siteSettings?.settings ?? {};

	const rows = [
		{ label: __( 'Environment' ), value: getTargetLabel( target ) },
		{ label: __( 'Site title' ), value: siteSettings?.name ?? target.site.name },
		{ label: __( 'Tagline' ), value: siteSettings?.description },
		{ label: __( 'Site URL' ), value: siteSettings?.url ?? target.site.url },
		{ label: __( 'Visibility' ), value: formatVisibility( siteSettings ) },
		{ label: __( 'Homepage' ), value: formatHomepage( siteSettings ) },
		{ label: __( 'Timezone' ), value: formatTimezone( siteSettings ) },
		{ label: __( 'Language' ), value: siteSettings?.lang },
		{ label: __( 'Plan' ), value: target.site.planName },
		{ label: __( 'WordPress version' ), value: target.site.wpVersion },
		{
			label: __( 'Manage options' ),
			value:
				target.site.canManageOptions === undefined
					? undefined
					: target.site.canManageOptions
					? __( 'Available' )
					: __( 'Unavailable' ),
		},
		{
			label: __( 'Related posts' ),
			value: getBooleanLikeLabel( settings.jetpack_relatedposts_enabled ),
		},
		{
			label: __( 'Search' ),
			value: getBooleanLikeLabel( settings.jetpack_search_enabled ),
		},
		{
			label: __( 'Newsletter modal' ),
			value: getBooleanLikeLabel( settings.wpcom_subscription_popup_enabled ),
		},
	];

	return (
		<div className="p-8">
			<div className="max-w-3xl">
				<h2 className="m-0 text-base font-medium text-frame-text">{ __( 'Settings' ) }</h2>
				<p className="m-0 mt-2 max-w-xl text-sm text-frame-text-secondary">
					{ sprintf(
						/* translators: %s is an environment name, such as Production or Staging. */
						__( 'These settings are read from the selected %s site.' ),
						getTargetLabel( target )
					) }
				</p>
				<div className="mt-5 rounded border border-a8c-gray-5 bg-white px-4">
					{ isLoading ? (
						<div className="my-4 h-28 skeleton-bg" />
					) : (
						rows.map( ( row ) => (
							<SettingsRow key={ row.label } label={ row.label } value={ row.value } />
						) )
					) }
				</div>
				<div className="mt-8 max-w-2xl">
					<ButtonsSection
						buttonsArray={ createSettingsButtons( target ) }
						title={ __( 'Manage in WP admin' ) }
					/>
				</div>
			</div>
		</div>
	);
}
