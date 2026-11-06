import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';
import { TRACKS_EVENTS, type TracksEventName } from '@studio/common/lib/record-tracks-event';
import { __ } from '@wordpress/i18n';
import { UserRoundIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import {
	AppearanceIcon,
	DatabaseIcon,
	ExternalLinkIcon,
	GlobeIcon,
	MailIcon,
	WordPressIcon,
} from '@/lib/icons';
import { Tooltip, TooltipContent, TooltipTrigger, Popover, Button, Input } from '@/lib/ui';
import { CommandList, handleCommandKey, type CommandGroup } from '@/lib/ui';
import styles from './address-bar.module.css';
import { PREVIEW_HISTORY_CLEARED_EVENT } from './preview-browser-settings';
import type { SiteDetails } from '@/data/core';
import type { ComponentType, FormEvent, ReactNode } from 'react';

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

export type PreviewRealm = 'frontend' | 'admin' | 'staff' | 'database' | 'email' | 'design';

export function isWordPressAuthPath( path: string ): boolean {
	if ( path.startsWith( '/studio-auto-login' ) ) {
		const redirect = new URLSearchParams( path.split( '?' )[ 1 ] ?? '' ).get( 'redirect_to' );
		if ( redirect ) path = redirect.replace( /^https?:\/\/[^/?#]*/i, '' );
	}
	return /(?:^|\/)wp-(?:login|signup|activate)\.php\/?$/.test( path.split( /[?#]/ )[ 0 ] );
}

export const DATABASE_HOME_PATH = '/phpmyadmin/index.php?route=/database/structure&db=wordpress';

// Studio renders the site's email itself, like the design system, so a path
// that is no page on the site stands for it.
export const EMAIL_PREVIEW_PATH = 'studio:email';

const isAdminPath = ( path: string ) => /^\/wp-admin(?:[/?#]|$)/.test( path );

export function getPreviewRealm( path: string ): PreviewRealm {
	if ( path === DESIGN_SYSTEM_PREVIEW_PATH ) {
		return 'design';
	}
	if ( path === EMAIL_PREVIEW_PATH ) {
		return 'email';
	}
	let target = path;
	let user: string | null = null;
	if ( path.startsWith( '/studio-auto-login' ) ) {
		const query = new URLSearchParams( path.split( '?' )[ 1 ] ?? '' );
		target = ( query.get( 'redirect_to' ) ?? '' ).replace( /^https?:\/\/[^/?#]*/i, '' );
		user = query.get( 'user' );
	}
	if ( isAdminPath( target ) ) {
		return user ? 'staff' : 'admin';
	}
	if ( /^\/phpmyadmin(?:[/?#]|$)/.test( target ) ) {
		return 'database';
	}
	return 'frontend';
}

const REALM_OPEN_EVENTS: Record< PreviewRealm, TracksEventName > = {
	frontend: TRACKS_EVENTS.SITE_OPEN_IN_BROWSER,
	admin: TRACKS_EVENTS.SITE_OPEN_WP_ADMIN,
	staff: TRACKS_EVENTS.SITE_OPEN_WP_ADMIN,
	database: TRACKS_EVENTS.SITE_OPEN_PHPMYADMIN,
	email: TRACKS_EVENTS.SITE_OPEN_EMAIL,
	design: TRACKS_EVENTS.SITE_OPEN_DESIGN_SYSTEM,
};

export function getRealmOpenEvent( realm: PreviewRealm ): TracksEventName {
	return REALM_OPEN_EVENTS[ realm ];
}

export function getRealmNavigationPath( path: string, siteUrl: string, user?: string ): string {
	if ( ! isAdminPath( path ) ) {
		return path;
	}
	try {
		const redirectTo = new URL( path, siteUrl ).toString();
		const login = `/studio-auto-login?redirect_to=${ encodeURIComponent( redirectTo ) }`;
		return user ? `${ login }&user=${ encodeURIComponent( user ) }` : login;
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
	// `//host/` is an address on another host, not a path.
	if ( /^(?:https?:)?\/\//i.test( value ) ) {
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

interface PreviewAddressBarProps {
	site: SiteDetails;
	siteUrl: string;
	path: string;
	// A remote site: no local realms, auto-login or recent locations.
	remote?: boolean;
	onNavigate: ( path: string ) => void;
	pageTitle?: string | null;
	loading?: boolean;
	onOpenExternal?: () => void;
	onExternalNavigate?: ( url: string ) => void;
	disabled?: boolean;
}

interface RecentPreviewLocation {
	path: string;
	label: string;
	title?: string;
}

const RECENT_LOCATIONS_VERSION = 1;
const RECENT_LOCATIONS_LIMIT = 8;

function getRecentLocationsStorageKey( siteId: string ): string {
	return `studio-preview-recent-locations:${ siteId }`;
}

function getRecentLocationKey( path: string ): string {
	const suffixStart = path.search( /[?#]/ );
	const pathname = suffixStart === -1 ? path : path.slice( 0, suffixStart );
	const suffix = suffixStart === -1 ? '' : path.slice( suffixStart );
	return `${ pathname.replace( /\/+$/, '' ) || '/' }${ suffix }`;
}

function deduplicateRecentLocations( locations: RecentPreviewLocation[] ): RecentPreviewLocation[] {
	const unique = new Map< string, RecentPreviewLocation >();
	for ( const location of locations ) {
		if ( isWordPressAuthPath( location.path ) ) continue;
		const key = getRecentLocationKey( location.path );
		const existing = unique.get( key );
		const title = location.title?.trim() || undefined;
		if ( ! existing ) {
			unique.set( key, { ...location, title } );
		} else if ( ! existing.title && title ) {
			existing.title = title;
		}
	}
	return Array.from( unique.values() ).slice( 0, RECENT_LOCATIONS_LIMIT );
}

function loadRecentLocations( siteId: string ): RecentPreviewLocation[] {
	try {
		const raw = window.localStorage.getItem( getRecentLocationsStorageKey( siteId ) );
		if ( ! raw ) return [];
		const stored = JSON.parse( raw ) as { version?: unknown; locations?: unknown };
		if ( stored.version !== RECENT_LOCATIONS_VERSION || ! Array.isArray( stored.locations ) ) {
			return [];
		}
		const locations = stored.locations.flatMap( ( value ) => {
			if ( ! value || typeof value !== 'object' ) return [];
			const location = value as { path?: unknown; label?: unknown; title?: unknown };
			return typeof location.path === 'string' && typeof location.label === 'string'
				? [
						{
							path: location.path,
							label: location.label,
							title: typeof location.title === 'string' ? location.title : undefined,
						},
				  ]
				: [];
		} );
		return deduplicateRecentLocations( locations );
	} catch {
		return [];
	}
}

function storeRecentLocation(
	siteId: string,
	location: RecentPreviewLocation
): RecentPreviewLocation[] {
	const locations = deduplicateRecentLocations( [ location, ...loadRecentLocations( siteId ) ] );
	try {
		window.localStorage.setItem(
			getRecentLocationsStorageKey( siteId ),
			JSON.stringify( { version: RECENT_LOCATIONS_VERSION, locations } )
		);
	} catch {
		// Storage may be unavailable or full.
	}
	return locations;
}

function getDisplayUrl( siteUrl: string, path: string ): string {
	if ( path === EMAIL_PREVIEW_PATH ) return __( 'Email log' );
	if ( path === DESIGN_SYSTEM_PREVIEW_PATH ) {
		return __( 'Design system' );
	}
	try {
		return new URL( path, siteUrl ).toString().replace( /^(https?:\/\/[^/?#]+)\/$/i, '$1' );
	} catch {
		return `${ siteUrl }${ path }`;
	}
}

// Address actions share the field’s compact button treatment.
function AddressAction( {
	icon,
	label,
	tooltip = label,
	onClick,
	disabled,
}: {
	icon: ReactNode;
	label: string;
	tooltip?: string;
	onClick: () => void;
	disabled?: boolean;
} ) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						size="icon-2xs"
						className={ styles.action }
						aria-label={ label }
						disabled={ disabled }
						onClick={ onClick }
					/>
				}
			>
				{ icon }
			</TooltipTrigger>
			<TooltipContent side="bottom">{ tooltip }</TooltipContent>
		</Tooltip>
	);
}

export function PreviewAddressBar( {
	site,
	siteUrl,
	path,
	remote = false,
	onNavigate,
	pageTitle,
	loading = false,
	onOpenExternal,
	onExternalNavigate,
	disabled = false,
}: PreviewAddressBarProps ) {
	const displayUrl = getDisplayUrl( siteUrl, path );
	const [ value, setValue ] = useState( displayUrl );
	const [ invalid, setInvalid ] = useState( false );
	const [ recentOpen, setRecentOpen ] = useState( false );
	const [ highlighted, setHighlighted ] = useState< string >();
	const recentId = useId();
	const addressInputId = useId();
	const [ recentLocations, setRecentLocations ] = useState< RecentPreviewLocation[] >( () =>
		loadRecentLocations( site.id )
	);
	const addressBarRef = useRef< HTMLFormElement | null >( null );
	const selectOnMouseUp = useRef( false );

	const restore = () => {
		setValue( displayUrl );
		setInvalid( false );
	};
	useEffect( () => {
		setValue( displayUrl );
		setInvalid( false );
	}, [ displayUrl ] );
	useEffect( () => setRecentLocations( loadRecentLocations( site.id ) ), [ site.id ] );
	useEffect( () => {
		const refresh = () => setRecentLocations( loadRecentLocations( site.id ) );
		window.addEventListener( PREVIEW_HISTORY_CLEARED_EVENT, refresh );
		window.addEventListener( 'storage', refresh );
		return () => {
			window.removeEventListener( PREVIEW_HISTORY_CLEARED_EVENT, refresh );
			window.removeEventListener( 'storage', refresh );
		};
	}, [ site.id ] );

	useEffect( () => {
		if ( disabled ) {
			setRecentOpen( false );
			setHighlighted( undefined );
		}
	}, [ disabled ] );

	useEffect( () => {
		if ( remote || disabled || loading || ! pageTitle?.trim() ) return;
		const redirect = path.startsWith( '/studio-auto-login' )
			? new URLSearchParams( path.split( '?' )[ 1 ] ).get( 'redirect_to' )
			: null;
		const location = redirect ? getPathFromPreviewUrl( redirect, siteUrl ) ?? path : path;
		setRecentLocations(
			storeRecentLocation( site.id, {
				path: getRealmNavigationPath( location, siteUrl ),
				label: getDisplayUrl( siteUrl, location ),
				title: pageTitle.trim(),
			} )
		);
	}, [ site.id, siteUrl, path, pageTitle, loading, disabled, remote ] );

	const handleSubmit = ( event: FormEvent< HTMLFormElement > ) => {
		event.preventDefault();
		if ( disabled ) return;
		const intent = parseOmniboxInput( value, siteUrl );
		if ( ! intent ) {
			try {
				const url = new URL( value );
				if ( onExternalNavigate && [ 'http:', 'https:' ].includes( url.protocol ) ) {
					onExternalNavigate( url.href );
					setValue( displayUrl );
					setRecentOpen( false );
					return;
				}
			} catch {
				// Non-URL text follows the project search and validation behavior below.
			}
			setInvalid( value.trim() !== '' );
			return;
		}
		const nextPath =
			intent.type === 'search'
				? `/?s=${ encodeURIComponent( intent.term ) }`
				: remote
				? intent.path
				: getRealmNavigationPath( intent.path, siteUrl );
		if ( ! remote ) {
			const recentLabel = getDisplayUrl( siteUrl, intent.type === 'path' ? intent.path : nextPath );
			setRecentLocations( storeRecentLocation( site.id, { path: nextPath, label: recentLabel } ) );
		}
		setRecentOpen( false );
		onNavigate( nextPath );
	};
	const chooseRecentLocation = ( recent: RecentPreviewLocation ) => {
		setRecentLocations( storeRecentLocation( site.id, recent ) );
		setRecentOpen( false );
		onNavigate( recent.path );
	};
	const realmIcons: Record< PreviewRealm, ComponentType< { className?: string } > > = {
		frontend: GlobeIcon,
		admin: WordPressIcon,
		staff: UserRoundIcon,
		database: DatabaseIcon,
		email: MailIcon,
		design: AppearanceIcon,
	};
	const recentGroups: CommandGroup[] = [
		{
			label: __( 'Recent pages' ),
			items: recentLocations.map( ( recent ) => ( {
				value: `recent:${ recent.path }`,
				label: recent.title || recent.label,
				icon: realmIcons[ getPreviewRealm( recent.path ) ],
				trailing: recent.title ? (
					<span className={ styles.recentUrl }>
						— { recent.label.replace( /^https?:\/\//, '' ) }
					</span>
				) : undefined,
			} ) ),
		},
	];
	const isRecentOpen = recentOpen && ! disabled && ! remote && recentLocations.length > 0;
	const chooseRecent = ( value: string ) => {
		const recent = recentLocations.find( ( location ) => `recent:${ location.path }` === value );
		if ( recent ) chooseRecentLocation( recent );
	};

	return (
		<Popover.Root
			triggerId={ addressInputId }
			open={ isRecentOpen }
			// The webview swallows outside clicks; the modal backdrop catches them.
			modal
			onOpenChange={ ( open, details ) => {
				if ( disabled ) return;
				if ( details.reason === 'trigger-press' && ( recentOpen || remote ) ) return;
				setRecentOpen( open );
				setHighlighted( undefined );
				if ( ! open ) {
					restore();
				}
			} }
		>
			<form
				ref={ addressBarRef }
				className={ styles.addressBar }
				data-recent-open={ isRecentOpen || undefined }
				onSubmit={ handleSubmit }
			>
				<Popover.Trigger
					id={ addressInputId }
					nativeButton={ false }
					render={
						<Input
							variant="ghost"
							disabled={ disabled }
							role="textbox"
							value={ value }
							onMouseDown={ ( event ) => {
								selectOnMouseUp.current = document.activeElement !== event.currentTarget;
								if ( event.button === 0 && ! remote ) setRecentOpen( true );
							} }
							onMouseUp={ ( event ) => {
								if ( selectOnMouseUp.current ) {
									event.preventDefault();
									event.currentTarget.select();
									selectOnMouseUp.current = false;
								}
							} }
							onFocus={ ( event ) => {
								event.currentTarget.select();
								setRecentLocations( loadRecentLocations( site.id ) );
								setHighlighted( undefined );
								if ( ! remote ) setRecentOpen( true );
							} }
							onBlur={ () => {
								selectOnMouseUp.current = false;
							} }
							onChange={ ( event ) => {
								setValue( event.target.value );
								setHighlighted( undefined );
								setInvalid( false );
							} }
						/>
					}
					className={ styles.input }
					aria-controls={ isRecentOpen ? recentId : undefined }
					onKeyUp={ ( event ) => event.preventBaseUIHandler() }
					onKeyDown={ ( event ) => {
						event.preventBaseUIHandler();
						// Enter submits the address until a recent page is highlighted.
						if (
							isRecentOpen &&
							( event.key === 'ArrowDown' ||
								event.key === 'ArrowUp' ||
								( highlighted && event.key === 'Enter' ) )
						) {
							handleCommandKey( event, recentGroups, highlighted, setHighlighted, chooseRecent );
							return;
						}
						if ( event.key === 'Escape' ) {
							restore();
							setRecentOpen( false );
							event.currentTarget.blur();
						}
					} }
					aria-label={ __( 'Address' ) }
					aria-invalid={ invalid || undefined }
					title={ invalid ? __( 'Enter a path or an address on this site.' ) : undefined }
					spellCheck={ false }
				/>
				{ onOpenExternal ? (
					<span className={ styles.actions } data-address-action>
						<AddressAction
							icon={ <ExternalLinkIcon /> }
							label={ __( 'Open this page in your browser' ) }
							tooltip={ __( 'Open in browser' ) }
							onClick={ onOpenExternal }
							disabled={ disabled }
						/>
					</span>
				) : null }
			</form>
			<Popover.Popup
				anchor={ addressBarRef }
				side="bottom"
				align="start"
				alignOffset={ -4 }
				sideOffset={ 0 }
				initialFocus={ false }
				finalFocus={ false }
				aria-label={ __( 'Recent pages' ) }
				className={ styles.recentPopup }
			>
				<CommandList
					id={ recentId }
					label={ __( 'Recent pages' ) }
					radius="menu"
					groups={ recentGroups }
					highlighted={ highlighted }
					onHighlight={ setHighlighted }
					onSelect={ chooseRecent }
				/>
			</Popover.Popup>
		</Popover.Root>
	);
}
