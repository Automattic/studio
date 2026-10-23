import { useNavigate, useSearch } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { chevronLeft, cloudDownload, Icon } from '@wordpress/icons';
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button, IconButton } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogPanel,
	DialogTitle,
	PanelHeader,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { VisuallyHidden } from '@/components/ui/visually-hidden';
import { sitePinKey, useSidebarPins } from '@/data/queries/use-sidebar-pins';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { closeOnPaletteShortcut } from '@/hooks/use-command-palette';
import { archiveIcon, plusIcon } from '@/lib/icons';
import { pendingBlueprintSlot } from '@/lib/pending-blueprint';
import { BlueprintDetails } from './blueprint-details';
import { BlueprintGallery, getUseCaseLabel, getUseCases } from './blueprint-gallery';
import { ConnectPanel } from './connect-panel';
import { AddSiteContext } from './context';
import { CreatePanel } from './create-panel';
import { BackupDropZone, ImportPanel } from './import-panel';
import styles from './style.module.css';
import type { SyncSite } from '@/data/core';
import type { AddSiteSection } from '@/hooks/use-open-add-site';
import type { BlueprintUseCase } from '@studio/common/lib/blueprint-catalog';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';
import type { NewSiteBehavior } from '@studio/common/lib/user-settings/preferences';
import type { KeyboardEvent, ReactElement } from 'react';

type View =
	| { name: 'gallery'; useCase?: BlueprintUseCase }
	| { name: 'details'; blueprint: Blueprint; useCase?: BlueprintUseCase }
	| { name: 'setup'; from?: View; remote?: SyncSite }
	| { name: 'connect' }
	| { name: 'import'; backup?: File };

function getInitialView( section: AddSiteSection, behavior?: NewSiteBehavior ): View {
	if ( section !== 'create' ) return { name: section };
	return behavior === 'blank' ? { name: 'setup' } : { name: 'gallery' };
}

// Up, Down, Home and End move between the side nav's tabs.
function moveNavFocus( event: KeyboardEvent< HTMLElement > ) {
	const tabs = [ ...event.currentTarget.querySelectorAll< HTMLElement >( '[role="tab"]' ) ];
	const index = tabs.indexOf( event.target as HTMLElement );
	const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: tabs.length - 1 }[
		event.key
	];
	if ( next === undefined || index < 0 ) return;
	event.preventDefault();
	tabs[ ( next + tabs.length ) % tabs.length ].focus();
}

// The empty workspace's Add site button, when there is one.
const getFinalFocus = () =>
	document.querySelector< HTMLElement >( '[data-add-first-site]' ) ?? true;

/**
 * Creates, connects or imports a site over the current screen, opened by the
 * `addSite` search param (`?addSite=connect`). `pin` pins the new site. It waits
 * for Settings to close when both are asked for.
 */
