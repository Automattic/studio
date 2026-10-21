import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import {
	bug,
	chartBar,
	chevronLeft,
	close as closeIcon,
	code,
	brush,
	closeSmall,
	Icon,
	keyboard,
	plugins,
	search as searchIcon,
	settings as slidersIcon,
	tool,
} from '@wordpress/icons';
import { Dialog, IconButton } from '@wordpress/ui';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import {
	AiPanel,
	AppearanceSettings,
	GeneralSettings,
	KeyboardPanel,
	McpPanel,
	SkillsPanel,
	UsagePanel,
} from '@/components/settings-view';
import { SiteSettingsForm } from '@/components/site-settings-view';
import { useSessions } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { chatIcon, settingsIcon } from '@/lib/icons';
import { readLastVisited } from '@/lib/last-visited';
import { SettingsDialogContext } from './context';
import styles from './style.module.css';
import type { SiteSettingsSectionId } from './context';
import type { ReactElement } from 'react';

const STUDIO_SECTIONS = [ 'general', 'appearance', 'ai', 'mcp', 'usage', 'skills', 'keyboard' ];
const SITE_SECTIONS = [ 'site', 'debugging', 'php' ];

export type SettingsSectionId =
	| 'general'
	| 'appearance'
	| 'ai'
	| 'mcp'
	| 'usage'
	| 'skills'
	| 'keyboard'
	| 'site'
	| 'php'
	| 'debugging';

export function isSettingsSection( value: unknown ): value is SettingsSectionId {
	return typeof value === 'string' && [ ...STUDIO_SECTIONS, ...SITE_SECTIONS ].includes( value );
}

type Section = {
	id: SettingsSectionId;
	label: string;
	icon: ReactElement;
	// Row titles inside the section, so search can find a single setting.
	settings: string[];
};

function getSections( scope: 'studio' | 'site' ): Section[] {
	return scope === 'studio'
		? [
				{
					id: 'general',
					label: __( 'General' ),
					icon: settingsIcon,
					settings: [
						__( 'Language' ),
						__( 'Code editor' ),
						__( 'Terminal' ),
						__( 'Default directory' ),
						__( 'Improve Studio for everyone' ),
						__( 'When Studio quits' ),
						__( 'Documentation' ),
						__( 'Report an issue' ),
					],
				},
				{
					id: 'appearance',
					label: __( 'Appearance' ),
					icon: brush,
					settings: [ __( 'Theme' ) ],
				},
				{
					id: 'ai',
					label: __( 'AI' ),
					icon: chatIcon,
					settings: [ __( 'Studio Code' ), __( 'Anthropic API key' ) ],
				},
				{ id: 'mcp', label: __( 'MCP' ), icon: plugins, settings: [] },
				{ id: 'usage', label: __( 'Usage' ), icon: chartBar, settings: [ __( 'AI credits' ) ] },
				{ id: 'skills', label: __( 'Skills' ), icon: tool, settings: [] },
				{ id: 'keyboard', label: __( 'Keyboard' ), icon: keyboard, settings: [] },
		  ]
		: [
				{
					id: 'site',
					label: __( 'Settings' ),
					icon: slidersIcon,
					settings: [
						__( 'Site name' ),
						__( 'WordPress version' ),
						__( 'Automatic updates' ),
						__( 'Use custom domain' ),
						__( 'Username' ),
						__( 'Password' ),
						__( 'Email' ),
					],
				},
				{
					id: 'debugging',
					label: __( 'Debug' ),
					icon: bug,
					settings: [
						__( 'Environment' ),
						__( 'Xdebug' ),
						__( 'Debug log' ),
						__( 'Script debugging' ),
						__( 'Show errors in browser' ),
					],
				},
				{
					id: 'php',
					label: __( 'PHP' ),
					icon: code,
					settings: [ __( 'PHP version' ), __( 'File access' ) ],
				},
		  ];
}

function StudioSection( { id }: { id: SettingsSectionId } ) {
	switch ( id ) {
		case 'appearance':
			return <AppearanceSettings />;
		case 'ai':
			return <AiPanel />;
		case 'mcp':
			return <McpPanel />;
		case 'usage':
			return <UsagePanel />;
		case 'skills':
			return <SkillsPanel />;
		case 'keyboard':
			return <KeyboardPanel />;
		default:
			return <GeneralSettings />;
	}
}

