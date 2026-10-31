import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';
import { TRACKS_EVENTS, type TracksEventName } from '@studio/common/lib/record-tracks-event';
import { __ } from '@wordpress/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import {
	AppearanceIcon,
	DatabaseIcon,
	ExternalLinkIcon,
	GlobeIcon,
	WordPressIcon,
} from '@/lib/icons';
import { Tooltip, TooltipContent, TooltipTrigger, Popover, Button, Input } from '@/lib/ui';
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

export type PreviewRealm = 'frontend' | 'admin' | 'database' | 'design';

export const DATABASE_HOME_PATH = '/phpmyadmin/index.php?route=/database/structure&db=wordpress';

const isAdminPath = ( path: string ) => /^\/wp-admin(?:[/?#]|$)/.test( path );

export function getPreviewRealm( path: string ): PreviewRealm {
	if ( path === DESIGN_SYSTEM_PREVIEW_PATH ) {
		return 'design';
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
	onSwitchRealm: ( realm: PreviewRealm ) => void;
	hasDesignSystem?: boolean;
	onOpenExternal?: () => void;
	// In compact headers, keep only the address.
	hideActions?: boolean;
	disabled?: boolean;
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
						size="icon-sm"
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
	onSwitchRealm,
	hasDesignSystem = false,
	onOpenExternal,
	hideActions = false,
	disabled = false,
}: PreviewAddressBarProps ) {
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
		if ( disabled ) {
			setShortcutsOpen( false );
			setHighlighted( undefined );
		}
	}, [ disabled ] );

	const handleSubmit = ( event: FormEvent< HTMLFormElement > ) => {
		event.preventDefault();
		if ( disabled ) return;
		const intent = parseOmniboxInput( value, siteUrl );
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
		frontend: GlobeIcon,
		admin: WordPressIcon,
		database: DatabaseIcon,
		design: AppearanceIcon,
	};
	const realmLabels: Record< PreviewRealm, string > = {
		frontend: __( 'Front end' ),
		admin: __( 'WordPress Admin' ),
		database: __( 'Database' ),
		design: __( 'Design system' ),
	};
	const realms: PreviewRealm[] = [
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
			items: recentLocations.map( ( recent ) => ( {
				value: `recent:${ recent.path }`,
				label: recent.label,
				icon: realmIcons[ getPreviewRealm( recent.path ) ],
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
			open={ shortcutsOpen && ! disabled }
			// The webview swallows outside clicks; the modal backdrop catches them.
			modal
			onOpenChange={ ( open, details ) => {
				if ( disabled ) return;
				if ( details.reason === 'trigger-press' && ( shortcutsOpen || remote ) ) return;
				setShortcutsOpen( open );
				setHighlighted( undefined );
				if ( ! open ) {
					restore();
				}
			} }
		>
			<form ref={ addressBarRef } className={ styles.addressBar } onSubmit={ handleSubmit }>
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
							} }
							onBlur={ () => {
								selectOnMouseUp.current = false;
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
								disabled={ disabled }
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
