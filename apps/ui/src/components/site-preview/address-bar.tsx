import { TRACKS_EVENTS, type TracksEventName } from '@studio/common/lib/record-tracks-event';
import { __ } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import styles from './address-bar.module.css';
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

interface PreviewAddressBarProps {
	siteUrl: string;
	path: string;
	onNavigate: ( path: string ) => void;
}

function getDisplayUrl( siteUrl: string, path: string ): string {
	try {
		return new URL( path, siteUrl ).toString();
	} catch {
		return `${ siteUrl }${ path }`;
	}
}

export function PreviewAddressBar( { siteUrl, path, onNavigate }: PreviewAddressBarProps ) {
	const displayUrl = getDisplayUrl( siteUrl, path );
	const [ value, setValue ] = useState( displayUrl );

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
		onNavigate( nextPath );
	};

	return (
		<form className={ styles.addressBar } onSubmit={ handleSubmit }>
			<input
				className={ styles.input }
				value={ value }
				onChange={ ( event ) => setValue( event.target.value ) }
				onFocus={ ( event ) => event.currentTarget.select() }
				aria-label={ __( 'Address' ) }
				spellCheck={ false }
			/>
		</form>
	);
}
