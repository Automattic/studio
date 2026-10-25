import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import {
	useNavigate,
	useParams,
	useRouter,
	useRouterState,
	useSearch,
} from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { ariaKeyShortcut, displayShortcut, isKeyboardEvent } from '@wordpress/keycodes';
import { clsx } from 'clsx';
import { ChevronLeftIcon, SearchIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/data/app-messages';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useSessions } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';
import { getSections, isSiteSection, searchSettings } from '@/data/settings-sections';
import { closeOnPaletteShortcut } from '@/data/use-command-palette';
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
} from '@/features/settings/settings-view';
import { SiteSettingsForm } from '@/features/settings/site-settings-view';
import { readLastVisited } from '@/features/sidebar';
import {
	IconButton,
	Dialog,
	DialogContent,
	DialogPanel,
	DialogTitle,
	PanelHeader,
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	MarqueeLabel,
	Tabs,
	TabsList,
	TabsScopeIndicator,
	TabsScopeLabel,
	TabsSidebar,
	TabsTrigger,
	VisuallyHidden,
} from '@/lib/ui';
import { SettingsDialogContext, SettingsLinkContext } from './context';
import { SiteAgentFiles } from './site-agent-files';
import styles from './style.module.css';
import type { SiteSettingsSectionId } from './context';
import type { SearchResult, SettingsScope, SettingsSectionId } from '@/data/settings-sections';

const SITE_FORM_SECTIONS: SettingsSectionId[] = [ 'site', 'debugging', 'php' ];

