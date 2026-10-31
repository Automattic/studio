import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';
import { TRACKS_EVENTS, type TracksEventName } from '@studio/common/lib/record-tracks-event';
import { __ } from '@wordpress/i18n';
import { clsx } from 'clsx';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { getSiteFrontendUrl } from '@/features/sites/get-site-url';
import {
	AppearanceIcon,
	CodeIcon,
	DatabaseIcon,
	ExternalLinkIcon,
	GlobeIcon,
	ResponsiveIcon,
	WordPressIcon,
} from '@/lib/icons';
import { Tooltip, TooltipContent, TooltipTrigger, Popover, Button } from '@/lib/ui';
import { CommandList, handleCommandKey, type CommandGroup } from '@/lib/ui';
import styles from './address-bar.module.css';
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

/**
 * Where the preview is pointed. `frontend` is WordPress's own front end;
 * `frontend-app` is a headless site's frontend project, which runs on an origin
 * of its own, so its locations are absolute URLs on that origin rather than
 * paths on the site.
 */
export type PreviewRealm = 'frontend-app' | 'frontend' | 'admin' | 'database' | 'design';

export const DATABASE_HOME_PATH = '/phpmyadmin/index.php?route=/database/structure&db=wordpress';

const isAdminPath = ( path: string ) => /^\/wp-admin(?:[/?#]|$)/.test( path );
const isAbsoluteUrl = ( path: string ) => /^https?:\/\//i.test( path );

// A headless site's frontend URL as the origin the realm helpers compare
// against. Parse it once and pass the result to `getPreviewRealm` and
// `isFrontendAppPath`, which run for every location shown.
export function getFrontendOrigin( frontendUrl: string | undefined ): string | undefined {
	if ( ! frontendUrl ) {
		return undefined;
	}
	try {
		return new URL( frontendUrl ).origin;
	} catch {
		return undefined;
	}
}

// The frontend app location for `url` (its absolute URL) when it is on the
// frontend's origin.
function getFrontendAppPath( url: string, frontendOrigin: string | undefined ) {
	if ( ! frontendOrigin || ! isAbsoluteUrl( url ) ) {
		return null;
	}
	try {
		const parsed = new URL( url );
		return parsed.origin === frontendOrigin ? parsed.toString() : null;
	} catch {
		return null;
	}
}

// A path within the frontend app, resolved against its origin.
export function toFrontendAppPath( path: string, frontendUrl: string ): string {
	try {
		return new URL( path, frontendUrl ).toString();
	} catch {
		return `${ frontendUrl }${ path }`;
	}
}

export function isFrontendAppPath( path: string, frontendOrigin: string | undefined ): boolean {
	return getFrontendAppPath( path, frontendOrigin ) !== null;
}

// A url the preview reported, as a location: an absolute URL on the frontend
// app's origin, or a path on the WordPress site. Null for anywhere else.
export function getPreviewLocationFromUrl(
	url: string,
	siteUrl: string,
	frontendUrl: string | undefined
): string | null {
	return (
		getFrontendAppPath( url, getFrontendOrigin( frontendUrl ) ) ??
		getPathFromPreviewUrl( url, siteUrl )
	);
}

// The path within the frontend app's origin, for opening it elsewhere.
export function getFrontendAppRelativePath( path: string ): string {
	try {
		const parsed = new URL( path );
		return `${ parsed.pathname }${ parsed.search }${ parsed.hash }`;
	} catch {
		return path;
	}
}

export function getPreviewRealm( path: string, frontendOrigin?: string ): PreviewRealm {
	if ( path === DESIGN_SYSTEM_PREVIEW_PATH ) {
		return 'design';
	}
	if ( isFrontendAppPath( path, frontendOrigin ) ) {
		return 'frontend-app';
	}
	let target = path;
	if ( path.startsWith( '/studio-auto-login' ) ) {
		const query = path.split( '?' )[ 1 ] ?? '';
		const redirectTo = new URLSearchParams( query ).get( 'redirect_to' ) ?? '';
		target = redirectTo.replace( /^https?:\/\/[^/?#]*/i, '' );
	}
	if ( isAdminPath( target ) ) {
		return 'admin';
	}
	if ( /^\/phpmyadmin(?:[/?#]|$)/.test( target ) ) {
		return 'database';
	}
	return 'frontend';
}

const REALM_OPEN_EVENTS: Record< PreviewRealm, TracksEventName > = {
	'frontend-app': TRACKS_EVENTS.SITE_OPEN_IN_BROWSER,
	frontend: TRACKS_EVENTS.SITE_OPEN_IN_BROWSER,
	admin: TRACKS_EVENTS.SITE_OPEN_WP_ADMIN,
	database: TRACKS_EVENTS.SITE_OPEN_PHPMYADMIN,
	design: TRACKS_EVENTS.SITE_OPEN_DESIGN_SYSTEM,
};

export function getRealmOpenEvent( realm: PreviewRealm ): TracksEventName {
	return REALM_OPEN_EVENTS[ realm ];
}

export function getRealmNavigationPath( path: string, siteUrl: string ): string {
	if ( ! isAdminPath( path ) ) {
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

// WordPress tools a headless site keeps on the WordPress origin, whichever realm
// the address is typed in.
const isWordPressToolPath = ( path: string ) =>
	isAdminPath( path ) || /^\/(?:phpmyadmin|wp-login\.php)(?:[/?#]|$)/.test( path );

export function parseOmniboxInput(
	raw: string,
	siteUrl: string,
	{
		frontendUrl,
		inFrontendApp = false,
	}: {
		// A headless site's frontend origin, whose addresses are accepted too.
		frontendUrl?: string;
		// Relative paths resolve within the frontend app.
		inFrontendApp?: boolean;
	} = {}
): OmniboxIntent | null {
	const value = raw.trim();
	if ( ! value ) {
		return null;
	}
	// `//host/` is an address on another host, not a path.
	if ( /^(?:https?:)?\/\//i.test( value ) ) {
		const path =
			getFrontendAppPath( value, getFrontendOrigin( frontendUrl ) ) ??
			getPathFromPreviewUrl( value, siteUrl );
		return path ? { type: 'path', path } : null;
	}
	if ( /\s/.test( value ) ) {
		return { type: 'search', term: value };
	}
	const path = value.startsWith( '/' )
		? value
		: value.includes( '/' ) || value.includes( '?' )
		? `/${ value }`
		: null;
	if ( path === null ) {
		return { type: 'search', term: value };
	}
	if ( inFrontendApp && frontendUrl && ! isWordPressToolPath( path ) ) {
		return { type: 'path', path: toFrontendAppPath( path, frontendUrl ) };
	}
	return { type: 'path', path };
}

interface PreviewAddressBarProps {
	site: SiteDetails;
	siteUrl: string;
	path: string;
	// A remote site: no local realms, auto-login or recent locations.
	remote?: boolean;
	onNavigate: ( path: string ) => void;
	onSwitchRealm: ( realm: PreviewRealm ) => void;
	hasDesignSystem?: boolean;
	onOpenExternal?: () => void;
	responsive?: { active: boolean; disabled: boolean; onClick: () => void };
	// In compact headers, keep only the address and an active responsive toggle.
	hideActions?: boolean;
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
		// Storage may be unavailable or full.
	}
	return locations;
}

function getDisplayUrl( siteUrl: string, path: string ): string {
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
	active,
	disabled,
}: {
	icon: ReactNode;
	label: string;
	tooltip?: string;
	onClick: () => void;
	active?: boolean;
	disabled?: boolean;
} ) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant={ active === undefined ? 'ghost' : 'accent-ghost' }
						size="icon-sm"
						shape="round"
						className={ styles.action }
						aria-label={ label }
						aria-pressed={ active }
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
	onSwitchRealm,
	hasDesignSystem = false,
	onOpenExternal,
	responsive,
	hideActions = false,
}: PreviewAddressBarProps ) {
	const frontendUrl = remote ? undefined : getSiteFrontendUrl( site );
	const frontendOrigin = useMemo( () => getFrontendOrigin( frontendUrl ), [ frontendUrl ] );
	const inFrontendApp = getPreviewRealm( path, frontendOrigin ) === 'frontend-app';
	const displayUrl = getDisplayUrl( siteUrl, path );
	const [ value, setValue ] = useState( displayUrl );
	const [ invalid, setInvalid ] = useState( false );
	const [ shortcutsOpen, setShortcutsOpen ] = useState( false );
	const [ highlighted, setHighlighted ] = useState< string >();
	const shortcutsId = useId();
	const addressInputId = useId();
	const [ recentLocations, setRecentLocations ] = useState< RecentPreviewLocation[] >( () =>
		loadRecentLocations( site.id )
	);
	const addressBarRef = useRef< HTMLFormElement | null >( null );
	const addressTextRef = useRef< HTMLSpanElement | null >( null );
	const selectOnMouseUp = useRef( false );

	const animateAddressAlignment = ( input: HTMLInputElement, focused: boolean ) => {
		const style = getComputedStyle( input );
		const currentOffset =
			style.transform && style.transform !== 'none'
				? new DOMMatrixReadOnly( style.transform ).m41
				: 0;
		input.getAnimations?.().forEach( ( animation ) => animation.cancel() );
		const textWidth = addressTextRef.current?.getBoundingClientRect().width ?? 0;
		const offset = Math.max( 0, ( input.clientWidth - textWidth ) / 2 );
		if ( ! offset || window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) return;
		const direction = style.direction === 'rtl' ? -1 : 1;
		const start = currentOffset + offset * direction * ( focused ? 1 : -1 );
		const duration = style.getPropertyValue( '--motion-duration-surface' ).trim();
		input.animate( [ { transform: `translateX(${ start }px)` }, { transform: 'translateX(0)' } ], {
			duration: parseFloat( duration ) * ( duration.endsWith( 'ms' ) ? 1 : 1000 ),
			easing: style.getPropertyValue( '--motion-ease-enter' ).trim(),
		} );
	};

	const recentLocationRealms = useMemo(
		() => recentLocations.map( ( recent ) => getPreviewRealm( recent.path, frontendOrigin ) ),
		[ recentLocations, frontendOrigin ]
	);

	const restore = () => {
		setValue( displayUrl );
		setInvalid( false );
	};
	useEffect( () => {
		setValue( displayUrl );
		setInvalid( false );
	}, [ displayUrl ] );
	useEffect( () => setRecentLocations( loadRecentLocations( site.id ) ), [ site.id ] );

	const handleSubmit = ( event: FormEvent< HTMLFormElement > ) => {
		event.preventDefault();
		const intent = parseOmniboxInput( value, siteUrl, { frontendUrl, inFrontendApp } );
		if ( ! intent ) {
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
	const realmIcons: Record< PreviewRealm, ComponentType< { className?: string } > > = {
		'frontend-app': CodeIcon,
		frontend: GlobeIcon,
		admin: WordPressIcon,
		database: DatabaseIcon,
		design: AppearanceIcon,
	};
	const realmLabels: Record< PreviewRealm, string > = {
		'frontend-app': __( 'Frontend app' ),
		// Beside a headless site's frontend app, its own front end is WordPress's.
		frontend: frontendUrl ? __( 'WordPress' ) : __( 'Front end' ),
		admin: __( 'WordPress Admin' ),
		database: __( 'Database' ),
		design: __( 'Design system' ),
	};
	const realms: PreviewRealm[] = [
		...( frontendUrl ? [ 'frontend-app' as const ] : [] ),
		'frontend',
		'admin',
		'database',
		...( hasDesignSystem ? [ 'design' as const ] : [] ),
	];
	const shortcutGroups: CommandGroup[] = [
		{
			label: __( 'Preview shortcuts' ),
			items: realms.map( ( realm ) => ( {
				value: realm,
				label: realmLabels[ realm ],
				icon: realmIcons[ realm ],
			} ) ),
		},
		{
			label: __( 'Recent' ),
			heading: __( 'Recent' ),
			items: recentLocations.map( ( recent, index ) => ( {
				value: `recent:${ recent.path }`,
				label: recent.label,
				icon: realmIcons[ recentLocationRealms[ index ] ],
			} ) ),
		},
	];
	const chooseShortcut = ( value: string ) => {
		const recent = recentLocations.find( ( location ) => `recent:${ location.path }` === value );
		if ( recent ) {
			chooseRecentLocation( recent );
		} else {
			chooseRealm( value as PreviewRealm );
		}
	};
	return (
		<Popover.Root
			triggerId={ addressInputId }
			open={ shortcutsOpen }
			// The webview swallows outside clicks; the modal backdrop catches them.
			modal
			onOpenChange={ ( open, details ) => {
				if ( details.reason === 'trigger-press' && ( shortcutsOpen || remote ) ) return;
				setShortcutsOpen( open );
				setHighlighted( undefined );
				if ( ! open ) {
					restore();
				}
			} }
		>
			<form
				ref={ addressBarRef }
				className={ clsx( styles.addressBar, responsive?.active && styles.responsiveActive ) }
				onSubmit={ handleSubmit }
			>
				{ ! responsive || ( hideActions && ! responsive.active ) ? null : (
					<span
						className={ `${ styles.actions } ${ styles.responsiveAction }` }
						data-address-action
					>
						<AddressAction
							icon={ <ResponsiveIcon /> }
							label={ __( 'Responsive mode' ) }
							tooltip={ responsive.active ? __( 'Exit responsive mode' ) : __( 'Responsive mode' ) }
							active={ responsive.active }
							disabled={ responsive.disabled }
							onClick={ responsive.onClick }
						/>
					</span>
				) }
				<span ref={ addressTextRef } className={ styles.addressText } aria-hidden="true">
					{ value }
				</span>
				<Popover.Trigger
					id={ addressInputId }
					nativeButton={ false }
					render={
						<input
							role="textbox"
							value={ value }
							onMouseDown={ ( event ) => {
								selectOnMouseUp.current = document.activeElement !== event.currentTarget;
								if ( event.button === 0 && ! remote ) setShortcutsOpen( true );
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
								if ( ! remote ) setShortcutsOpen( true );
								animateAddressAlignment( event.currentTarget, true );
							} }
							onBlur={ ( event ) => {
								selectOnMouseUp.current = false;
								animateAddressAlignment( event.currentTarget, false );
							} }
							onChange={ ( event ) => {
								setValue( event.target.value );
								setInvalid( false );
							} }
						/>
					}
					className={ styles.input }
					aria-controls={ shortcutsOpen ? shortcutsId : undefined }
					onKeyUp={ ( event ) => event.preventBaseUIHandler() }
					onKeyDown={ ( event ) => {
						event.preventBaseUIHandler();
						// Enter goes to the typed address until a shortcut is highlighted.
						if (
							shortcutsOpen &&
							( event.key === 'ArrowDown' ||
								event.key === 'ArrowUp' ||
								( highlighted && event.key === 'Enter' ) )
						) {
							handleCommandKey(
								event,
								shortcutGroups,
								highlighted,
								setHighlighted,
								chooseShortcut
							);
							return;
						}
						if ( event.key === 'Escape' ) {
							restore();
							setShortcutsOpen( false );
							event.currentTarget.blur();
						}
					} }
					aria-label={ __( 'Address' ) }
					aria-invalid={ invalid || undefined }
					title={ invalid ? __( 'Enter a path or an address on this site.' ) : undefined }
					spellCheck={ false }
				/>
				{ hideActions ? null : (
					<span className={ styles.actions } data-address-action>
						{ onOpenExternal ? (
							<AddressAction
								icon={ <ExternalLinkIcon /> }
								label={ __( 'Open this page in your browser' ) }
								tooltip={ __( 'Open in browser' ) }
								onClick={ onOpenExternal }
							/>
						) : null }
					</span>
				) }
			</form>
			<Popover.Popup
				anchor={ addressBarRef }
				side="bottom"
				align="start"
				sideOffset={ 4 }
				initialFocus={ false }
				finalFocus={ false }
				aria-label={ __( 'Preview shortcuts' ) }
				className={ styles.shortcutsPopup }
			>
				<CommandList
					id={ shortcutsId }
					label={ __( 'Preview shortcuts' ) }
					groups={ shortcutGroups }
					highlighted={ highlighted }
					onHighlight={ setHighlighted }
					onSelect={ chooseShortcut }
					className={ styles.shortcuts }
				/>
			</Popover.Popup>
		</Popover.Root>
	);
}
