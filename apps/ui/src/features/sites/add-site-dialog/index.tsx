import { useNavigate, useSearch } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { ChevronLeftIcon, CloudDownloadIcon } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { sitePinKey, useSidebarPins } from '@/data/queries/use-sidebar-pins';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { BlueprintUpload } from '@/features/sites/blueprint-upload';
import { pendingBlueprintSlot } from '@/features/sites/pending-blueprint';
import { ImportIcon, PlusIcon, UploadIcon } from '@/lib/icons';
import {
	Button,
	IconButton,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogPanel,
	DialogTitle,
	PanelHeader,
	Spinner,
	SidebarGroupHeader,
	Tabs,
	TabsList,
	TabsSidebar,
	TabsTrigger,
	VisuallyHidden,
} from '@/lib/ui';
import { BlueprintDetails } from './blueprint-details';
import { BlueprintGallery, getUseCaseLabel, getUseCases } from './blueprint-gallery';
import { ConnectPanel } from './connect-panel';
import { AddSiteContext } from './context';
import { CreatePanel } from './create-panel';
import { BackupDropZone, ImportPanel } from './import-panel';
import styles from './style.module.css';
import type { SyncSite } from '@/data/core';
import type { SelectedBlueprint } from '@/features/sites/blueprint-selection';
import type { CreateSiteFormValues } from '@/features/sites/create-site-form';
import type { AddSiteSection } from '@/features/sites/use-open-add-site';
import type { BlueprintUseCase } from '@studio/common/lib/blueprint-catalog';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';
import type { NewSiteBehavior } from '@studio/common/lib/user-settings/preferences';

type View =
	| { name: 'gallery'; useCase?: BlueprintUseCase }
	| { name: 'details'; blueprint: Blueprint; useCase?: BlueprintUseCase }
	| { name: 'setup'; from?: View; remote?: SyncSite }
	| { name: 'connect' }
	| { name: 'upload' }
	| { name: 'import'; backup?: File };