function StudioSection( {
	id,
	onNavigate,
	hasSite,
}: {
	id: SettingsSectionId;
	onNavigate: ( section: SettingsSectionId ) => void;
	hasSite: boolean;
} ) {
	switch ( id ) {
		case 'appearance':
			return <AppearanceSettings />;
		case 'sharing':
			return <SharingPanel />;
		case 'ai':
			return <AiPanel onManageCredits={ () => onNavigate( 'usage' ) } />;
		case 'mcp':
			return <McpPanel />;
		case 'usage':
			return <UsagePanel />;
		case 'skills':
			return (
				<SkillsPanel onManageSite={ hasSite ? () => onNavigate( 'site-skills' ) : undefined } />
			);
		case 'instructions':
			return (
				<InstructionsSettings
					onManageSite={ hasSite ? () => onNavigate( 'site-instructions' ) : undefined }
				/>
			);
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

// A setting's row, by its link id or its title.
function findRow( root: HTMLElement, target: string ) {
	return [ ...root.querySelectorAll< HTMLElement >( '[data-settings-row]' ) ].find(
		( row ) =>
			row.dataset.settingId === target ||
			row.querySelector( '[data-slot="field-label"]' )?.textContent?.trim() === target
	);
}

function focusControl( row: HTMLElement ) {
	const control =
		row.querySelector< HTMLElement >(
			'input:not(:disabled):not([type="hidden"]):not([aria-hidden="true"]), textarea:not(:disabled), [role="switch"]:not([data-disabled]), [role="combobox"]:not(:disabled)'
		) ??
		row.querySelector< HTMLElement >(
			':scope > [data-slot="field-content"] ~ * button:not(:disabled)'
		);
	control?.focus( { preventScroll: true } );
	if ( control instanceof HTMLInputElement ) {
		control.select();
	}
}

/**
 * Studio and site settings in one dialog, opened over the current screen by the
 * `settings` search param (`?settings=php`). `settingsSite` picks a site other
 * than the current one, and `settingsFocus` a setting, by link id or title.
 */
export function SettingsDialog() {
	const router = useRouter();
	const navigate = useNavigate();
	const { settings, settingsSite, settingsFocus } = useSearch( { strict: false } ) as {
		settings?: SettingsSectionId;
		settingsSite?: string;
		settingsFocus?: string;
	};
	const user = useAuthUser();
	const signedIn = ! user.isSuccess || !! user.data;
	// Kept while the dialog animates closed.
	const [ shown, setShown ] = useState< SettingsSectionId >( settings ?? 'general' );
	if ( settings && settings !== shown ) {
		setShown( settings );
	}
	const site = useCurrentSiteId( settingsSite );
	const requested = shown === 'usage' && ! signedIn ? 'ai' : shown;
	const scope: SettingsScope = isSiteSection( requested ) && site ? 'site' : 'studio';
	const section = scope === 'site' || ! isSiteSection( requested ) ? requested : 'general';
	const [ siteSection, setSiteSection ] = useState< SettingsSectionId >( 'site' );
	if ( scope === 'site' && section !== siteSection ) {
		setSiteSection( section );
	}
	// The form stays on its last section while a skills or instructions section shows.
	const [ formSection, setFormSection ] = useState< SiteSettingsSectionId >( 'site' );
	if ( SITE_FORM_SECTIONS.includes( siteSection ) && siteSection !== formSection ) {
		setFormSection( siteSection as SiteSettingsSectionId );
	}
	const [ history, setHistory ] = useState( { entries: [] as SettingsSectionId[], index: -1 } );
	const [ query, setQuery ] = useState( '' );
	// The setting to reveal, by link id or title.
	const [ target, setTarget ] = useState< string | null >( null );
	const [ requestedFocus, setRequestedFocus ] = useState< string >();
	if ( settingsFocus !== requestedFocus ) {
		setRequestedFocus( settingsFocus );
		setTarget( settingsFocus ?? null );
	}
	// Closing steps back to the page Settings opened over, while that page is still below.
	const pathname = useRouterState( { select: ( state ) => state.location.pathname } );
	const [ openedOver, setOpenedOver ] = useState< string >();
	if ( settings && ! openedOver ) {
		setOpenedOver( pathname );
	} else if ( ! settings && openedOver ) {
		setOpenedOver( undefined );
	}
	const [ dirty, setDirty ] = useState( false );
	const [ actions, setActions ] = useState< HTMLElement | null >( null );
	const [ content, setContent ] = useState< HTMLDivElement | null >( null );
	const pendingExit = useRef< ( () => void ) | null >( null );

	// Each opening starts fresh.
	useEffect( () => {
		if ( ! settings ) {
			setHistory( { entries: [], index: -1 } );
			setQuery( '' );
			setTarget( null );
			pendingExit.current = null;
		}
	}, [ settings ] );

	// Every section shown joins the history, unless Back or Forward led there.
	useEffect( () => {
		if ( settings ) {
			setHistory( ( current ) =>
				current.entries[ current.index ] === section
					? current
					: {
							entries: [ ...current.entries.slice( 0, current.index + 1 ), section ],
							index: current.index + 1,
					  }
			);
		}
	}, [ settings, section ] );

	const go = ( next: SettingsSectionId ) => {
		setTarget( null );
		void navigate( {
			to: '.',
			search: ( { settingsFocus: _focus, ...previous }: Record< string, unknown > ) => ( {
				...previous,
				settings: next,
			} ),
			replace: true,
		} );
	};

	const traverse = ( step: -1 | 1 ) => {
		const index = history.index + step;
		const next = history.entries[ index ];
		if ( next ) {
			setHistory( { ...history, index } );
			go( next );
		}
	};

	const closeNow = () => {
		if ( openedOver === pathname && router.history.canGoBack() ) {
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

	// With unsaved site changes, closing waits for Discard or Save.
	const close = () => {
		if ( dirty ) {
			pendingExit.current = closeNow;
			actions?.querySelector< HTMLElement >( 'button' )?.focus();
			return;
		}
		closeNow();
	};

	const settle = useCallback( () => {
		const exit = pendingExit.current;
		pendingExit.current = null;
		exit?.();
	}, [] );

	// Reveals and focuses the setting a link or search result points at.
	useEffect( () => {
		const root = content;
		if ( ! target || ! root ) {
			return;
		}
		let row: HTMLElement | undefined;
		let frame = 0;
		const reveal = () => {
			row = findRow( root, target );
			if ( ! row ) {
				return;
			}
			observer.disconnect();
			row.scrollIntoView?.( { block: 'center' } );
			row.setAttribute( 'data-settings-match', '' );
			frame = requestAnimationFrame( () => row && focusControl( row ) );
		};
		const observer = new MutationObserver( reveal );
		observer.observe( root, { childList: true, subtree: true } );
		reveal();
		const timeout = setTimeout( () => {
			observer.disconnect();
			if ( ! row ) {
				toast.info( __( 'This setting is not available on this device.' ) );
			}
			setTarget( null );
		}, 3000 );
		return () => {
			clearTimeout( timeout );
			cancelAnimationFrame( frame );
			observer.disconnect();
			row?.removeAttribute( 'data-settings-match' );
		};
	}, [ target, section, content ] );

	const results = searchSettings( query, scope, { hasSite: !! site, signedIn } );
	const searching = !! query.trim();
	const open = ( result: SearchResult ) => {
		go( result.section.id );
		if ( result.setting ) {
			setTarget( result.setting.id ?? result.setting.title );
		}
	};
	const current = getSections( scope, { signedIn } ).find( ( entry ) => entry.id === section )!;

	return (
		<Dialog open={ !! settings } onOpenChange={ ( isOpen ) => ! isOpen && close() }>
			<DialogContent
				layout="settings"
				onInputCapture={ () => {
					pendingExit.current = null;
				} }
				onKeyDown={ ( event ) => {
					closeOnPaletteShortcut( close )( event );
					const step = isKeyboardEvent.primary( event.nativeEvent, '[' )
						? -1
						: isKeyboardEvent.primary( event.nativeEvent, ']' )
						? 1
						: 0;
					if ( step ) {
						event.preventDefault();
						traverse( step );
					}
				} }
			>
				<DialogTitle render={ <VisuallyHidden /> }>{ __( 'Settings' ) }</DialogTitle>
				<Tabs
					orientation="vertical"
					layout="sidebar"
					value={ searching ? null : section }
					onValueChange={ ( next: SettingsSectionId ) => go( next ) }
				>
					<TabsSidebar>
						<Tabs
							value={ scope }
							onValueChange={ ( next: SettingsScope ) =>
								go( next === 'site' ? siteSection : 'general' )
							}
						>
							<TabsList
								variant="scope"
								aria-label={ __( 'Settings scope' ) }
								className={ styles.scopes }
							>
								<TabsTrigger value="studio">{ __( 'Studio' ) }</TabsTrigger>
								<TabsTrigger value="site" disabled={ ! site }>
									{ __( 'Site' ) }
								</TabsTrigger>
								<TabsScopeIndicator />
							</TabsList>
						</Tabs>
						<InputGroup className={ styles.search }>
							<InputGroupInput
								placeholder={ __( 'Search' ) }
								aria-label={ __( 'Search settings' ) }
								value={ query }
								onChange={ ( event ) => setQuery( event.target.value ) }
								onKeyDown={ ( event ) => {
									if ( event.key === 'Escape' && query ) {
										event.stopPropagation();
										setQuery( '' );
									} else if ( event.key === 'Enter' && results[ 0 ] ) {
										event.preventDefault();
										open( results[ 0 ] );
									}
								} }
							/>
							<InputGroupAddon>
								<SearchIcon />
							</InputGroupAddon>
							{ query ? (
								<InputGroupAddon align="inline-end">
									<IconButton
										size="icon-xs"
										icon={ <XIcon /> }
										label={ __( 'Clear search' ) }
										onClick={ () => setQuery( '' ) }
									/>
								</InputGroupAddon>
							) : null }
						</InputGroup>
						{ ! searching ? (
							<TabsList variant="sidebar" aria-label={ __( 'Settings sections' ) }>
								{ getSections( scope, { signedIn } ).map( ( entry ) => (
									<TabsTrigger key={ entry.id } value={ entry.id }>
										<entry.icon />
										<MarqueeLabel>{ entry.label }</MarqueeLabel>
									</TabsTrigger>
								) ) }
							</TabsList>
						) : results.length ? (
							<Tabs
								orientation="vertical"
								value={ null }
								onValueChange={ ( index: number ) => open( results[ index ] ) }
							>
								<TabsList variant="sidebar" aria-label={ __( 'Matching settings' ) }>
									{ results.map( ( item, index ) => (
										<TabsTrigger
											key={ `${ item.scope }-${ item.section.id }-${ item.setting?.title ?? '' }` }
											value={ index }
											highlighted={ index === 0 }
										>
											<item.section.icon />
											<MarqueeLabel>{ item.setting?.title ?? item.section.label }</MarqueeLabel>
											<TabsScopeLabel>
												{ item.scope === 'site' ? __( 'Site' ) : __( 'Studio' ) }
											</TabsScopeLabel>
										</TabsTrigger>
									) ) }
								</TabsList>
							</Tabs>
						) : (
							<p className={ styles.empty }>{ __( 'No settings found.' ) }</p>
						) }
					</TabsSidebar>
					<DialogPanel
						className={ styles.content }
						scrollRef={ setContent }
						header={
							<PanelHeader
								leading={
									<IconButton
										variant="segmented"
										size="icon-sm"
										icon={ <ChevronLeftIcon /> }
										label={ __( 'Back in settings' ) }
										shortcut={ {
											displayShortcut: displayShortcut.primary( '[' ),
											ariaKeyShortcut: ariaKeyShortcut.primary( '[' ),
										} }
										disabled={ history.index < 1 }
										onClick={ () => traverse( -1 ) }
									/>
								}
								title={ current.label }
								actions={ <div ref={ setActions } className={ styles.actions } /> }
								onClose={ close }
								closeLabel={ __( 'Close settings' ) }
							/>
						}
					>
						<SettingsDialogContext.Provider value={ { actions, setDirty, settle } }>
							{ scope === 'studio' ? (
								<SettingsLinkContext.Provider value>
									<StudioSection id={ section } onNavigate={ go } hasSite={ !! site } />
								</SettingsLinkContext.Provider>
							) : null }
							{ site ? (
								<>
									{ scope === 'site' &&
									( section === 'site-skills' || section === 'site-instructions' ) ? (
										<SiteAgentFiles
											key={ `${ site.id }-${ section }` }
											site={ site }
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
										<SiteSettingsForm key={ site.id } site={ site } section={ formSection } />
									</div>
								</>
							) : null }
						</SettingsDialogContext.Provider>
					</DialogPanel>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}