export function AddSiteDialog() {
	const navigate = useNavigate();
	const { addSite, pin, settings } = useSearch( { strict: false } ) as {
		addSite?: AddSiteSection;
		pin?: true;
		settings?: string;
	};
	const { data: preferences } = useUserPreferences();
	const [ openedWith, setOpenedWith ] = useState( addSite );
	const [ chosenView, setView ] = useState< View | null >( null );
	const view = chosenView ?? getInitialView( addSite ?? 'create', preferences?.newSiteBehavior );
	const [ progress, setProgress ] = useState< string | null >( null );
	const [ followedSite, followSite ] = useState< string >();
	const [ actions, setActions ] = useState< HTMLElement | null >( null );
	const [ lastViewed, setLastViewed ] = useState< string >();
	const popup = useRef< HTMLDivElement >( null );
	const getInitialFocus = useCallback(
		() =>
			popup.current?.querySelector< HTMLElement >( 'input, [data-start-blank]' ) ??
			popup.current ??
			true,
		[]
	);
	if ( addSite !== openedWith ) {
		setOpenedWith( addSite );
		if ( addSite ) {
			setView( null );
			setProgress( null );
			followSite( undefined );
			setLastViewed( undefined );
		}
	}
	const pendingBlueprint = useSyncExternalStore(
		pendingBlueprintSlot.subscribe,
		pendingBlueprintSlot.getSnapshot
	);
	if ( addSite && pendingBlueprint && view.name !== 'setup' ) {
		setView( { name: 'setup', from: view } );
	}

	const { pins, setPins } = useSidebarPins();
	const context = useMemo(
		() => ( {
			setProgress,
			followSite,
			actions,
			pinNewSite: ( siteId: string ) => {
				if ( pin ) setPins( [ ...pins, sitePinKey( siteId ) ] );
			},
		} ),
		[ actions, pin, pins, setPins ]
	);

	const close = () => {
		if ( progress ) return;
		void navigate( {
			to: '.',
			search: ( { addSite: _section, pin: _pin, ...rest }: Record< string, unknown > ) => rest,
			replace: true,
		} );
	};

	const back =
		view.name === 'details'
			? () => setView( { name: 'gallery', useCase: view.useCase } )
			: view.name === 'setup'
			? () => setView( view.from ?? { name: 'gallery' } )
			: view.name === 'import' && view.backup
			? () => setView( { name: 'import' } )
			: view.name === 'gallery' && view.useCase
			? () => setView( { name: 'gallery' } )
			: undefined;

	const title =
		view.name === 'details'
			? view.blueprint.title
			: view.name === 'setup'
			? __( 'Create your site' )
			: view.name === 'connect'
			? __( 'Connect a site' )
			: view.name === 'import'
			? __( 'Import a backup' )
			: view.useCase
			? getUseCaseLabel( view.useCase )
			: __( 'Choose a starting point' );

	const hasSidebar =
		view.name === 'gallery' ||
		view.name === 'connect' ||
		( view.name === 'import' && ! view.backup );
	const navValue = view.name === 'gallery' ? view.useCase ?? 'create' : view.name;
	const navItems: { value: string; label: string; icon?: ReactElement; onSelect: () => void }[] = [
		{
			value: 'create',
			label: __( 'Create' ),
			icon: plusIcon,
			onSelect: () => setView( { name: 'gallery' } ),
		},
		{
			value: 'connect',
			label: __( 'Connect' ),
			icon: cloudDownload,
			onSelect: () => setView( { name: 'connect' } ),
		},
		{
			value: 'import',
			label: __( 'Import' ),
			icon: archiveIcon,
			onSelect: () => setView( { name: 'import' } ),
		},
	];

	return (
		<Dialog open={ !! addSite && ! settings } onOpenChange={ ( open ) => ! open && close() }>
			<DialogContent
				ref={ popup }
				layout="creation"
				className={ styles.popup }
				initialFocus={ getInitialFocus }
				finalFocus={ getFinalFocus }
				onKeyDown={ closeOnPaletteShortcut( close ) }
			>
				<DialogTitle render={ <VisuallyHidden /> }>{ __( 'Add site' ) }</DialogTitle>
				{ hasSidebar ? (
					<nav
						className={ styles.sidebar }
						role="tablist"
						aria-orientation="vertical"
						aria-label={ __( 'Ways to add a site' ) }
						inert={ progress ? true : undefined }
						onKeyDown={ moveNavFocus }
					>
						{ navItems.map( ( item ) => (
							<NavItem key={ item.value } { ...item } current={ navValue === item.value } />
						) ) }
						<h2 className={ styles.navGroup }>{ __( 'Blueprints' ) }</h2>
						{ getUseCases().map( ( useCase ) => (
							<NavItem
								key={ useCase.value }
								label={ useCase.label }
								current={ navValue === useCase.value }
								onSelect={ () => setView( { name: 'gallery', useCase: useCase.value } ) }
							/>
						) ) }
					</nav>
				) : null }
				<DialogPanel
					header={
						<PanelHeader
							leading={
								back ? (
									<div className={ styles.leading }>
										<IconButton
											variant="segmented"
											size="icon-sm"
											icon={ chevronLeft }
											label={
												view.name === 'details' || view.name === 'gallery'
													? __( 'Back to Blueprints' )
													: __( 'Back' )
											}
											disabled={ !! progress }
											onClick={ back }
										/>
										{ view.name === 'details' ? (
											<>
												<Button
													variant="inline-text"
													size="inline"
													disabled={ !! progress }
													onClick={ back }
												>
													{ __( 'Blueprints' ) }
												</Button>
												<span aria-hidden="true" className={ styles.crumbSeparator }>
													/
												</span>
											</>
										) : null }
									</div>
								) : null
							}
							title={
								<span className={ styles.title } title={ title }>
									{ title }
								</span>
							}
							actions={
								<>
									{ progress ? <Progress siteId={ followedSite } fallback={ progress } /> : null }
									<div ref={ setActions } className={ styles.actions } />
								</>
							}
							disabled={ !! progress }
							onClose={ close }
							closeLabel={ __( 'Close Add site' ) }
						/>
					}
				>
					<div className={ styles.content } inert={ progress ? true : undefined }>
						<AddSiteContext.Provider value={ context }>
							{ view.name === 'gallery' ? (
								<BlueprintGallery
									useCase={ view.useCase }
									focusSlug={ lastViewed }
									onClearFilters={ () => setView( { name: 'gallery' } ) }
									onBlank={ () => setView( { name: 'setup', from: view } ) }
									onView={ ( blueprint ) => {
										setLastViewed( blueprint.slug );
										setView( { name: 'details', blueprint, useCase: view.useCase } );
									} }
								/>
							) : null }
							{ view.name === 'details' ? (
								<BlueprintDetails
									blueprint={ view.blueprint }
									onSetup={ () => setView( { name: 'setup', from: view } ) }
								/>
							) : null }
							{ view.name === 'setup' ? (
								<CreatePanel remote={ view.remote } onCancel={ close } />
							) : null }
							{ view.name === 'connect' ? (
								<ConnectPanel
									onConnect={ ( remote ) => setView( { name: 'setup', from: view, remote } ) }
								/>
							) : null }
							{ view.name === 'import' && ! view.backup ? (
								<BackupDropZone onFile={ ( backup ) => setView( { name: 'import', backup } ) } />
							) : null }
							{ view.name === 'import' && view.backup ? (
								<ImportPanel
									backup={ view.backup }
									onCancel={ close }
									onChooseAnother={ () => setView( { name: 'import' } ) }
								/>
							) : null }
						</AddSiteContext.Provider>
					</div>
				</DialogPanel>
			</DialogContent>
		</Dialog>
	);
}

// The site's published progress re-renders only this line, not the panels.
function Progress( { siteId, fallback }: { siteId?: string; fallback: string } ) {
	const activity = useSiteSyncActivity( siteId );
	return (
		<p className={ styles.progress } role="status" aria-live="polite">
			<Spinner aria-hidden="true" />
			{ ( activity?.kind === 'pending' && activity.message ) || fallback }
		</p>
	);
}

function NavItem( {
	label,
	icon,
	current,
	onSelect,
}: {
	label: string;
	icon?: ReactElement;
	current: boolean;
	onSelect: () => void;
} ) {
	return (
		<button
			type="button"
			role="tab"
			className={ styles.navItem }
			aria-selected={ current }
			tabIndex={ current ? 0 : -1 }
			onClick={ onSelect }
		>
			{ icon ? <Icon icon={ icon } size={ 16 } className={ styles.navIcon } /> : null }
			<span className={ styles.navLabel }>{ label }</span>
		</button>
	);
}
