import { TRACKS_EVENTS, type TracksEventName } from '@studio/common/lib/record-tracks-event';
import { __, sprintf } from '@wordpress/i18n';
import { closeSmall, Icon, wordpress } from '@wordpress/icons';
import { IconButton, Popover, VisuallyHidden } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SiteIcon } from '@/components/site-icon';
import { databaseIcon } from '@/lib/icons';
import styles from './address-bar.module.css';
import type { SiteDetails } from '@/data/core';
import type { FormEvent, KeyboardEvent } from 'react';

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

export type PreviewRealm = 'frontend' | 'admin' | 'database';

export const DATABASE_HOME_PATH = '/phpmyadmin/index.php?route=/database/structure&db=wordpress';

export function getPreviewRealm( path: string ): PreviewRealm {
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

export type OmniboxIntent = { type: 'path'; path: string } | { type: 'search'; term: string };

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
	onSuggestionsOpenChange?: ( open: boolean ) => void;
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

function removeRecentLocation( siteId: string, path: string ): RecentPreviewLocation[] {
	const locations = loadRecentLocations( siteId ).filter( ( recent ) => recent.path !== path );
	try {
		window.localStorage.setItem(
			getRecentLocationsStorageKey( siteId ),
			JSON.stringify( { version: RECENT_LOCATIONS_VERSION, locations } )
		);
	} catch {
		// Keep the in-memory list removable when storage is unavailable.
	}
	return locations;
}

function getDisplayUrl( siteUrl: string, path: string ): string {
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
	onSuggestionsOpenChange,
}: PreviewAddressBarProps ) {
	const displayUrl = getDisplayUrl( siteUrl, path );
	const [ value, setValue ] = useState( displayUrl );
	const [ suggestionsOpen, setSuggestionsOpen ] = useState( false );
	const [ recentLocations, setRecentLocations ] = useState< RecentPreviewLocation[] >( () =>
		loadRecentLocations( site.id )
	);
	const addressBarRef = useRef< HTMLFormElement | null >( null );
	const suggestionsPopupRef = useRef< HTMLDivElement | null >( null );
	const pendingSuggestionFocusRef = useRef< 'first' | 'last' | null >( null );
	const setSuggestionsPopupRef = useCallback( ( popup: HTMLDivElement | null ) => {
		suggestionsPopupRef.current = popup;
		const position = pendingSuggestionFocusRef.current;
		if ( ! popup || ! position ) {
			return;
		}
		const suggestions = popup.querySelectorAll< HTMLButtonElement >( `.${ styles.suggestion }` );
		suggestions[ position === 'first' ? 0 : suggestions.length - 1 ]?.focus();
		pendingSuggestionFocusRef.current = null;
	}, [] );
	const updateSuggestionsOpen = useCallback(
		( open: boolean ) => {
			setSuggestionsOpen( open );
			onSuggestionsOpenChange?.( open );
		},
		[ onSuggestionsOpenChange ]
	);

	useEffect( () => setValue( displayUrl ), [ displayUrl ] );
	useEffect( () => setRecentLocations( loadRecentLocations( site.id ) ), [ site.id ] );
	useEffect(
		() => () => {
			onSuggestionsOpenChange?.( false );
		},
		[ onSuggestionsOpenChange ]
	);

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
		updateSuggestionsOpen( false );
		onNavigate( nextPath );
	};
	const chooseLocation = ( nextPath: string, recent?: RecentPreviewLocation ) => {
		if ( recent ) {
			setRecentLocations( storeRecentLocation( site.id, recent ) );
		}
		updateSuggestionsOpen( false );
		onNavigate( nextPath );
	};
	const getSuggestionElements = () =>
		Array.from(
			suggestionsPopupRef.current?.querySelectorAll< HTMLButtonElement >(
				`.${ styles.suggestion }`
			) ?? []
		);
	const focusSuggestion = ( position: 'first' | 'last' ): boolean => {
		const suggestions = getSuggestionElements();
		const suggestion = suggestions[ position === 'first' ? 0 : suggestions.length - 1 ];
		suggestion?.focus();
		return Boolean( suggestion );
	};
	const handleSuggestionKeyDown = ( event: KeyboardEvent< HTMLButtonElement > ) => {
		if ( event.key === 'Escape' ) {
			event.preventDefault();
			addressBarRef.current?.querySelector( 'input' )?.focus();
			updateSuggestionsOpen( false );
			return;
		}
		if ( event.key !== 'ArrowDown' && event.key !== 'ArrowUp' ) {
			return;
		}
		event.preventDefault();
		const suggestions = getSuggestionElements();
		const currentIndex = suggestions.indexOf( event.currentTarget );
		const direction = event.key === 'ArrowDown' ? 1 : -1;
		const nextIndex = ( currentIndex + direction + suggestions.length ) % suggestions.length;
		suggestions[ nextIndex ]?.focus();
	};
	const renderLocationIcon = ( locationPath: string ) => {
		const realm = getPreviewRealm( locationPath );
		if ( realm === 'frontend' ) {
			return (
				<SiteIcon
					className={ styles.locationSiteIcon }
					seed={ `${ site.id }:${ site.name }:${ site.path }` }
					imageSrc={ site.siteIcon }
				/>
			);
		}
		return (
			<Icon
				icon={ realm === 'admin' ? wordpress : databaseIcon }
				size={ 18 }
				className={ clsx( styles.locationIcon, realm === 'admin' && styles.wordpressIcon ) }
			/>
		);
	};

	return (
		<Popover.Root modal={ false } open={ suggestionsOpen } onOpenChange={ updateSuggestionsOpen }>
			<form ref={ addressBarRef } className={ styles.addressBar } onSubmit={ handleSubmit }>
				<input
					className={ styles.input }
					value={ value }
					onChange={ ( event ) => setValue( event.target.value ) }
					onClick={ () => {
						setRecentLocations( loadRecentLocations( site.id ) );
						updateSuggestionsOpen( true );
					} }
					onFocus={ ( event ) => {
						event.currentTarget.select();
						setRecentLocations( loadRecentLocations( site.id ) );
						updateSuggestionsOpen( true );
					} }
					onKeyDown={ ( event ) => {
						if ( event.key === 'Tab' || event.key === 'Escape' ) {
							updateSuggestionsOpen( false );
						} else if ( event.key === 'ArrowDown' || event.key === 'ArrowUp' ) {
							event.preventDefault();
							const position = event.key === 'ArrowDown' ? 'first' : 'last';
							pendingSuggestionFocusRef.current = position;
							updateSuggestionsOpen( true );
							if ( focusSuggestion( position ) ) {
								pendingSuggestionFocusRef.current = null;
							}
						}
					} }
					aria-label={ __( 'Address' ) }
					spellCheck={ false }
				/>
			</form>
			<Popover.Popup
				ref={ setSuggestionsPopupRef }
				variant="unstyled"
				initialFocus={ false }
				finalFocus={ false }
				className={ styles.suggestionsPopup }
				positioner={
					<Popover.Positioner
						anchor={ addressBarRef }
						side="bottom"
						align="start"
						sideOffset={ 4 }
						className={ styles.suggestionsPositioner }
					/>
				}
			>
				<VisuallyHidden render={ <Popover.Title /> }>
					{ __( 'Address suggestions' ) }
				</VisuallyHidden>
				<div className={ styles.suggestionsSection }>
					<div className={ styles.suggestionsLabel }>{ __( 'Destinations' ) }</div>
					<Popover.Close
						className={ styles.suggestion }
						onClick={ () => chooseLocation( '/' ) }
						onKeyDown={ handleSuggestionKeyDown }
					>
						{ renderLocationIcon( '/' ) }
						<span>{ __( 'Front-end' ) }</span>
					</Popover.Close>
					<Popover.Close
						className={ styles.suggestion }
						onClick={ () => chooseLocation( getRealmNavigationPath( '/wp-admin/', siteUrl ) ) }
						onKeyDown={ handleSuggestionKeyDown }
					>
						{ renderLocationIcon( '/wp-admin/' ) }
						<span>{ __( 'WordPress' ) }</span>
					</Popover.Close>
					<Popover.Close
						className={ styles.suggestion }
						onClick={ () => chooseLocation( DATABASE_HOME_PATH ) }
						onKeyDown={ handleSuggestionKeyDown }
					>
						{ renderLocationIcon( DATABASE_HOME_PATH ) }
						<span>{ __( 'Database' ) }</span>
					</Popover.Close>
				</div>
				{ recentLocations.length > 0 ? (
					<div className={ styles.suggestionsSection }>
						<div className={ styles.suggestionsLabel }>{ __( 'Recent' ) }</div>
						{ recentLocations.map( ( recent ) => (
							<div key={ recent.path } className={ styles.recentSuggestion }>
								<Popover.Close
									className={ styles.suggestion }
									title={ recent.label }
									onClick={ () => chooseLocation( recent.path, recent ) }
									onKeyDown={ handleSuggestionKeyDown }
								>
									{ renderLocationIcon( recent.path ) }
									<span className={ styles.suggestionUrl }>{ recent.label }</span>
								</Popover.Close>
								<IconButton
									className={ styles.removeSuggestion }
									variant="minimal"
									tone="neutral"
									size="small"
									icon={ closeSmall }
									label={ sprintf(
										/* translators: %s: recently visited URL */
										__( 'Remove %s from recent' ),
										recent.label
									) }
									onClick={ () =>
										setRecentLocations( removeRecentLocation( site.id, recent.path ) )
									}
								/>
							</div>
						) ) }
					</div>
				) : null }
			</Popover.Popup>
		</Popover.Root>
	);
}
