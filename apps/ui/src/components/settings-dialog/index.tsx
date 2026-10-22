import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import { useNavigate, useParams, useRouter, useSearch } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import {
	bug,
	chartBar,
	chevronLeft,
	code,
	brush,
	closeSmall,
	Icon,
	keyboard,
	page,
	plugins,
	search as searchIcon,
	settings as slidersIcon,
	tool,
} from '@wordpress/icons';
import { clsx } from 'clsx';
import { useEffect, useRef, useState } from 'react';
import {
	AiPanel,
	AppearanceSettings,
	GeneralSettings,
	InstructionsSettings,
	KeyboardPanel,
	McpPanel,
	SharingPanel,
	SkillsPanel,
	UsagePanel,
} from '@/components/settings-view';
import { SiteSettingsForm } from '@/components/site-settings-view';
import { IconButton } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogPanel,
	DialogTitle,
	PanelHeader,
} from '@/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { useSessions } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { chatIcon, settingsIcon, shareIcon } from '@/lib/icons';
import { readLastVisited } from '@/lib/last-visited';
import { SettingsDialogContext } from './context';
import { SiteAgentFiles } from './site-agent-files';
import styles from './style.module.css';
import type { SiteSettingsSectionId } from './context';
import type { ReactElement } from 'react';

const STUDIO_SECTIONS = [
	'general',
	'appearance',
	'sharing',
	'ai',
	'mcp',
	'usage',
	'skills',
	'instructions',
	'keyboard',
];
const SITE_SECTIONS = [ 'site', 'debugging', 'php', 'site-skills', 'site-instructions' ];
const SITE_FORM_SECTIONS = [ 'site', 'debugging', 'php' ];

export type SettingsSectionId =
	| 'general'
	| 'appearance'
	| 'sharing'
	| 'ai'
	| 'mcp'
	| 'usage'
	| 'skills'
	| 'keyboard'
	| 'site'
	| 'php'
	| 'debugging'
	| 'instructions'
	| 'site-skills'
	| 'site-instructions';

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
					id: 'sharing',
					label: __( 'Sharing' ),
					icon: shareIcon,
					settings: [ __( 'Sharing previews on WordPress.com' ), __( 'Live previews' ) ],
				},
				{
					id: 'ai',
					label: __( 'AI' ),
					icon: chatIcon,
					settings: [ __( 'Studio Code' ), __( 'Anthropic API key' ) ],
				},
				{ id: 'mcp', label: __( 'MCP' ), icon: plugins, settings: [] },
				{ id: 'usage', label: __( 'Usage' ), icon: chartBar, settings: [ __( 'AI credits' ) ] },
				{ id: 'skills', label: __( 'Skills' ), icon: tool, settings: [ __( 'WordPress skills' ) ] },
				{
					id: 'instructions',
					label: __( 'Instructions' ),
					icon: page,
					settings: [ __( 'Agent instructions' ) ],
				},
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
				{
					id: 'site-skills',
					label: __( 'Skills' ),
					icon: tool,
					settings: [ __( 'Skills on this site' ) ],
				},
				{
					id: 'site-instructions',
					label: __( 'Instructions' ),
					icon: page,
					settings: [ __( 'Instructions on this site' ) ],
				},
		  ];
}