// The route's site, or the last one visited.
function useCurrentSiteId( requested?: string ) {
	const params = useParams( { strict: false } ) as { sessionId?: string; siteId?: string };
	const { data: sites } = useSites();
	const { data: sessions } = useSessions();
	const session = sessions?.find( ( candidate ) => candidate.id === params.sessionId );
	const siteId =
		requested ??
		params.siteId ??
		findAiSessionOwnerSite( sites, session )?.id ??
		readLastVisited()?.siteId;
	return sites?.find( ( site ) => site.id === siteId ) ?? sites?.[ 0 ];
}

/**
 * Studio and site settings in one dialog, opened over the current screen by the
 * `settings` search param (`?settings=php`). `settingsSite` picks a site other
 * than the current one.
 */
export function SettingsDialog() {
	const router = useRouter();
	const navigate = useNavigate();
	const { settings, settingsSite } = useSearch( { strict: false } ) as {
		settings?: SettingsSectionId;
		settingsSite?: string;
	};
	// Kept while the dialog animates closed.
	const [ shown, setShown ] = useState< SettingsSectionId >( settings ?? 'general' );
	if ( settings && settings !== shown ) {
		setShown( settings );
	}
	const site = useCurrentSiteId( settingsSite );
	const scope = SITE_SECTIONS.includes( shown ) && site ? 'site' : 'studio';
	const section = scope === 'site' || ! SITE_SECTIONS.includes( shown ) ? shown : 'general';
	const [ siteSection, setSiteSection ] = useState< SiteSettingsSectionId >( 'site' );
	if ( scope === 'site' && section !== siteSection ) {
		setSiteSection( section as SiteSettingsSectionId );
	}
	const [ history, setHistory ] = useState< SettingsSectionId[] >( [] );
	const [ query, setQuery ] = useState( '' );
	const [ highlight, setHighlight ] = useState< string | null >( null );
	const [ dirty, setDirty ] = useState( false );
	const [ actions, setActions ] = useState< HTMLElement | null >( null );
	const content = useRef< HTMLDivElement >( null );

	// Each opening starts fresh.
	useEffect( () => {
		if ( ! settings ) {
			setHistory( [] );
			setQuery( '' );
			setHighlight( null );
		}
	}, [ settings ] );

	const go = ( next: SettingsSectionId, { back = false } = {} ) => {
		if ( next !== section && ! back ) {
			setHistory( ( previous ) => [ ...previous, section ] );
		}
		void navigate( {
			to: '.',
			search: ( previous: Record< string, unknown > ) => ( { ...previous, settings: next } ),
			replace: true,
		} );
	};

	const close = () => {
		if ( dirty ) {
			actions?.querySelector< HTMLElement >( 'button' )?.focus();
			return;
		}
		if ( router.history.canGoBack() ) {
			router.history.back();
			return;
		}
		void navigate( {
			to: '.',
			search: ( { settings: _section, settingsSite: _site, ...rest }: Record< string, unknown > ) =>
				rest,
			replace: true,
		} );
	};

	// Shows the setting picked from the search results.
	useEffect( () => {
		if ( ! highlight ) {
			return;
		}
		const row = [ ...( content.current?.querySelectorAll( 'h2' ) ?? [] ) ]
			.find( ( title ) => title.textContent?.trim() === highlight )
			?.closest< HTMLElement >( '[data-settings-row]' );
		row?.scrollIntoView( { block: 'center' } );
		row?.setAttribute( 'data-settings-match', '' );
		const timeout = setTimeout( () => row?.removeAttribute( 'data-settings-match' ), 2000 );
		return () => {
			clearTimeout( timeout );
			row?.removeAttribute( 'data-settings-match' );
		};
	}, [ highlight, section ] );

	const words = query.trim().toLocaleLowerCase().split( /\s+/ ).filter( Boolean );
	const matches = ( text: string ) =>
		words.every( ( word ) => text.toLocaleLowerCase().includes( word ) );
	const results = words.length
		? ( [ 'studio', 'site' ] as const )
				.filter( ( candidate ) => candidate === 'studio' || site )
				.flatMap( ( candidate ) =>
					getSections( candidate ).flatMap( ( entry ) =>
						[ entry.label, ...entry.settings ]
							.filter( matches )
							.map( ( label ) => ( { scope: candidate, section: entry, label } ) )
					)
				)
		: [];
	const current = getSections( scope ).find( ( entry ) => entry.id === section )!;

	return (
		<Dialog.Root open={ !! settings } onOpenChange={ ( open ) => ! open && close() }>
			<Dialog.Popup size="stretch" className={ styles.popup }>
				<Dialog.Title className={ styles.visuallyHidden }>{ __( 'Settings' ) }</Dialog.Title>
				<div className={ styles.sidebar }>
					<div className={ styles.scopes } role="group" aria-label={ __( 'Settings for' ) }>
						{ ( [ 'studio', 'site' ] as const ).map( ( candidate ) => (
							<button
								key={ candidate }
								type="button"
								className={ styles.scope }
								aria-pressed={ scope === candidate }
								disabled={ candidate === 'site' && ! site }
								onClick={ () =>
									candidate !== scope && go( candidate === 'site' ? siteSection : 'general' )
								}
							>
								{ candidate === 'studio' ? __( 'Studio' ) : __( 'Site' ) }
							</button>
						) ) }
					</div>
					<div className={ styles.search }>
						<Icon icon={ searchIcon } size={ 16 } className={ styles.searchIcon } />
						<input
							className={ styles.searchInput }
							type="search"
							placeholder={ __( 'Search' ) }
							aria-label={ __( 'Search settings' ) }
							value={ query }
							onChange={ ( event ) => setQuery( event.target.value ) }
						/>
						{ query ? (
							<IconButton
								className={ styles.searchClear }
								variant="minimal"
								tone="neutral"
								size="small"
								icon={ closeSmall }
								label={ __( 'Clear search' ) }
								onClick={ () => setQuery( '' ) }
							/>
						) : null }
					</div>
					<nav className={ styles.nav } aria-label={ __( 'Settings sections' ) }>
						{ words.length && ! results.length ? (
							<p className={ styles.empty }>{ __( 'No settings found.' ) }</p>
						) : null }
						{ ( words.length
							? results
							: getSections( scope ).map( ( entry ) => ( {
									scope,
									section: entry,
									label: entry.label,
							  } ) )
						).map( ( item ) => (
							<button
								key={ `${ item.scope }-${ item.section.id }-${ item.label }` }
								type="button"
								className={ styles.navItem }
								aria-current={
									item.section.id === section && item.label === item.section.label
										? 'page'
										: undefined
								}
								onClick={ () => {
									go( item.section.id );
									setHighlight( item.label === item.section.label ? null : item.label );
								} }
							>
								<Icon icon={ item.section.icon } size={ 16 } className={ styles.navIcon } />
								<span className={ styles.navLabel }>{ item.label }</span>
								{ words.length ? (
									<span className={ styles.navScope }>
										{ item.scope === 'site' ? __( 'Site' ) : __( 'Studio' ) }
									</span>
								) : null }
							</button>
						) ) }
					</nav>
				</div>
				<div className={ styles.main }>
					<div className={ styles.header }>
						<IconButton
							variant="outline"
							tone="neutral"
							size="compact"
							icon={ chevronLeft }
							label={ __( 'Back' ) }
							disabled={ ! history.length }
							onClick={ () => {
								go( history.at( -1 )!, { back: true } );
								setHistory( ( previous ) => previous.slice( 0, -1 ) );
							} }
						/>
						<h2 className={ styles.title }>{ current.label }</h2>
						<div ref={ setActions } className={ styles.actions } />
						<IconButton
							variant="outline"
							tone="neutral"
							size="compact"
							icon={ closeIcon }
							label={ __( 'Close settings' ) }
							onClick={ close }
						/>
					</div>
					<div ref={ content } className={ styles.content }>
						<SettingsDialogContext.Provider value={ { actions, setDirty } }>
							{ scope === 'studio' ? <StudioSection id={ section } /> : null }
							{ site ? (
								<div className={ clsx( scope !== 'site' && styles.hidden ) }>
									<SiteSettingsForm
										key={ site.id }
										site={ site }
										section={ siteSection }
										active={ scope === 'site' }
									/>
								</div>
							) : null }
						</SettingsDialogContext.Provider>
					</div>
				</div>
			</Dialog.Popup>
		</Dialog.Root>
	);
}
