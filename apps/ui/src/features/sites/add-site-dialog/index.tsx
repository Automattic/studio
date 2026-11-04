import { ACCEPTED_ADD_SITE_FILE_TYPES } from '@studio/common/constants';
import { isSupportedBackupFilename } from '@studio/common/lib/backup-files';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { ChevronLeftIcon, CloudDownloadIcon } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { sitePinKey, useSidebarPins } from '@/data/queries/use-sidebar-pins';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useFileDrop } from '@/data/use-composer-attachments';
import { BlueprintErrorDialog } from '@/features/sites/blueprint-error-dialog';
import { SiteFileUpload } from '@/features/sites/blueprint-upload';
import { isBlueprintFile } from '@/features/sites/blueprint-upload/load-blueprint-file';
import { useBlueprintUpload } from '@/features/sites/blueprint-upload/use-blueprint-upload';
import { pendingBlueprintSlot } from '@/features/sites/pending-blueprint';
import { pendingSiteFolderSlot } from '@/features/sites/pending-site-folder';
import { ImportIcon, PlusIcon } from '@/lib/icons';
import {
	DropOverlay,
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
import { ImportPanel } from './import-panel';
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
	| { name: 'import'; backup?: File };

function getInitialView( section: AddSiteSection, behavior?: NewSiteBehavior ): View {
	if ( section === 'upload' ) return { name: 'import' };
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
	const [ isBlueprintValid, setIsBlueprintValid ] = useState( true );
	const [ lastViewed, setLastViewed ] = useState< string >();
	const [ setupDraft, setSetupDraft ] = useState< Partial< CreateSiteFormValues > >();
	const popup = useRef< HTMLDivElement >( null );
	const createTab = useRef< HTMLButtonElement >( null );
	const getInitialFocus = useCallback(
		() =>
			popup.current?.querySelector< HTMLElement >(
				'input:not([type="file"]), [data-start-blank], [data-site-file-upload]'
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
			setIsBlueprintValid( true );
		}
	}
	const pendingBlueprint = useSyncExternalStore(
		pendingBlueprintSlot.subscribe,
		pendingBlueprintSlot.getSnapshot
	);
	const pendingFolder = useSyncExternalStore(
		pendingSiteFolderSlot.subscribe,
		pendingSiteFolderSlot.getSnapshot
	);
	if (
		addSite &&
		( pendingBlueprint || pendingFolder ) &&
		( view.name !== 'setup' || view.remote )
	) {
		setView( { name: 'setup', from: view } );
		setIsBlueprintValid( true );
	}
	const selectBlueprint = useCallback( ( blueprint: SelectedBlueprint ) => {
		pendingBlueprintSlot.set( blueprint );
	}, [] );
	const selectBackup = useCallback(
		( backup: File ) => {
			const pending = pendingBlueprintSlot.getSnapshot();
			if ( pending ) pendingBlueprintSlot.clear( pending );
			setViewHistory( ( history ) => [ ...history, view ] );
			replaceView( { name: 'import', backup } );
		},
		[ view ]
	);
	const upload = useBlueprintUpload( {
		enabled: !! addSite && ! settings && ! progress,
		onSelect: selectBlueprint,
		onValidityChange: setIsBlueprintValid,
		onBackup: selectBackup,
	} );
	const [ dropTarget, setDropTarget ] = useState< HTMLDivElement | null >( null );
	const setPopup = useCallback( ( element: HTMLDivElement | null ) => {
		popup.current = element;
		setDropTarget( element );
	}, [] );
	const { handleFile, cancel: cancelUpload } = upload;
	const handleSiteFile = useCallback(
		( file: File ) => {
			if ( progress ) return;
			if (
				! isBlueprintFile( file ) &&
				isSupportedBackupFilename( file.name, ACCEPTED_ADD_SITE_FILE_TYPES )
			) {
				cancelUpload();
				selectBackup( file );
				return;
			}
			void handleFile( file, true );
		},
		[ progress, handleFile, cancelUpload, selectBackup ]
	);
	const onFiles = useCallback(
		( files: FileList ) => {
			if ( files[ 0 ] ) handleSiteFile( files[ 0 ] );
		},
		[ handleSiteFile ]
	);
	const isDragging = useFileDrop( addSite && ! settings ? dropTarget : null, onFiles );

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
		upload.cancel();
		back?.();
		if ( view.name === 'gallery' && previousView?.name === 'gallery' ) {
			createTab.current?.focus();
		}
	};

	const title =
		view.name === 'details'
			? view.blueprint.title
			: view.name === 'setup' || ( view.name === 'import' && view.backup )
			? __( 'Create your site' )
			: view.name === 'connect'
			? __( 'Connect to an existing WordPress' )
			: view.name === 'import'
			? __( 'Import a blueprint or backup' )
			: view.useCase
			? getUseCaseLabel( view.useCase )
			: __( 'Create a new WordPress' );

	const hasSidebar =
		view.name === 'gallery' ||
		view.name === 'connect' ||
		( view.name === 'import' && ! view.backup );
	const navValue = view.name === 'gallery' ? view.useCase ?? 'create' : view.name;
	const navItems = [
		{ value: 'create', label: __( 'Start' ), icon: <PlusIcon /> },
		{ value: 'connect', label: __( 'Connect' ), icon: <CloudDownloadIcon /> },
		{ value: 'import', label: __( 'Import' ), icon: <ImportIcon /> },
	];

	const selectSection = ( value: string ) => {
		if ( progress ) return;
		upload.cancel();
		setIsBlueprintValid( true );
		setView(
			value === 'connect' || value === 'import'
				? ( { name: value } as View )
				: {
						name: 'gallery',
						useCase: value === 'create' ? undefined : ( value as BlueprintUseCase ),
				  }
		);
	};

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
										? __( 'Back to Start' )
										: __( 'Back' )
								}
								disabled={ ! back || !! progress }
								onClick={ goBack }
							/>
							{ view.name === 'details' || ( view.name === 'gallery' && view.useCase ) ? (
								<>
									<Button
										variant="inline-text"
										size="inline"
										disabled={ !! progress }
										onClick={ view.name === 'gallery' ? () => selectSection( 'create' ) : back }
									>
										{ __( 'Start' ) }
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
							{ progress && view.name !== 'details' ? (
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
					{ view.name === 'gallery' ? (
						<BlueprintGallery
							useCase={ view.useCase }
							focusSlug={ lastViewed }
							onClearFilters={ () => setView( { name: 'gallery' } ) }
							onBlank={ () => {
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
							key={ view.remote?.id ?? 'local' }
							remote={ view.remote }
							onChooseSource={ () => setView( { name: 'connect' } ) }
							onCancel={ close }
						/>
					) : null }
					{ view.name === 'connect' ? (
						<ConnectPanel
							onConnect={ ( remote ) => setView( { name: 'setup', from: view, remote } ) }
						/>
					) : null }
					{ view.name === 'import' && ! view.backup ? (
						<SiteFileUpload onFile={ handleSiteFile } disabled={ !! progress } />
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
				ref={ setPopup }
				data-dragging={ ( isDragging && ! progress ) || undefined }
				layout="creation"
				initialFocus={ getInitialFocus }
				finalFocus={ getFinalFocus }
			>
				<DialogTitle render={ <VisuallyHidden /> }>{ __( 'Add site' ) }</DialogTitle>
				<BlueprintErrorDialog error={ upload.error } onDismiss={ upload.dismissError } />
				{ ( isDragging || upload.isLoading ) && ! progress ? (
					<DropOverlay>
						{ upload.isLoading ? <Spinner aria-hidden="true" /> : null }
						{ upload.isLoading ? __( 'Loading file…' ) : __( 'Drop to add site' ) }
					</DropOverlay>
				) : null }
				{ upload.isLoading ? (
					<VisuallyHidden role="status">{ __( 'Loading file…' ) }</VisuallyHidden>
				) : null }
				{ hasSidebar ? (
					<Tabs
						orientation="vertical"
						layout="sidebar"
						value={ navValue }
						onValueChange={ selectSection }
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
									<span className={ styles.useCaseHeading }>{ __( 'Categories' ) }</span>
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