function getInitialView( section: AddSiteSection, behavior?: NewSiteBehavior ): View {
	if ( section !== 'create' ) return { name: section };
	return behavior === 'blank' ? { name: 'setup' } : { name: 'gallery' };
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
	const [ chosenView, replaceView ] = useState< View | null >( null );
	const view = chosenView ?? getInitialView( addSite ?? 'create', preferences?.newSiteBehavior );
	const [ viewHistory, setViewHistory ] = useState< View[] >( [] );
	const setView = ( next: View ) => {
		setViewHistory( ( history ) => [ ...history, view ] );
		replaceView( next );
	};
	const [ progress, setProgress ] = useState< string | null >( null );
	const [ followedSite, followSite ] = useState< string >();
	const [ actions, setActions ] = useState< HTMLElement | null >( null );
	const [ formActions, setFormActions ] = useState< HTMLElement | null >( null );
	const [ isBlankSetup, setIsBlankSetup ] = useState( true );
	const [ isBlueprintValid, setIsBlueprintValid ] = useState( true );
	const [ lastViewed, setLastViewed ] = useState< string >();
	const [ setupDraft, setSetupDraft ] = useState< Partial< CreateSiteFormValues > >();
	const popup = useRef< HTMLDivElement >( null );
	const createTab = useRef< HTMLButtonElement >( null );
	const getInitialFocus = useCallback(
		() =>
			popup.current?.querySelector< HTMLElement >(
				'input:not([type="file"]), [data-start-blank], [data-blueprint-upload]'
			) ??
			popup.current ??
			true,
		[]
	);
	if ( addSite !== openedWith ) {
		setOpenedWith( addSite );
		if ( addSite ) {
			replaceView( null );
			setViewHistory( [] );
			setProgress( null );
			followSite( undefined );
			setLastViewed( undefined );
			setSetupDraft( undefined );
			setIsBlankSetup( true );
			setIsBlueprintValid( true );
		}
	}
	const pendingBlueprint = useSyncExternalStore(
		pendingBlueprintSlot.subscribe,
		pendingBlueprintSlot.getSnapshot
	);
	if ( addSite && pendingBlueprint && view.name !== 'setup' ) {
		setView( { name: 'setup', from: view } );
		setIsBlankSetup( false );
		setIsBlueprintValid( true );
	}
	const selectBlueprint = useCallback( ( blueprint: SelectedBlueprint ) => {
		setIsBlankSetup( false );
		pendingBlueprintSlot.set( blueprint );
	}, [] );
	const removeInvalidBlueprint = useCallback( () => setIsBlueprintValid( true ), [] );

	const { pins, setPins } = useSidebarPins();
	const context = useMemo(
		() => ( {
			setProgress,
			followSite,
			actions,
			formActions,
			isBlueprintValid,
			setIsBlueprintValid,
			pinNewSite: ( siteId: string ) => {
				if ( pin ) setPins( [ ...pins, sitePinKey( siteId ) ] );
			},
			setupDraft,
			setSetupDraft,
		} ),
		[ actions, formActions, isBlueprintValid, pin, pins, setPins, setupDraft ]
	);

	const close = () => {
		if ( progress ) return;
		void navigate( {
			to: '.',
			state: true,
			search: ( { addSite: _section, pin: _pin, ...rest }: Record< string, unknown > ) => rest,
			replace: true,
		} );
	};

	const parentView: View | undefined =
		view.name === 'setup' ? view.from ?? { name: 'gallery' } : undefined;
	const previousView = viewHistory[ viewHistory.length - 1 ] ?? parentView;
	const back = previousView
		? () => {
				setViewHistory( ( history ) => history.slice( 0, -1 ) );
				replaceView( previousView );
		  }
		: undefined;
	const goBack = () => {
		back?.();
		if ( view.name === 'gallery' && previousView?.name === 'gallery' ) {
			createTab.current?.focus();
		}
	};

	const title =
		view.name === 'details'
			? view.blueprint.title
			: view.name === 'setup' && ! view.remote && isBlankSetup
			? __( 'Create a blank site' )
			: view.name === 'setup' || ( view.name === 'import' && view.backup )
			? __( 'Create your site' )
			: view.name === 'connect'
			? __( 'Connect to an existing WordPress' )
			: view.name === 'import'
			? __( 'Import a backup' )
			: view.name === 'upload'
			? __( 'Upload a Blueprint' )
			: view.useCase
			? getUseCaseLabel( view.useCase )
			: __( 'Create a new WordPress' );

	const hasSidebar =
		view.name === 'gallery' ||
		view.name === 'connect' ||
		view.name === 'upload' ||
		( view.name === 'import' && ! view.backup );
	const navValue = view.name === 'gallery' ? view.useCase ?? 'create' : view.name;
	const navItems = [
		{ value: 'create', label: __( 'Create' ), icon: <PlusIcon /> },
		{ value: 'connect', label: __( 'Connect' ), icon: <CloudDownloadIcon /> },
		{ value: 'upload', label: __( 'Upload' ), icon: <UploadIcon /> },
		{ value: 'import', label: __( 'Import' ), icon: <ImportIcon /> },
	];

	const panel = (
		<DialogPanel
			footer={
				view.name === 'setup' || ( view.name === 'import' && view.backup ) ? (
					<DialogFooter ref={ setFormActions } />
				) : undefined
			}
			header={
				<PanelHeader
					leading={
						<div className={ styles.leading }>
							<IconButton
								variant="segmented"
								size="icon-sm"
								icon={ <ChevronLeftIcon /> }
								label={
									previousView?.name === 'gallery' &&
									( view.name === 'details' || view.name === 'gallery' )
										? __( 'Back to Blueprints' )
										: __( 'Back' )
								}
								disabled={ ! back || !! progress }
								onClick={ goBack }
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
					}
					title={
						<span className={ styles.title } title={ title }>
							{ title }
						</span>
					}
					actions={
						<>
							{ progress && view.name !== 'details' && ( view.name !== 'setup' || view.remote ) ? (
								<Progress siteId={ followedSite } fallback={ progress } />
							) : null }
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
					{ view.name === 'upload' ? (
						<BlueprintUpload
							onSelect={ selectBlueprint }
							onRemove={ removeInvalidBlueprint }
							onValidityChange={ setIsBlueprintValid }
						/>
					) : null }
					{ view.name === 'gallery' ? (
						<BlueprintGallery
							useCase={ view.useCase }
							focusSlug={ lastViewed }
							onClearFilters={ () => setView( { name: 'gallery' } ) }
							onBlank={ () => {
								setIsBlankSetup( true );
								setIsBlueprintValid( true );
								setView( { name: 'setup', from: view } );
							} }
							onView={ ( blueprint ) => {
								setLastViewed( blueprint.slug );
								setView( { name: 'details', blueprint, useCase: view.useCase } );
							} }
						/>
					) : null }
					{ view.name === 'details' ? (
						<BlueprintDetails
							blueprint={ view.blueprint }
							onSetup={ () => {
								setIsBlueprintValid( true );
								setView( { name: 'setup', from: view } );
							} }
						/>
					) : null }
					{ view.name === 'setup' ? (
						<CreatePanel
							remote={ view.remote }
							onCancel={ close }
							onBlankChange={ setIsBlankSetup }
						/>
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
	);

	return (
		<Dialog
			replaceable
			open={ !! addSite && ! settings }
			onOpenChange={ ( open ) => ! open && close() }
		>
			<DialogContent
				ref={ popup }
				layout="creation"
				initialFocus={ getInitialFocus }
				finalFocus={ getFinalFocus }
			>
				<DialogTitle render={ <VisuallyHidden /> }>{ __( 'Add site' ) }</DialogTitle>
				{ hasSidebar ? (
					<Tabs
						orientation="vertical"
						layout="sidebar"
						value={ navValue }
						onValueChange={ ( value: string ) => {
							setIsBlueprintValid( true );
							setView(
								value === 'connect' || value === 'upload' || value === 'import'
									? ( { name: value } as View )
									: {
											name: 'gallery',
											useCase: value === 'create' ? undefined : ( value as BlueprintUseCase ),
									  }
							);
						} }
					>
						<TabsSidebar inert={ progress ? true : undefined }>
							<TabsList variant="sidebar" aria-label={ __( 'Ways to add a site' ) }>
								{ navItems.map( ( item ) => (
									<TabsTrigger
										key={ item.value }
										ref={ item.value === 'create' ? createTab : undefined }
										value={ item.value }
									>
										{ item.icon }
										{ item.label }
									</TabsTrigger>
								) ) }
								<SidebarGroupHeader
									className={ styles.useCaseHeader }
									role="heading"
									aria-level={ 2 }
								>
									<span className={ styles.useCaseHeading }>{ __( 'By use case' ) }</span>
								</SidebarGroupHeader>
								{ getUseCases().map( ( useCase ) => (
									<TabsTrigger key={ useCase.value } value={ useCase.value }>
										{ useCase.label }
									</TabsTrigger>
								) ) }
							</TabsList>
						</TabsSidebar>
						{ panel }
					</Tabs>
				) : (
					panel
				) }
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
