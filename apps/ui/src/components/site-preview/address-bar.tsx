import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/common/ai/chat-artifacts';
import { TRACKS_EVENTS, type TracksEventName } from '@studio/common/lib/record-tracks-event';
import { __ } from '@wordpress/i18n';
import { external, Icon, styles as stylesIcon, wordpress } from '@wordpress/icons';
import { Popover, Tooltip, VisuallyHidden } from '@wordpress/ui';
import { useEffect, useRef, useState } from 'react';
import { SiteIcon } from '@/components/site-icon';
import { databaseIcon } from '@/lib/icons';
import styles from './address-bar.module.css';
import type { SiteDetails } from '@/data/core';
import type { FormEvent } from 'react';

export function getPathFromPreviewUrl( url: string, baseUrl: string ) {
	try {
		const parsedUrl = new URL( url );
		const parsedBaseUrl = new URL( baseUrl );
		if ( parsedUrl.origin !== parsedBaseUrl.origin ) {
			return null;
		}
		return `${ parsedUrl.pathname }${ parsedUrl.search }${ parsedUrl.hash }`;
	} catch {
		return null;
	}
}

export type PreviewRealm = 'frontend' | 'admin' | 'database' | 'design';

export const DATABASE_HOME_PATH = '/phpmyadmin/index.php?route=/database/structure&db=wordpress';

export const DESIGN_SYSTEM_PATH = DESIGN_SYSTEM_PREVIEW_PATH;

export function getPreviewRealm( path: string ): PreviewRealm {
	if ( path === DESIGN_SYSTEM_PATH ) {
		return 'design';
	}
	let target = path;
	if ( path.startsWith( '/studio-auto-login' ) ) {
		const query = path.split( '?' )[ 1 ] ?? '';
		target = new URLSearchParams( query ).get( 'redirect_to' ) ?? '';
	}
	if ( target.includes( '/wp-admin' ) ) {
		return 'admin';
	}
	if ( target.includes( '/phpmyadmin' ) ) {
		return 'database';
	}
	return 'frontend';
}

const REALM_OPEN_EVENTS: Record< PreviewRealm, TracksEventName > = {
	frontend: TRACKS_EVENTS.SITE_OPEN_IN_BROWSER,
	admin: TRACKS_EVENTS.SITE_OPEN_WP_ADMIN,
	database: TRACKS_EVENTS.SITE_OPEN_PHPMYADMIN,
	design: TRACKS_EVENTS.SITE_OPEN_DESIGN_SYSTEM,
};

export function getRealmOpenEvent( realm: PreviewRealm ): TracksEventName {
	return REALM_OPEN_EVENTS[ realm ];
}

export function getRealmNavigationPath( path: string, siteUrl: string ): string {
	if ( ! path.startsWith( '/wp-admin' ) ) {
		return path;
	}
	try {
		const redirectTo = new URL( path, siteUrl ).toString();
		return `/studio-auto-login?redirect_to=${ encodeURIComponent( redirectTo ) }`;
	} catch {
		return path;
	}
}

type OmniboxIntent = { type: 'path'; path: string } | { type: 'search'; term: string };

export function parseOmniboxInput( raw: string, siteUrl: string ): OmniboxIntent | null {
	const value = raw.trim();
	if ( ! value ) {
		return null;
	}
	if ( /^https?:\/\//i.test( value ) ) {
		const path = getPathFromPreviewUrl( value, siteUrl );
		return path ? { type: 'path', path } : null;
	}
	if ( /\s/.test( value ) ) {
		return { type: 'search', term: value };
	}
	if ( value.startsWith( '/' ) ) {
		return { type: 'path', path: value };
	}
	if ( value.includes( '/' ) || value.includes( '?' ) ) {
		return { type: 'path', path: `/${ value }` };
	}
	return { type: 'search', term: value };
}

export function useDebouncedValue< T >( value: T, delayMs: number ): T {
	const [ debounced, setDebounced ] = useState( value );
	useEffect( () => {
		const timer = setTimeout( () => setDebounced( value ), delayMs );
		return () => clearTimeout( timer );
	}, [ value, delayMs ] );
	return debounced;
}

interface PreviewAddressBarProps {
	site: SiteDetails;
	siteUrl: string;
	path: string;
	onNavigate: ( path: string ) => void;
	onSwitchRealm: ( realm: PreviewRealm ) => void;
	// Offers the design system shortcut, for sites with DESIGN.md and theme.json.
	hasDesignSystem?: boolean;
	// Opens the page the preview is showing in the OS browser. Omitted when
	// the host can't (no running site to point it at).
	onOpenExternal?: () => void;
}

