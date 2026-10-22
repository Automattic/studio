import { useNavigate, useSearch } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { chevronLeft, close as closeIcon, cloudDownload, Icon } from '@wordpress/icons';
import { Dialog, IconButton, Spinner } from '@wordpress/ui';
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { sitePinKey, useSidebarPins } from '@/data/queries/use-sidebar-pins';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { archiveIcon, plusIcon } from '@/lib/icons';
import { pendingBlueprintSlot } from '@/lib/pending-blueprint';
import { BlueprintDetails } from './blueprint-details';
import { BlueprintGallery, getUseCaseLabel, getUseCases } from './blueprint-gallery';
import { ConnectPanel } from './connect-panel';
import { AddSiteContext } from './context';
import { CreatePanel } from './create-panel';
import { BackupDropZone, ImportPanel } from './import-panel';
import styles from './style.module.css';
import type { AddSiteSection } from '@/hooks/use-open-add-site';
import type { BlueprintUseCase } from '@studio/common/lib/blueprint-catalog';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';
import type { ReactElement } from 'react';

type View =
	| { name: 'gallery'; useCase?: BlueprintUseCase }
	| { name: 'details'; blueprint: Blueprint; useCase?: BlueprintUseCase }
	| { name: 'setup'; from?: View }
	| { name: 'connect' }
	| { name: 'import'; backup?: File };

function getInitialView( section: AddSiteSection ): View {
	return section === 'create' ? { name: 'gallery' } : { name: section };
}

/**
 * Creates, connects or imports a site over the current screen, opened by the
 * `addSite` search param (`?addSite=connect`). `pin` pins the new site.
 */
export function AddSiteDialog() {
	const navigate = useNavigate();
	const { addSite, pin } = useSearch( { strict: false } ) as {
		addSite?: AddSiteSection;
		pin?: true;
	};
	const [ openedWith, setOpenedWith ] = useState( addSite );
	const [ view, setView ] = useState< View >( () => getInitialView( addSite ?? 'create' ) );
	const [ progress, setProgress ] = useState< string | null >( null );
	const [ followedSite, followSite ] = useState< string >();
	const [ actions, setActions ] = useState< HTMLElement | null >( null );
	const [ lastViewed, setLastViewed ] = useState< string >();
	const popup = useRef< HTMLDivElement >( null );
	const getInitialFocus = useCallback(
		() => popup.current?.querySelector< HTMLElement >( '[data-start-blank], input' ) ?? true,
		[]
	);
	if ( addSite !== openedWith ) {
		setOpenedWith( addSite );
		if ( addSite ) {
			setView( getInitialView( addSite ) );
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
				if ( pin ) setPins( [ sitePinKey( siteId ), ...pins ] );
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
		<Dialog.Root open={ !! addSite } onOpenChange={ ( open ) => ! open && close() }>
			<Dialog.Popup
				ref={ popup }
				size="stretch"
				className={ styles.popup }
				initialFocus={ getInitialFocus }
			>
				<Dialog.Title className={ styles.visuallyHidden }>{ __( 'Add site' ) }</Dialog.Title>
				{ hasSidebar ? (
					<nav
						className={ styles.sidebar }
						aria-label={ __( 'Ways to add a site' ) }
						inert={ progress ? true : undefined }
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
				<div className={ styles.main }>
					<div className={ styles.header }>
						{ back ? (
							<IconButton
								variant="outline"
								tone="neutral"
								size="compact"
								icon={ chevronLeft }
								label={
									view.name === 'details' || view.name === 'gallery'
										? __( 'Back to Blueprints' )
										: __( 'Back' )
								}
								disabled={ !! progress }
								onClick={ back }
							/>
						) : null }
						{ view.name === 'details' ? (
							<>
								<button
									type="button"
									className={ styles.crumb }
									disabled={ !! progress }
									onClick={ back }
								>
									{ __( 'Blueprints' ) }
								</button>
								<span aria-hidden="true" className={ styles.crumbSeparator }>
									/
								</span>
							</>
						) : null }
						<h2 className={ styles.title } title={ title }>
							{ title }
						</h2>
						{ progress ? <Progress siteId={ followedSite } fallback={ progress } /> : null }
						<div ref={ setActions } className={ styles.actions } />
						<IconButton
							variant="outline"
							tone="neutral"
							size="compact"
							icon={ closeIcon }
							label={ __( 'Close Add site' ) }
							disabled={ !! progress }
							onClick={ close }
						/>
					</div>
					<div className={ styles.content } inert={ progress ? true : undefined }>
						<AddSiteContext.Provider value={ context }>
							{ view.name === 'gallery' ? (
								<BlueprintGallery
									useCase={ view.useCase }
									focusSlug={ lastViewed }
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
							{ view.name === 'setup' ? <CreatePanel onCancel={ close } /> : null }
							{ view.name === 'connect' ? <ConnectPanel /> : null }
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
				</div>
			</Dialog.Popup>
		</Dialog.Root>
	);
}

// The site's published progress re-renders only this line, not the panels.
function Progress( { siteId, fallback }: { siteId?: string; fallback: string } ) {
	const activity = useSiteSyncActivity( siteId );
	return (
		<p className={ styles.progress } role="status" aria-live="polite">
			<Spinner />
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
			className={ styles.navItem }
			aria-current={ current ? 'page' : undefined }
			onClick={ onSelect }
		>
			{ icon ? <Icon icon={ icon } size={ 16 } className={ styles.navIcon } /> : null }
			<span className={ styles.navLabel }>{ label }</span>
		</button>
	);
}