function StudioSection( {
	id,
	onManageSite,
}: {
	id: SettingsSectionId;
	onManageSite?: () => void;
} ) {
	switch ( id ) {
		case 'appearance':
			return <AppearanceSettings />;
		case 'sharing':
			return <SharingPanel />;
		case 'ai':
			return <AiPanel />;
		case 'mcp':
			return <McpPanel />;
		case 'usage':
			return <UsagePanel />;
		case 'skills':
			return <SkillsPanel />;
		case 'instructions':
			return <InstructionsSettings onManageSite={ onManageSite } />;
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
	const { settings, settingsSite, settingsFocus } = useSearch( { strict: false } ) as {
		settings?: SettingsSectionId;
		settingsSite?: string;
		settingsFocus?: string;
	};
	// Kept while the dialog animates closed.
	const [ shown, setShown ] = useState< SettingsSectionId >( settings ?? 'general' );
	if ( settings && settings !== shown ) {
		setShown( settings );
	}
	const site = useCurrentSiteId( settingsSite );
	const scope = SITE_SECTIONS.includes( shown ) && site ? 'site' : 'studio';
	const section = scope === 'site' || ! SITE_SECTIONS.includes( shown ) ? shown : 'general';
	const [ siteSection, setSiteSection ] = useState< SettingsSectionId >( 'site' );
	if ( scope === 'site' && section !== siteSection ) {
		setSiteSection( section );
	}
	// The form stays on its last section while a skills or instructions section shows.
	const [ formSection, setFormSection ] = useState< SiteSettingsSectionId >( 'site' );
	if ( SITE_FORM_SECTIONS.includes( siteSection ) && siteSection !== formSection ) {
		setFormSection( siteSection as SiteSettingsSectionId );
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
			search: ( {
				settings: _section,
				settingsSite: _site,
				settingsFocus: _focus,
				...rest
			}: Record< string, unknown > ) => rest,
			replace: true,
		} );
	};

	const findRow = ( title: string ) =>
		[
			...( content.current?.querySelectorAll( '[data-settings-row] [data-slot="field-label"]' ) ??
				[] ),
		]
			.find( ( label ) => label.textContent?.trim() === title )
			?.closest< HTMLElement >( '[data-settings-row]' );

	// Shows the setting picked from the search results.
	useEffect( () => {
		if ( ! highlight ) {
			return;
		}
		const row = findRow( highlight );
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
		<Dialog
			open={ !! settings }
			onOpenChange={ ( open ) => ! open && close() }
			// Focuses the setting the dialog was opened for.
			onOpenChangeComplete={ ( open ) =>
				open && settingsFocus && findRow( settingsFocus )?.querySelector( 'input' )?.select()
			}
		>
			<DialogContent layout="settings" className={ styles.popup }>
				<DialogTitle render={ <VisuallyHidden /> }>{ __( 'Settings' ) }</DialogTitle>
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
					<InputGroup className={ styles.search }>
						<InputGroupInput
							placeholder={ __( 'Search' ) }
							aria-label={ __( 'Search settings' ) }
							value={ query }
							onChange={ ( event ) => setQuery( event.target.value ) }
						/>
						<InputGroupAddon>
							<Icon icon={ searchIcon } size={ 16 } className={ styles.searchIcon } />
						</InputGroupAddon>
						{ query ? (
							<InputGroupAddon align="inline-end">
								<IconButton
									size="icon-xs"
									icon={ closeSmall }
									label={ __( 'Clear search' ) }
									onClick={ () => setQuery( '' ) }
								/>
							</InputGroupAddon>
						) : null }
					</InputGroup>
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
				<DialogPanel
					className={ styles.content }
					scrollRef={ content }
					header={
						<PanelHeader
							leading={
								<IconButton
									variant="segmented"
									size="icon-sm"
									icon={ chevronLeft }
									label={ __( 'Back' ) }
									disabled={ ! history.length }
									onClick={ () => {
										go( history.at( -1 )!, { back: true } );
										setHistory( ( previous ) => previous.slice( 0, -1 ) );
									} }
								/>
							}
							title={ current.label }
							actions={ <div ref={ setActions } className={ styles.actions } /> }
							onClose={ close }
							closeLabel={ __( 'Close settings' ) }
						/>
					}
				>
					<SettingsDialogContext.Provider value={ { actions, setDirty } }>
						{ scope === 'studio' ? (
							<StudioSection
								id={ section }
								onManageSite={ site ? () => go( 'site-instructions' ) : undefined }
							/>
						) : null }
						{ site ? (
							<>
								{ scope === 'site' &&
								( section === 'site-skills' || section === 'site-instructions' ) ? (
									<SiteAgentFiles
										key={ `${ site.id }-${ section }` }
										siteId={ site.id }
										kind={ section === 'site-skills' ? 'skills' : 'instructions' }
										onManageAll={ () =>
											go( section === 'site-skills' ? 'skills' : 'instructions' )
										}
									/>
								) : null }
								<div
									className={ clsx(
										( scope !== 'site' || ! SITE_FORM_SECTIONS.includes( section ) ) &&
											styles.hidden
									) }
								>
									<SiteSettingsForm
										key={ site.id }
										site={ site }
										section={ formSection }
										active={ scope === 'site' && SITE_FORM_SECTIONS.includes( section ) }
									/>
								</div>
							</>
						) : null }
					</SettingsDialogContext.Provider>
				</DialogPanel>
			</DialogContent>
		</Dialog>
	);
}
