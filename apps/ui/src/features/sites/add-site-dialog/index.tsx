import { ACCEPTED_ADD_SITE_FILE_TYPES } from '@studio/common/constants';
import { isSupportedBackupFilename } from '@studio/common/lib/backup-files';
import { BLUEPRINT_USE_CASES } from '@studio/common/lib/blueprint-catalog';
import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { validateSelectedSitePath } from '@studio/common/lib/site-path-validation';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { ChevronLeftIcon, CloudDownloadIcon } from 'lucide-react';
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { sitePinKey, useSidebarPins } from '@/data/queries/use-sidebar-pins';
import { useSites } from '@/data/queries/use-sites';
import { useSiteSyncActivity } from '@/data/sync-activity';
import { useFileDrop } from '@/data/use-composer-attachments';
import { saveComposerDraft } from '@/features/composer';
import { BlueprintErrorDialog } from '@/features/sites/blueprint-error-dialog';
import { createSelectedBlueprint } from '@/features/sites/blueprint-selection';
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
import { useSetupSource } from './use-setup-source';
import type { AiModelId } from '@/data/core';
import type { SelectedBlueprint } from '@/features/sites/blueprint-selection';
import type { CreateSiteFormDraft } from '@/features/sites/create-site-form';
import type { AddSiteSection } from '@/features/sites/use-open-add-site';
import type { AiProviderId } from '@studio/agent/protocol/providers';
import type { BlueprintUseCase } from '@studio/common/lib/blueprint-catalog';
import type { Blueprint } from '@studio/common/lib/studio-blueprints-api';

type View =
	| { name: 'gallery'; useCase?: BlueprintUseCase }
	| { name: 'details'; blueprint: Blueprint; useCase?: BlueprintUseCase }
	| { name: 'setup'; from?: View }
	| { name: 'connect' }
	| { name: 'import' };

