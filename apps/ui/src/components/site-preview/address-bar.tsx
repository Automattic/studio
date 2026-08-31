import { TRACKS_EVENTS, type TracksEventName } from '@studio/common/lib/record-tracks-event';
import { __ } from '@wordpress/i18n';
import { Icon, wordpress } from '@wordpress/icons';
import { displayShortcut } from '@wordpress/keycodes';
import { Popover, VisuallyHidden } from '@wordpress/ui';
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

export const REALM_SHORTCUT_KEYS: Record< PreviewRealm, string > = {
	frontend: '1',
	admin: '2',
	database: '3',
};

interface PreviewAddressBarProps {
	site: SiteDetails;
	siteUrl: string;
	path: string;
	onNavigate: ( path: string ) => void;
	onSwitchRealm: ( realm: PreviewRealm ) => void;
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
	onSwitchRealm,
}: PreviewAddressBarProps ) {
	const displayUrl = getDisplayUrl( siteUrl, path );
	const activeRealm = getPreviewRealm( path );
	const [ value, setValue ] = useState( displayUrl );
	const [ shortcutsOpen, setShortcutsOpen ] = useState( false );
	const addressBarRef = useRef< HTMLFormElement | null >( null );

	useEffect( () => setValue( displayUrl ), [ displayUrl ] );

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
		setShortcutsOpen( false );
		onNavigate( nextPath );
	};
	const chooseRealm = ( realm: PreviewRealm ) => {
		setShortcutsOpen( false );
		onSwitchRealm( realm );
	};

	return (
		<Popover.Root
			open={ shortcutsOpen }
			onOpenChange={ ( open ) => {
				setShortcutsOpen( open );
				if ( ! open ) {
					setValue( displayUrl );
				}
			} }
		>
			<form ref={ addressBarRef } className={ styles.addressBar } onSubmit={ handleSubmit }>
				<span className={ styles.siteIcon } data-realm={ activeRealm } aria-hidden="true">
					{ activeRealm === 'frontend' ? (
						<SiteIcon
							seed={ `${ site.id }:${ site.name }:${ site.path }` }
							imageSrc={ site.siteIcon }
						/>
					) : (
						<Icon icon={ activeRealm === 'admin' ? wordpress : databaseIcon } size={ 18 } />
					) }
				</span>
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
						<SiteIcon
							className={ styles.shortcutSiteIcon }
							seed={ `${ site.id }:${ site.name }:${ site.path }` }
							imageSrc={ site.siteIcon }
						/>
						<span>{ __( 'Front end' ) }</span>
						<kbd>{ displayShortcut.primary( REALM_SHORTCUT_KEYS.frontend ) }</kbd>
					</Popover.Close>
					<Popover.Close className={ styles.shortcut } onClick={ () => chooseRealm( 'admin' ) }>
						<Icon icon={ wordpress } size={ 18 } />
						<span>{ __( 'WP Admin' ) }</span>
						<kbd>{ displayShortcut.primary( REALM_SHORTCUT_KEYS.admin ) }</kbd>
					</Popover.Close>
					<Popover.Close className={ styles.shortcut } onClick={ () => chooseRealm( 'database' ) }>
						<Icon icon={ databaseIcon } size={ 18 } />
						<span>{ __( 'Database' ) }</span>
						<kbd>{ displayShortcut.primary( REALM_SHORTCUT_KEYS.database ) }</kbd>
					</Popover.Close>
				</div>
			</Popover.Popup>
		</Popover.Root>
	);
}