interface RecentPreviewLocation {
	path: string;
	label: string;
}

const RECENT_LOCATIONS_VERSION = 1;
const RECENT_LOCATIONS_LIMIT = 8;

function getRecentLocationsStorageKey( siteId: string ): string {
	return `studio-preview-recent-locations:${ siteId }`;
}

function loadRecentLocations( siteId: string ): RecentPreviewLocation[] {
	try {
		const raw = window.localStorage.getItem( getRecentLocationsStorageKey( siteId ) );
		if ( ! raw ) return [];
		const stored = JSON.parse( raw ) as { version?: unknown; locations?: unknown };
		if ( stored.version !== RECENT_LOCATIONS_VERSION || ! Array.isArray( stored.locations ) ) {
			return [];
		}
		return stored.locations.slice( 0, RECENT_LOCATIONS_LIMIT ).flatMap( ( value ) => {
			if ( ! value || typeof value !== 'object' ) return [];
			const location = value as { path?: unknown; label?: unknown };
			return typeof location.path === 'string' && typeof location.label === 'string'
				? [ { path: location.path, label: location.label } ]
				: [];
		} );
	} catch {
		return [];
	}
}

function storeRecentLocation(
	siteId: string,
	location: RecentPreviewLocation
): RecentPreviewLocation[] {
	const locations = [
		location,
		...loadRecentLocations( siteId ).filter( ( recent ) => recent.path !== location.path ),
	].slice( 0, RECENT_LOCATIONS_LIMIT );
	try {
		window.localStorage.setItem(
			getRecentLocationsStorageKey( siteId ),
			JSON.stringify( { version: RECENT_LOCATIONS_VERSION, locations } )
		);
	} catch {
		// The address bar remains usable when storage is unavailable or full.
	}
	return locations;
}

function getDisplayUrl( siteUrl: string, path: string ): string {
	if ( path === DESIGN_SYSTEM_PATH ) {
		return __( 'Design system' );
	}
	try {
		return new URL( path, siteUrl ).toString();
	} catch {
		return `${ siteUrl }${ path }`;
	}
}