function getInitialView( section: AddSiteSection ): View {
	if ( section === 'blank' ) return { name: 'setup' };
	if ( section === 'upload' || section === 'import' ) return { name: 'import' };
	return { name: section === 'connect' ? 'connect' : 'gallery' };
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
	const connector = useConnector();
	const { data: sites } = useSites();
	const navigate = useNavigate();
	const { addSite, pin, settings } = useSearch( { strict: false } ) as {
		addSite?: AddSiteSection;
		pin?: true;
		settings?: string;
	};
	const [ openedWith, setOpenedWith ] = useState( addSite );
	const [ chosenView, replaceView ] = useState< View | null >( null );
	const initialView = useMemo( () => getInitialView( addSite ?? 'create' ), [ addSite ] );
	const view = chosenView ?? initialView;
	const scrollArea = useRef< HTMLDivElement >( null );
	const scrollPositions = useRef( new Map< View, number >() );
	const [ viewHistory, setViewHistory ] = useState< View[] >( [] );
	const setView = useCallback(
		( next: View ) => {
			scrollPositions.current.set( view, scrollArea.current?.scrollTop ?? 0 );
			setViewHistory( ( history ) => [ ...history, view ] );
			replaceView( next );
		},
		[ view ]
	);
	useEffect( () => {
		const frame = requestAnimationFrame( () => {
			if ( scrollArea.current )
				scrollArea.current.scrollTop = scrollPositions.current.get( view ) ?? 0;
		} );
		return () => cancelAnimationFrame( frame );
	}, [ view ] );
	const [ progress, setProgress ] = useState< string | null >( null );
	const [ hasCreatedSite, setHasCreatedSite ] = useState( false );
	const [ followedSite, followSite ] = useState< string >();
	const [ actions, setActions ] = useState< HTMLElement | null >( null );
	const [ formActions, setFormActions ] = useState< HTMLElement | null >( null );
	const [ isBlueprintValid, setIsBlueprintValid ] = useState( true );
	const [ lastViewed, setLastViewed ] = useState< string >();
	const [ setupDraft, setSetupDraft ] = useState< CreateSiteFormDraft >();
	const { source, setSource, setBlueprintTransferred, folderResetKey, removeFolder } =
		useSetupSource();
	const briefDraftKey = useId();
	const [ aiChoice, setAiChoice ] = useState< { model: AiModelId; provider: AiProviderId } >();
	useEffect( () => {
		if ( addSite ) return;
		scrollPositions.current.clear();
		setSource( { type: 'blank' } );
		saveComposerDraft( briefDraftKey, { text: '', attachments: [] } );
		setAiChoice( undefined );
	}, [ addSite, briefDraftKey, setSource ] );
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
			setHasCreatedSite( false );
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
	const showSetup = useCallback( () => {
		if ( view.name === 'setup' ) return;
		const reversedIndex = [ ...viewHistory ]
			.reverse()
			.findIndex( ( item ) => item.name === 'setup' );
		const previousSetup = reversedIndex < 0 ? -1 : viewHistory.length - 1 - reversedIndex;
		if ( previousSetup >= 0 ) {
			replaceView( viewHistory[ previousSetup ] );
			setViewHistory( viewHistory.slice( 0, previousSetup ) );
		} else {
			setView( { name: 'setup', from: view } );
		}
	}, [ view, viewHistory, setView ] );
	useEffect( () => {
		if ( ! addSite || ! pendingBlueprint ) return;
		setSource( { type: 'blueprint', blueprint: pendingBlueprint } );
		pendingBlueprintSlot.clear( pendingBlueprint );
		setIsBlueprintValid( true );
		showSetup();
	}, [ addSite, pendingBlueprint, setSource, showSetup ] );
	useEffect( () => {
		if ( ! addSite || ! pendingFolder ) return;
		if ( view.name !== 'setup' || source.type === 'connect' ) {
			setSource( { type: 'blank' } );
			setView( { name: 'setup', from: view } );
		}
	}, [ addSite, pendingFolder, setSource, setView, source.type, view ] );
	const selectBlueprint = useCallback(
		( blueprint: SelectedBlueprint ) => {
			setSource( { type: 'blueprint', blueprint } );
			showSetup();
		},
		[ setSource, showSetup ]
	);
	const selectBackup = useCallback(
		( backup: File | { name: string; path: string } ) => {
			setSource( { type: 'import', backup } );
			showSetup();
		},
		[ setSource, showSetup ]
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
	const folderRequest = useRef( 0 );
	useEffect( () => {
		folderRequest.current += 1;
	}, [ addSite, settings, view, progress, source ] );
	const handleFolder = useCallback(
		async ( path = '', usePath = false ) => {
			if ( progress || ! addSite || settings ) return;
			const request = ++folderRequest.current;
			const folder = await connector.selectSiteFolder( path, { allowSiteFiles: true, usePath } );
			if ( ! folder ) return;
			if ( request !== folderRequest.current ) {
				if ( folder.blueprint?.tempDir )
					await connector
						.cleanupBlueprintTempDir( folder.blueprint.tempDir )
						.catch( () => undefined );
				return;
			}
			if ( folder.file ) {
				selectBackup( folder.file );
				return;
			}
			if ( folder.blueprint ) {
				let blueprint: SelectedBlueprint;
				try {
					blueprint = await createSelectedBlueprint(
						folder.blueprint.blueprintJson,
						{ name: folder.name, size: 0 },
						{ filePath: folder.blueprint.blueprintJsonPath, tempDir: folder.blueprint.tempDir }
					);
				} catch ( error ) {
					if ( folder.blueprint.tempDir )
						await connector
							.cleanupBlueprintTempDir( folder.blueprint.tempDir )
							.catch( () => undefined );
					throw error;
				}
				if ( request !== folderRequest.current ) {
					if ( blueprint.tempDir ) await connector.cleanupBlueprintTempDir( blueprint.tempDir );
					return;
				}
				selectBlueprint( blueprint );
				return;
			}
			const matches = await Promise.all(
				( sites ?? [] ).map( ( site ) => connector.comparePaths( site.path, folder.path ) )
			);
			if ( request !== folderRequest.current ) return;
			const validated = validateSelectedSitePath( folder, matches.some( Boolean ), false );
			if ( validated.error ) throw new Error( validated.error );
			if ( folder.isWordPress ) {
				setSource( { type: 'folder', folder } );
			} else {
				throw new Error( __( 'Choose a folder containing an existing WordPress site.' ) );
			}
			pendingSiteFolderSlot.set( folder );
			showSetup();
		},
		[
			progress,
			addSite,
			settings,
			connector,
			sites,
			showSetup,
			selectBlueprint,
			selectBackup,
			setSource,
		]
	);
	const onFiles = useCallback(
		( files: FileList, transfer: DataTransfer ) => {
			if ( ! files[ 0 ] ) return;
			const directory = Array.from( transfer.items ?? [] ).some(
				( item ) => item.webkitGetAsEntry?.()?.isDirectory
			);
			if ( ! directory ) {
				handleSiteFile( files[ 0 ] );
				return;
			}
			if ( ! connector.capabilities.nativeFolderPicker ) {
				toast.error( __( 'Open Studio Desktop to add an existing WordPress folder.' ) );
				return;
			}
			void ( async () => {
				const path = await connector.getFilePath( files[ 0 ] );
				await handleFolder( path, true );
			} )().catch( ( error ) =>
				toast.error( error instanceof Error ? error.message : __( 'Unable to open this folder.' ) )
			);
		},
		[ handleSiteFile, connector, handleFolder ]
	);
	const isDragging = useFileDrop( addSite && ! settings ? dropTarget : null, onFiles );

	const { pins, setPins } = useSidebarPins();
	const context = {
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
		source,
		setSource,
		browseBlueprints: () => setView( { name: 'gallery' } ),
		onFile: handleSiteFile,
		onFolder: handleFolder,
		folderResetKey,
		removeFolder,
		setBlueprintTransferred,
		onSiteCreated: () => setHasCreatedSite( true ),
		briefDraftKey,
		aiChoice,
		setAiChoice,
	};

	const close = () => {
		if ( progress ) return;
		void navigate( {
			to: '.',
			state: true,
			search: ( { addSite: _section, pin: _pin, ...rest }: Record< string, unknown > ) => rest,
			replace: true,
		} );
	};

	const parentView: View | undefined = view.name === 'setup' ? view.from : undefined;
	const previousView = viewHistory[ viewHistory.length - 1 ] ?? parentView;
	const back = previousView
		? () => {
				scrollPositions.current.set( view, scrollArea.current?.scrollTop ?? 0 );
				setViewHistory( ( history ) => history.slice( 0, -1 ) );
				replaceView( previousView );
		  }
		: undefined;
	const goBack = () => {
		if ( progress ) return;
		upload.cancel();
		if ( hasCreatedSite || ( ! back && view.name === 'gallery' && ! view.useCase ) ) {
			close();
			return;
		}
		if ( ! back ) {
			scrollPositions.current.set( view, scrollArea.current?.scrollTop ?? 0 );
			replaceView( { name: 'gallery' } );
			return;
		}
		back?.();
		if ( view.name === 'gallery' && previousView?.name === 'gallery' ) {
			createTab.current?.focus();
		}
	};

	const title =
		view.name === 'details'
			? view.blueprint.title
			: view.name === 'setup'
			? __( 'Add site' )
			: view.name === 'connect'
			? __( 'Connect to an existing WordPress' )
			: view.name === 'import'
			? __( 'Import a blueprint or backup' )
			: view.useCase
			? getUseCaseLabel( view.useCase )
			: __( 'Create a new WordPress' );

	const hasSidebar = view.name === 'gallery' || view.name === 'connect' || view.name === 'import';
	const navValue = view.name === 'gallery' ? view.useCase ?? 'create' : view.name;
	const navItems = [
		{ value: 'create', label: __( 'New' ), icon: <PlusIcon /> },
		{ value: 'connect', label: __( 'Connect' ), icon: <CloudDownloadIcon /> },
		{ value: 'import', label: __( 'Import' ), icon: <ImportIcon /> },
	];

	const selectSection = ( value: string ) => {
		if ( progress ) return;
		if (
			value !== navValue &&
			( BLUEPRINT_USE_CASES.some( ( useCase ) => useCase === value ) ||
				( value === 'create' && view.name === 'gallery' && view.useCase ) )
		) {
			void connector
				.trackEvent( TRACKS_EVENTS.BLUEPRINT_USE_CASE_FILTER_CHANGED, {
					use_case: value === 'create' ? 'all' : value,
				} )
				.catch( () => undefined );
		}
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
			scrollRef={ scrollArea }
			footer={ view.name === 'setup' ? <DialogFooter ref={ setFormActions } /> : undefined }
			header={
				<PanelHeader
					leading={
						<div className={ styles.leading }>
							<IconButton
								variant="outline"
								size="icon-sm"
								icon={ <ChevronLeftIcon /> }
								label={
									previousView?.name === 'gallery' &&
									( view.name === 'details' || view.name === 'gallery' )
										? __( 'Back to Blueprints' )
										: __( 'Back' )
								}
								disabled={ !! progress }
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
							{ progress && followedSite && view.name !== 'details' ? (
								<Progress siteId={ followedSite } />
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
							onClearFilters={ () => {
								void connector
									.trackEvent( TRACKS_EVENTS.BLUEPRINT_USE_CASE_FILTER_CHANGED, {
										use_case: 'all',
									} )
									.catch( () => undefined );
								setView( { name: 'gallery' } );
							} }
							onBlank={ () => {
								setSource( { type: 'blank' } );
								setIsBlueprintValid( true );
								showSetup();
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
							useCase={ view.useCase }
							onSetup={ showSetup }
						/>
					) : null }
					{ view.name === 'setup' ? (
						source.type === 'import' && source.backup ? (
							<ImportPanel backup={ source.backup } />
						) : (
							<CreatePanel remote={ source.type === 'connect' ? source.remote : undefined } />
						)
					) : null }
					{ view.name === 'connect' ? (
						<ConnectPanel
							onConnect={ ( remote ) => {
								setSource( { type: 'connect', remote } );
								showSetup();
							} }
						/>
					) : null }
					{ view.name === 'import' ? (
						<SiteFileUpload onFile={ handleSiteFile } disabled={ !! progress } />
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
				className={ view.name === 'setup' ? styles.setupDialog : undefined }
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
function Progress( { siteId }: { siteId: string } ) {
	const activity = useSiteSyncActivity( siteId );
	const message = activity?.kind === 'pending' ? activity.message : undefined;
	if ( ! message ) return null;
	return (
		<p className={ styles.progress } role="status" aria-live="polite">
			<Spinner aria-hidden="true" />
			{ message }
		</p>
	);
}