export function PreviewAddressBar( {
	site,
	siteUrl,
	path,
	onNavigate,
	onSwitchRealm,
	hasDesignSystem = false,
	onOpenExternal,
}: PreviewAddressBarProps ) {
	const displayUrl = getDisplayUrl( siteUrl, path );
	const activeRealm = getPreviewRealm( path );
	const [ value, setValue ] = useState( displayUrl );
	const [ shortcutsOpen, setShortcutsOpen ] = useState( false );
	const [ recentLocations, setRecentLocations ] = useState< RecentPreviewLocation[] >( () =>
		loadRecentLocations( site.id )
	);
	const addressBarRef = useRef< HTMLFormElement | null >( null );

	useEffect( () => setValue( displayUrl ), [ displayUrl ] );
	useEffect( () => setRecentLocations( loadRecentLocations( site.id ) ), [ site.id ] );

	const handleSubmit = ( event: FormEvent< HTMLFormElement > ) => {
		event.preventDefault();
		const intent = parseOmniboxInput( value, siteUrl );
		if ( ! intent ) {
			return;
		}
		const nextPath =
			intent.type === 'path'
				? getRealmNavigationPath( intent.path, siteUrl )
				: `/?s=${ encodeURIComponent( intent.term ) }`;
		const recentLabel = getDisplayUrl( siteUrl, intent.type === 'path' ? intent.path : nextPath );
		setRecentLocations( storeRecentLocation( site.id, { path: nextPath, label: recentLabel } ) );
		setShortcutsOpen( false );
		onNavigate( nextPath );
	};
	const chooseRealm = ( realm: PreviewRealm ) => {
		setShortcutsOpen( false );
		onSwitchRealm( realm );
	};
	const chooseRecentLocation = ( recent: RecentPreviewLocation ) => {
		setRecentLocations( storeRecentLocation( site.id, recent ) );
		setShortcutsOpen( false );
		onNavigate( recent.path );
	};
	const renderRealmIcon = ( realm: PreviewRealm, siteIconClassName?: string ) => {
		if ( realm === 'frontend' ) {
			return (
				<SiteIcon
					className={ siteIconClassName }
					seed={ `${ site.id }:${ site.name }:${ site.path }` }
					imageSrc={ site.siteIcon }
				/>
			);
		}
		return (
			<Icon
				icon={ { admin: wordpress, database: databaseIcon, design: stylesIcon }[ realm ] }
				size={ 18 }
				className={ realm === 'admin' ? styles.wordpressIcon : undefined }
			/>
		);
	};

	return (
		<Popover.Root
			open={ shortcutsOpen }
			// The webview swallows outside clicks, so the modal backdrop is what
			// lets a click on the page dismiss the shortcuts.
			modal
			onOpenChange={ ( open ) => {
				setShortcutsOpen( open );
				if ( ! open ) {
					setValue( displayUrl );
				}
			} }
		>
			<form ref={ addressBarRef } className={ styles.addressBar } onSubmit={ handleSubmit }>
				<button
					type="button"
					className={ styles.siteIcon }
					data-realm={ activeRealm }
					aria-label={ __( 'Preview shortcuts' ) }
					onClick={ () => setShortcutsOpen( true ) }
				>
					{ renderRealmIcon( activeRealm ) }
				</button>
				<input
					className={ styles.input }
					value={ value }
					onChange={ ( event ) => setValue( event.target.value ) }
					onClick={ () => setShortcutsOpen( true ) }
					onFocus={ ( event ) => {
						event.currentTarget.select();
					} }
					aria-label={ __( 'Address' ) }
					spellCheck={ false }
				/>
				{ onOpenExternal ? (
					<Tooltip.Root>
						<Tooltip.Trigger
							render={
								<button
									type="button"
									className={ styles.openExternal }
									aria-label={ __( 'Open this page in your browser' ) }
									onClick={ onOpenExternal }
								/>
							}
						>
							<Icon icon={ external } size={ 18 } />
						</Tooltip.Trigger>
						<Tooltip.Popup positioner={ <Tooltip.Positioner side="bottom" /> }>
							{ __( 'Open this page in your browser' ) }
						</Tooltip.Popup>
					</Tooltip.Root>
				) : null }
			</form>
			<Popover.Popup
				variant="unstyled"
				initialFocus={ false }
				finalFocus={ false }
				className={ styles.shortcutsPopup }
				positioner={
					<Popover.Positioner
						anchor={ addressBarRef }
						side="bottom"
						align="start"
						sideOffset={ 4 }
						className={ styles.shortcutsPositioner }
					/>
				}
			>
				<VisuallyHidden render={ <Popover.Title /> }>{ __( 'Preview shortcuts' ) }</VisuallyHidden>
				<div className={ styles.shortcutsList }>
					<Popover.Close className={ styles.shortcut } onClick={ () => chooseRealm( 'frontend' ) }>
						{ renderRealmIcon( 'frontend', styles.shortcutSiteIcon ) }
						<span>{ __( 'Front end' ) }</span>
					</Popover.Close>
					<Popover.Close className={ styles.shortcut } onClick={ () => chooseRealm( 'admin' ) }>
						{ renderRealmIcon( 'admin' ) }
						<span>{ __( 'WP Admin' ) }</span>
					</Popover.Close>
					<Popover.Close className={ styles.shortcut } onClick={ () => chooseRealm( 'database' ) }>
						{ renderRealmIcon( 'database' ) }
						<span>{ __( 'Database' ) }</span>
					</Popover.Close>
					{ hasDesignSystem ? (
						<Popover.Close className={ styles.shortcut } onClick={ () => chooseRealm( 'design' ) }>
							{ renderRealmIcon( 'design' ) }
							<span>{ __( 'Design system' ) }</span>
						</Popover.Close>
					) : null }
				</div>
				{ recentLocations.length > 0 ? (
					<div className={ styles.shortcutsSection }>
						<div className={ styles.shortcutsLabel }>{ __( 'Recent' ) }</div>
						{ recentLocations.map( ( recent ) => (
							<Popover.Close
								key={ recent.path }
								className={ styles.shortcut }
								title={ recent.label }
								onClick={ () => chooseRecentLocation( recent ) }
							>
								{ renderRealmIcon( getPreviewRealm( recent.path ), styles.shortcutSiteIcon ) }
								<span className={ styles.shortcutUrl }>{ recent.label }</span>
							</Popover.Close>
						) ) }
					</div>
				) : null }
			</Popover.Popup>
		</Popover.Root>
	);
}
