import * as Sentry from '@sentry/electron/renderer';
import { __, sprintf } from '@wordpress/i18n';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
} from 'react';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useDevelopmentProjects } from '../../hooks/use-development-projects';
import workbenchStyles from '../development-workbench.module.css';
import {
	formatAiReviewEventMessage,
	isInternalAiReviewChatMessage,
	shouldAppendAiReviewEventToChat,
} from './agent-event-messages';
import {
	getAncestorDirectoryPaths,
	getExplorerIgnorePattern,
	getExplorerValidationSummaries,
} from './explorer-validation';
import { FileExplorer } from './file-explorer';
import { ProjectEditorPanel } from './project-editor-panel';
import { ProjectWorkbenchTitlebar } from './project-workbench-titlebar';
import { ReleaseReviewSidebar } from './release-review-sidebar';
import { ReleaseSidebar } from './release-sidebar';
import { StudioCodeSidebar } from './studio-code-sidebar';
import {
	applyDiffHunkToContent,
	applyDiffHunksToContent,
	buildDiffHunks,
	choosePreferredProjectFile,
	countDiffHunkLines,
	createReviewPatchFromContents,
	getDirectoryDepth,
	getPatchHunks,
	isFixPluginSlashCommand,
	revertDiffHunkInContent,
	resolvePluginDevelopmentAiPrompt,
} from './utils';
import { WorkbenchActivityBar } from './workbench-activity-bar';
import { WorkbenchSidebar } from './workbench-sidebar';
import type {
	AiPatchItem,
	DevelopmentChatExample,
	DevelopmentChatMessage,
	DevelopmentProjectContextMenuAction,
	DirectoryExpansionOverrides,
	DiffHunk,
	EditorRevealRequest,
	ExplorerValidationSummary,
	FileTreeEntry,
	OpenFileTab,
	ProjectOpenAction,
	ResizableWorkbenchColumn,
	WorkbenchSidebarTab,
} from './types';
import type {
	DevelopmentProject,
	DevelopmentProjectAiReviewEvent,
	DevelopmentProjectDirectory,
	DevelopmentProjectFile,
	DevelopmentProjectFilesResult,
	DevelopmentProjectReleaseTag,
	DevelopmentProjectReleaseTagSwitchResult,
	DevelopmentProjectValidationFinding,
	DevelopmentProjectValidationResult,
	DevelopmentProjectValidationState,
} from '@studio/common/types/publishing';
import type { ComposerSendAttachments } from 'src/components/studio-code-session/composer/use-composer-attachments';
import '@wordpress/theme/design-tokens.css';

const ACTIVITY_BAR_WIDTH = 46;
const EDITOR_MIN_WIDTH = 360;
const EXPLORER_DEFAULT_WIDTH = 240;
const EXPLORER_MIN_WIDTH = 184;
const EXPLORER_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 372;
const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 560;
const RESIZE_KEYBOARD_STEP = 16;

type EditableProjectSnapshot = {
	filesResult: DevelopmentProjectFilesResult;
	contents: Map< string, string >;
};

function clamp( value: number, min: number, max: number ): number {
	return Math.min( Math.max( value, min ), max );
}

function escapeMarkdownInlineCode( value: string ): string {
	return value.replace( /`/g, '\\`' );
}

function toMarkdownFileList( patches: AiPatchItem[] ): string {
	const visiblePatches = patches.slice( 0, 6 );
	const fileList = visiblePatches
		.map( ( patch ) => `- \`${ escapeMarkdownInlineCode( patch.path ) }\` (${ patch.status })` )
		.join( '\n' );

	if ( patches.length <= visiblePatches.length ) {
		return fileList;
	}

	return `${ fileList }\n- ${ sprintf(
		// translators: %d is the number of additional proposed file changes.
		__( '%d more file changes' ),
		patches.length - visiblePatches.length
	) }`;
}

function filterInternalAiReviewChatMessages(
	messages: DevelopmentChatMessage[]
): DevelopmentChatMessage[] {
	return messages.filter(
		( message ) =>
			message.role !== 'assistant' || ! isInternalAiReviewChatMessage( message.content )
	);
}

function createUnsupportedFileTab( filePath: string, reason?: string ): OpenFileTab {
	return {
		path: filePath,
		savedContent: '',
		draftContent: '',
		fileKind: 'unsupported',
		editable: false,
		previewable: false,
		mode: 'unsupported',
		isLoading: false,
		unsupportedReason:
			reason ??
			__(
				'Binary, archive, and oversized files are kept in the project, but Studio does not open them in the editor.'
			),
	};
}

function isUnsupportedFileReadError( message: string ): boolean {
	return /too large|cannot be previewed|unsupported|binary/i.test( message );
}

function getChatMessagesSignature( messages: DevelopmentChatMessage[] ): string {
	return JSON.stringify( messages );
}

function createReleaseReviewPatches(
	beforeSnapshot: Map< string, string >,
	afterSnapshot: Map< string, string >,
	prompt: string
): AiPatchItem[] {
	const createdAt = new Date().toISOString();
	const allPaths = Array.from(
		new Set( [ ...beforeSnapshot.keys(), ...afterSnapshot.keys() ] )
	).sort( ( firstPath, secondPath ) => firstPath.localeCompare( secondPath ) );

	return allPaths.flatMap( ( filePath, index ) => {
		const beforeContent = beforeSnapshot.get( filePath );
		const afterContent = afterSnapshot.get( filePath );
		const patch = createReviewPatchFromContents( {
			filePath,
			beforeContent,
			afterContent,
			prompt,
		} );
		if ( ! patch ) {
			return [];
		}

		return [
			{
				...patch,
				id: `release:${ createdAt }:${ index }:${ filePath }`,
				createdAt,
			},
		];
	} );
}

export function ProjectWorkbench( {
	project,
	isBlocked,
	isRefreshing,
	onRefresh,
	onRemove,
	openButtons,
}: {
	project: DevelopmentProject;
	isBlocked: boolean;
	isRefreshing: boolean;
	onRefresh: () => Promise< void >;
	onRemove: () => Promise< void >;
	openButtons: ProjectOpenAction[];
} ) {
	const {
		addProjectIgnorePattern,
		applyAiPatch,
		listProjectFiles,
		readProjectFile,
		refreshProject,
		removeProjectIgnorePattern,
		getProjectValidationState,
		loadProjectChat,
		runAiReview,
		runProjectValidation,
		saveProjectChat,
		switchProjectReleaseTag,
		writeProjectFile,
	} = useDevelopmentProjects();
	const ipcApi = getIpcApi();
	const [ files, setFiles ] = useState< DevelopmentProjectFile[] >( [] );
	const [ directories, setDirectories ] = useState< DevelopmentProjectDirectory[] >( [] );
	const [ selectedPath, setSelectedPath ] = useState< string | null >( null );
	const [ openTabs, setOpenTabs ] = useState< OpenFileTab[] >( [] );
	const [ revealRequest, setRevealRequest ] = useState< EditorRevealRequest | null >( null );
	const [ isLoadingFiles, setIsLoadingFiles ] = useState( false );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ applyingPatchId, setApplyingPatchId ] = useState< string | null >( null );
	const [ fileError, setFileError ] = useState< string | null >( null );
	const [ sidebarTab, setSidebarTab ] = useState< WorkbenchSidebarTab >( 'ai' );
	const [ isRunningAiReview, setIsRunningAiReview ] = useState( false );
	const [ aiStatusMessage, setAiStatusMessage ] = useState< string | null >( null );
	const [ aiPatches, setAiPatches ] = useState< AiPatchItem[] >( [] );
	const [ releaseReviewPatches, setReleaseReviewPatches ] = useState< AiPatchItem[] >( [] );
	const [ releaseReviewLabel, setReleaseReviewLabel ] = useState< string | null >( null );
	const [ aiChatMessages, setAiChatMessages ] = useState< DevelopmentChatMessage[] >( [] );
	const [ selectedPatchId, setSelectedPatchId ] = useState< string | null >( null );
	const [ isUpdatingIgnorePattern, setIsUpdatingIgnorePattern ] = useState( false );
	const [ directoryExpansionOverrides, setDirectoryExpansionOverrides ] =
		useState< DirectoryExpansionOverrides >( {} );
	const [ validationResult, setValidationResult ] =
		useState< DevelopmentProjectValidationResult | null >( null );
	const [ isValidatingProject, setIsValidatingProject ] = useState( false );
	const [ explorerWidth, setExplorerWidth ] = useState( EXPLORER_DEFAULT_WIDTH );
	const [ sidebarWidth, setSidebarWidth ] = useState( SIDEBAR_DEFAULT_WIDTH );
	const [ resizingColumn, setResizingColumn ] = useState< ResizableWorkbenchColumn | null >( null );
	const workbenchMainRef = useRef< HTMLDivElement | null >( null );
	const editorTabsListRef = useRef< HTMLDivElement | null >( null );
	const editorTabRefs = useRef< Map< string, HTMLDivElement > >( new Map() );
	const editorTabButtonRefs = useRef< Map< string, HTMLButtonElement > >( new Map() );
	const filesRef = useRef< DevelopmentProjectFile[] >( [] );
	const selectedPathRef = useRef< string | null >( null );
	const openTabsRef = useRef< OpenFileTab[] >( [] );
	const shouldAutoOpenInitialFileRef = useRef( true );
	const aiChatMessageIdRef = useRef( 0 );
	const isHydratingChatRef = useRef( false );
	const lastSavedChatSignatureRef = useRef( getChatMessagesSignature( [] ) );
	const lastAiReviewEventMessageRef = useRef< string | null >( null );
	const selectedTab = openTabs.find( ( tab ) => tab.path === selectedPath );
	const selectedFile = files.find( ( file ) => file.path === selectedPath );
	const activeDraftContent = selectedTab?.draftContent ?? '';
	const activeSavedContent = selectedTab?.savedContent ?? '';
	const isLoadingFile = Boolean( selectedTab?.isLoading );
	const hasUnsavedChanges = Boolean(
		selectedTab?.editable && activeDraftContent !== activeSavedContent
	);
	const selectedTabCanEdit = Boolean( selectedTab?.editable );
	const selectedTabCanPreview = Boolean( selectedTab?.previewable );
	const reviewPatches = useMemo(
		() => [ ...releaseReviewPatches, ...aiPatches ],
		[ aiPatches, releaseReviewPatches ]
	);
	const selectedPatch = selectedPatchId
		? reviewPatches.find( ( patch ) => patch.id === selectedPatchId ) || null
		: null;
	const selectedPatchHunks = useMemo(
		() => ( selectedPatch ? getPatchHunks( selectedPatch ) : [] ),
		[ selectedPatch ]
	);
	const selectedFilePatch = useMemo( () => {
		if ( ! selectedPath ) {
			return selectedPatch;
		}

		if ( selectedPatch?.path === selectedPath ) {
			return selectedPatch;
		}

		return reviewPatches.find( ( patch ) => patch.path === selectedPath ) || null;
	}, [ reviewPatches, selectedPatch, selectedPath ] );
	const selectedFilePatchHunks = useMemo(
		() => ( selectedFilePatch ? getPatchHunks( selectedFilePatch ) : [] ),
		[ selectedFilePatch ]
	);
	const selectedFilePatchSide = selectedFilePatch?.source === 'release' ? 'after' : 'before';
	const selectedFileFindings = useMemo(
		() =>
			validationResult
				? validationResult.findings.filter( ( finding ) => finding.file === selectedPath )
				: [],
		[ selectedPath, validationResult ]
	);
	const explorerValidationSummaries = useMemo(
		() =>
			validationResult
				? getExplorerValidationSummaries( validationResult.findings )
				: new Map< string, ExplorerValidationSummary >(),
		[ validationResult ]
	);
	const openTabPathKey = useMemo(
		() => openTabs.map( ( tab ) => tab.path ).join( '\0' ),
		[ openTabs ]
	);
	const preferredProjectFile = useMemo(
		() => choosePreferredProjectFile( project, files ),
		[ files, project ]
	);
	const fileEntries = useMemo< FileTreeEntry[] >(
		() =>
			[
				...directories.map( ( directory ) => ( {
					kind: 'directory' as const,
					path: directory.path,
					name: directory.name,
					parent: directory.parent,
					depth: getDirectoryDepth( directory.path ),
					ignored: directory.ignored,
					ignoredBy: directory.ignoredBy,
				} ) ),
				...files.map( ( file ) => ( {
					kind: 'file' as const,
					path: file.path,
					name: file.name,
					directory: file.directory,
					depth: getDirectoryDepth( file.path ),
					size: file.size,
					extension: file.extension,
					fileKind: file.fileKind,
					mediaType: file.mediaType,
					editable: file.editable,
					previewable: file.previewable,
					ignored: file.ignored,
					ignoredBy: file.ignoredBy,
				} ) ),
			].sort( ( firstEntry, secondEntry ) => {
				const firstSegments = firstEntry.path.split( '/' );
				const secondSegments = secondEntry.path.split( '/' );
				const maxSegments = Math.max( firstSegments.length, secondSegments.length );
				for ( let index = 0; index < maxSegments; index += 1 ) {
					if ( firstSegments[ index ] === secondSegments[ index ] ) {
						continue;
					}
					if ( firstSegments[ index ] === undefined ) {
						return -1;
					}
					if ( secondSegments[ index ] === undefined ) {
						return 1;
					}
					return firstSegments[ index ].localeCompare( secondSegments[ index ] );
				}
				if ( firstEntry.kind !== secondEntry.kind ) {
					return firstEntry.kind === 'directory' ? -1 : 1;
				}
				return 0;
			} ),
		[ directories, files ]
	);
	const directoryEntryByPath = useMemo(
		() =>
			new Map(
				fileEntries
					.filter( ( entry ): entry is Extract< FileTreeEntry, { kind: 'directory' } > => {
						return entry.kind === 'directory';
					} )
					.map( ( entry ) => [ entry.path, entry ] )
			),
		[ fileEntries ]
	);
	const visibleFileEntries = useMemo(
		() =>
			fileEntries.filter( ( entry ) =>
				getAncestorDirectoryPaths( entry ).every( ( directoryPath ) => {
					const directoryEntry = directoryEntryByPath.get( directoryPath );
					const isExpanded =
						directoryExpansionOverrides[ directoryPath ] ?? ! directoryEntry?.ignored;
					return isExpanded;
				} )
			),
		[ directoryEntryByPath, directoryExpansionOverrides, fileEntries ]
	);
	const aiChatExamples = useMemo< DevelopmentChatExample[] >(
		() => [
			{
				id: 'prepare-release',
				label: __( 'Prepare a release' ),
				prompt: __(
					'Review this plugin for release readiness and propose safe changes for issues you find.'
				),
			},
			{
				id: 'fix-error',
				label: __( 'Fix an error' ),
				prompt: __( 'Find the likely cause of the current error and propose a minimal fix.' ),
			},
			{
				id: 'update-readme',
				label: __( 'Update readme.txt' ),
				prompt: __( 'Review readme.txt and propose improvements for WordPress.org publishing.' ),
			},
			{
				id: 'version-bump',
				label: __( 'Version bump' ),
				prompt: __( 'Prepare the plugin files for a safe patch version bump.' ),
			},
			{
				id: 'plugin-check',
				label: __( 'Review Plugin Check' ),
				prompt: __(
					'Look for Plugin Check issues and propose fixes that keep behavior unchanged.'
				),
			},
			{
				id: 'explain-plugin',
				label: __( 'Explain this plugin' ),
				prompt: __(
					'Explain the main structure of this plugin and call out risky files to inspect.'
				),
			},
		],
		[]
	);
	const appendAiChatMessage = useCallback(
		( role: DevelopmentChatMessage[ 'role' ], content: string ) => {
			aiChatMessageIdRef.current += 1;
			setAiChatMessages( ( currentMessages ) => [
				...currentMessages,
				{
					id: `${ Date.now() }:${ aiChatMessageIdRef.current }`,
					role,
					content,
				},
			] );
		},
		[]
	);
	const appendAiReviewEventMessage = useCallback(
		( content: string ) => {
			const trimmedContent = content.trim();
			if ( ! trimmedContent || lastAiReviewEventMessageRef.current === trimmedContent ) {
				return;
			}
			lastAiReviewEventMessageRef.current = trimmedContent;
			appendAiChatMessage( 'assistant', trimmedContent );
		},
		[ appendAiChatMessage ]
	);
	const handleAiReviewEvent = useCallback(
		( event: DevelopmentProjectAiReviewEvent[ 'event' ] ) => {
			const message = formatAiReviewEventMessage( event );
			if ( ! message ) {
				return;
			}

			if (
				event.type === 'run.started' ||
				event.type === 'run.exited' ||
				event.type === 'turn.started' ||
				event.type === 'turn.completed' ||
				event.type === 'progress' ||
				event.type === 'info'
			) {
				setAiStatusMessage( message );
			}
			if ( ! shouldAppendAiReviewEventToChat( event ) ) {
				return;
			}
			appendAiReviewEventMessage( message );
		},
		[ appendAiReviewEventMessage ]
	);
	const handleClearAiChat = useCallback( () => {
		lastAiReviewEventMessageRef.current = null;
		aiChatMessageIdRef.current = 0;
		setAiChatMessages( [] );
		setAiStatusMessage( null );
	}, [] );
	const getMainWidth = useCallback( () => {
		return workbenchMainRef.current?.getBoundingClientRect().width ?? window.innerWidth;
	}, [] );
	const getExplorerMaxWidth = useCallback(
		( nextSidebarWidth = sidebarWidth ) => {
			const availableWidth =
				getMainWidth() - ACTIVITY_BAR_WIDTH - EDITOR_MIN_WIDTH - nextSidebarWidth;
			return Math.max( EXPLORER_MIN_WIDTH, Math.min( EXPLORER_MAX_WIDTH, availableWidth ) );
		},
		[ getMainWidth, sidebarWidth ]
	);
	const getSidebarMaxWidth = useCallback(
		( nextExplorerWidth = explorerWidth ) => {
			const availableWidth =
				getMainWidth() - ACTIVITY_BAR_WIDTH - EDITOR_MIN_WIDTH - nextExplorerWidth;
			return Math.max( SIDEBAR_MIN_WIDTH, Math.min( SIDEBAR_MAX_WIDTH, availableWidth ) );
		},
		[ explorerWidth, getMainWidth ]
	);
	const workbenchMainStyle = useMemo(
		() =>
			( {
				'--development-explorer-width': `${ explorerWidth }px`,
				'--development-sidebar-width': `${ sidebarWidth }px`,
			} ) as CSSProperties,
		[ explorerWidth, sidebarWidth ]
	);
	const resizeExplorer = useCallback(
		( nextWidth: number, nextSidebarWidth = sidebarWidth ) => {
			setExplorerWidth(
				clamp( nextWidth, EXPLORER_MIN_WIDTH, getExplorerMaxWidth( nextSidebarWidth ) )
			);
		},
		[ getExplorerMaxWidth, sidebarWidth ]
	);
	const resizeSidebar = useCallback(
		( nextWidth: number, nextExplorerWidth = explorerWidth ) => {
			setSidebarWidth(
				clamp( nextWidth, SIDEBAR_MIN_WIDTH, getSidebarMaxWidth( nextExplorerWidth ) )
			);
		},
		[ explorerWidth, getSidebarMaxWidth ]
	);
	const handleColumnResizePointerDown = useCallback(
		( column: ResizableWorkbenchColumn, event: ReactPointerEvent< HTMLButtonElement > ) => {
			event.preventDefault();

			const startX = event.clientX;
			const startExplorerWidth = explorerWidth;
			const startSidebarWidth = sidebarWidth;
			const previousCursor = document.body.style.cursor;
			const previousUserSelect = document.body.style.userSelect;

			setResizingColumn( column );
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';

			const handlePointerMove = ( pointerEvent: PointerEvent ) => {
				pointerEvent.preventDefault();
				const delta = pointerEvent.clientX - startX;

				if ( column === 'explorer' ) {
					resizeExplorer( startExplorerWidth + delta, startSidebarWidth );
					return;
				}

				resizeSidebar( startSidebarWidth - delta, startExplorerWidth );
			};

			const stopResizing = () => {
				setResizingColumn( null );
				document.body.style.cursor = previousCursor;
				document.body.style.userSelect = previousUserSelect;
				document.removeEventListener( 'pointermove', handlePointerMove );
				document.removeEventListener( 'pointerup', stopResizing );
				document.removeEventListener( 'pointercancel', stopResizing );
			};

			document.addEventListener( 'pointermove', handlePointerMove );
			document.addEventListener( 'pointerup', stopResizing );
			document.addEventListener( 'pointercancel', stopResizing );
		},
		[ explorerWidth, resizeExplorer, resizeSidebar, sidebarWidth ]
	);
	const handleColumnResizeKeyDown = useCallback(
		( column: ResizableWorkbenchColumn, event: KeyboardEvent< HTMLButtonElement > ) => {
			const key = event.key;
			if ( ! [ 'ArrowLeft', 'ArrowRight', 'Home', 'End' ].includes( key ) ) {
				return;
			}

			event.preventDefault();

			if ( column === 'explorer' ) {
				if ( key === 'Home' ) {
					resizeExplorer( EXPLORER_MIN_WIDTH );
				} else if ( key === 'End' ) {
					resizeExplorer( EXPLORER_MAX_WIDTH );
				} else {
					resizeExplorer(
						explorerWidth + ( key === 'ArrowRight' ? RESIZE_KEYBOARD_STEP : -RESIZE_KEYBOARD_STEP )
					);
				}
				return;
			}

			if ( key === 'Home' ) {
				resizeSidebar( SIDEBAR_MIN_WIDTH );
			} else if ( key === 'End' ) {
				resizeSidebar( SIDEBAR_MAX_WIDTH );
			} else {
				resizeSidebar(
					sidebarWidth + ( key === 'ArrowLeft' ? RESIZE_KEYBOARD_STEP : -RESIZE_KEYBOARD_STEP )
				);
			}
		},
		[ explorerWidth, resizeExplorer, resizeSidebar, sidebarWidth ]
	);
	const updateOpenTab = useCallback(
		( filePath: string, updater: ( tab: OpenFileTab ) => OpenFileTab ) => {
			setOpenTabs( ( currentTabs ) =>
				currentTabs.map( ( tab ) => ( tab.path === filePath ? updater( tab ) : tab ) )
			);
		},
		[]
	);
	const setEditorTabRef = useCallback(
		( filePath: string ) => ( element: HTMLDivElement | null ) => {
			if ( element ) {
				editorTabRefs.current.set( filePath, element );
				return;
			}
			editorTabRefs.current.delete( filePath );
		},
		[]
	);
	const setEditorTabButtonRef = useCallback(
		( filePath: string ) => ( element: HTMLButtonElement | null ) => {
			if ( element ) {
				editorTabButtonRefs.current.set( filePath, element );
				return;
			}
			editorTabButtonRefs.current.delete( filePath );
		},
		[]
	);

	const handleProjectReleaseRefSwitched = useCallback( () => {
		shouldAutoOpenInitialFileRef.current = true;
		selectedPathRef.current = null;
		openTabsRef.current = [];
		setFiles( [] );
		setDirectories( [] );
		setSelectedPath( null );
		setOpenTabs( [] );
		setRevealRequest( null );
		setFileError( null );
		setAiPatches( [] );
		setReleaseReviewPatches( [] );
		setReleaseReviewLabel( null );
		setSelectedPatchId( null );
		setDirectoryExpansionOverrides( {} );
		setValidationResult( null );
	}, [] );

	useEffect( () => {
		shouldAutoOpenInitialFileRef.current = true;
		selectedPathRef.current = null;
		openTabsRef.current = [];
		setFiles( [] );
		setDirectories( [] );
		setSelectedPath( null );
		setOpenTabs( [] );
		setRevealRequest( null );
		setFileError( null );
		setAiPatches( [] );
		setReleaseReviewPatches( [] );
		setReleaseReviewLabel( null );
		setSelectedPatchId( null );
		setDirectoryExpansionOverrides( {} );
		setValidationResult( null );
	}, [ project.id ] );

	useEffect( () => {
		selectedPathRef.current = selectedPath;
	}, [ selectedPath ] );

	useEffect( () => {
		openTabsRef.current = openTabs;
	}, [ openTabs ] );

	useEffect( () => {
		if ( sidebarTab === 'review' && reviewPatches.length === 0 ) {
			setSidebarTab( 'releases' );
		}
	}, [ reviewPatches.length, sidebarTab ] );

	useEffect( () => {
		let isCancelled = false;
		isHydratingChatRef.current = true;
		lastAiReviewEventMessageRef.current = null;
		aiChatMessageIdRef.current = 0;
		lastSavedChatSignatureRef.current = getChatMessagesSignature( [] );
		setAiChatMessages( [] );

		void loadProjectChat( project.id )
			.then( ( chatState ) => {
				if ( isCancelled ) {
					return;
				}
				const messages = filterInternalAiReviewChatMessages( chatState.messages );
				setAiChatMessages( messages );
				aiChatMessageIdRef.current = messages.length;
				lastSavedChatSignatureRef.current = getChatMessagesSignature( messages );
				if ( messages.length !== chatState.messages.length ) {
					void saveProjectChat( project.id, messages ).catch( ( error ) => {
						Sentry.captureException( error );
					} );
				}
			} )
			.catch( ( error ) => {
				if ( ! isCancelled ) {
					Sentry.captureException( error );
				}
			} )
			.finally( () => {
				if ( ! isCancelled ) {
					isHydratingChatRef.current = false;
				}
			} );

		return () => {
			isCancelled = true;
			isHydratingChatRef.current = false;
		};
	}, [ loadProjectChat, project.id, saveProjectChat ] );

	useEffect( () => {
		if ( isHydratingChatRef.current ) {
			return;
		}

		const signature = getChatMessagesSignature( aiChatMessages );
		if ( signature === lastSavedChatSignatureRef.current ) {
			return;
		}

		lastSavedChatSignatureRef.current = signature;
		void saveProjectChat( project.id, aiChatMessages ).catch( ( error ) => {
			lastSavedChatSignatureRef.current = '';
			Sentry.captureException( error );
		} );
	}, [ aiChatMessages, project.id, saveProjectChat ] );

	useEffect( () => {
		if ( ! selectedPath ) {
			return;
		}

		const tabsList = editorTabsListRef.current;
		const activeTab = editorTabRefs.current.get( selectedPath );
		if ( ! tabsList || ! activeTab ) {
			return;
		}

		const animationFrame = window.requestAnimationFrame( () => {
			const activeButton = editorTabButtonRefs.current.get( selectedPath );
			activeButton?.focus( { preventScroll: true } );

			const visibleLeft = tabsList.scrollLeft;
			const visibleRight = visibleLeft + tabsList.clientWidth;
			const tabLeft = activeTab.offsetLeft;
			const tabRight = tabLeft + activeTab.offsetWidth;
			if ( tabLeft < visibleLeft ) {
				tabsList.scrollTo( { left: tabLeft, behavior: 'smooth' } );
				return;
			}
			if ( tabRight > visibleRight ) {
				tabsList.scrollTo( { left: tabRight - tabsList.clientWidth, behavior: 'smooth' } );
			}
		} );

		return () => window.cancelAnimationFrame( animationFrame );
	}, [ openTabPathKey, selectedPath ] );

	const openFileTab = useCallback(
		async ( filePath: string, options: { preserveSelectedPatch?: boolean } = {} ) => {
			const openUnsupportedTab = ( reason?: string ) => {
				const unsupportedTab = createUnsupportedFileTab( filePath, reason );
				shouldAutoOpenInitialFileRef.current = false;
				selectedPathRef.current = filePath;
				if ( ! options.preserveSelectedPatch ) {
					setSelectedPatchId( null );
				}
				setSelectedPath( filePath );
				setFileError( null );
				setOpenTabs( ( currentTabs ) => {
					const nextTabs = currentTabs.some( ( tab ) => tab.path === filePath )
						? currentTabs.map( ( tab ) => ( tab.path === filePath ? unsupportedTab : tab ) )
						: [ ...currentTabs, unsupportedTab ];
					openTabsRef.current = nextTabs;
					return nextTabs;
				} );
				return false;
			};
			const openableFile = filesRef.current.find( ( file ) => file.path === filePath );
			if (
				filesRef.current.length > 0 &&
				( ! openableFile || ( ! openableFile.editable && ! openableFile.previewable ) )
			) {
				return openUnsupportedTab();
			}

			shouldAutoOpenInitialFileRef.current = false;
			selectedPathRef.current = filePath;
			if ( ! options.preserveSelectedPatch ) {
				setSelectedPatchId( null );
			}
			setSelectedPath( filePath );

			setOpenTabs( ( currentTabs ) => {
				const loadingTab: OpenFileTab = {
					path: filePath,
					savedContent: '',
					draftContent: '',
					fileKind: 'text',
					editable: true,
					previewable: false,
					mode: 'code',
					isLoading: true,
				};
				const nextTabs = currentTabs.some( ( tab ) => tab.path === filePath )
					? currentTabs
					: [ ...currentTabs, loadingTab ];
				openTabsRef.current = nextTabs;
				return nextTabs;
			} );
			setFileError( null );

			try {
				const result = await readProjectFile( project.id, filePath );
				updateOpenTab( filePath, ( tab ) =>
					tab.isLoading
						? {
								path: result.path,
								savedContent: result.content,
								draftContent: result.content,
								fileKind: result.fileKind,
								mediaType: result.mediaType,
								dataUrl: result.dataUrl,
								editable: result.editable,
								previewable: result.previewable,
								mode: result.mode,
								isLoading: false,
						  }
						: tab
				);
				return true;
			} catch ( error ) {
				const message = error instanceof Error ? error.message : String( error );
				if ( isUnsupportedFileReadError( message ) ) {
					return openUnsupportedTab();
				}

				Sentry.captureException( error );
				updateOpenTab( filePath, ( tab ) => ( {
					...tab,
					isLoading: false,
					error: message,
				} ) );
				setFileError( message );
				return false;
			}
		},
		[ project.id, readProjectFile, updateOpenTab ]
	);

	const applyProjectFilesResult = useCallback(
		( result: DevelopmentProjectFilesResult ) => {
			filesRef.current = result.files;
			setFiles( result.files );
			setDirectories( result.directories );
			const currentOpenTabs = openTabsRef.current;
			const nextOpenTabs = currentOpenTabs.filter( ( tab ) =>
				result.files.some( ( file ) => file.path === tab.path )
			);
			openTabsRef.current = nextOpenTabs;
			setOpenTabs( nextOpenTabs );

			const currentSelectedPath = selectedPathRef.current;
			const currentPathIsValid =
				currentSelectedPath && result.files.some( ( file ) => file.path === currentSelectedPath );
			const nextPath =
				( currentPathIsValid && currentSelectedPath ) ||
				nextOpenTabs[ 0 ]?.path ||
				( shouldAutoOpenInitialFileRef.current
					? choosePreferredProjectFile( project, result.files )?.path ?? null
					: null );
			selectedPathRef.current = nextPath;
			setSelectedPath( nextPath );
			if ( nextPath && ! nextOpenTabs.some( ( tab ) => tab.path === nextPath ) ) {
				void openFileTab( nextPath );
			}
		},
		[ openFileTab, project ]
	);

	useEffect( () => {
		let isMounted = true;

		if ( isBlocked ) {
			filesRef.current = [];
			setFiles( [] );
			setDirectories( [] );
			setSelectedPath( null );
			setOpenTabs( [] );
			return;
		}

		setIsLoadingFiles( true );
		setFileError( null );
		void listProjectFiles( project.id )
			.then( ( result ) => {
				if ( ! isMounted ) {
					return;
				}
				applyProjectFilesResult( result );
			} )
			.catch( ( error ) => {
				Sentry.captureException( error );
				if ( isMounted ) {
					setFileError( error instanceof Error ? error.message : String( error ) );
				}
			} )
			.finally( () => {
				if ( isMounted ) {
					setIsLoadingFiles( false );
				}
			} );

		return () => {
			isMounted = false;
		};
	}, [ applyProjectFilesResult, isBlocked, listProjectFiles, project.id, project.updatedAt ] );

	const readEditableProjectSnapshot = useCallback( async (): Promise< EditableProjectSnapshot > => {
		const filesResult = await listProjectFiles( project.id );
		const contents = new Map< string, string >();

		await Promise.all(
			filesResult.files
				.filter( ( file ) => file.editable )
				.map( async ( file ) => {
					const fileContent = await readProjectFile( project.id, file.path );
					contents.set( file.path, fileContent.content );
				} )
		);

		return { filesResult, contents };
	}, [ listProjectFiles, project.id, readProjectFile ] );

	const handleSwitchReleaseTag = useCallback(
		async (
			tag: DevelopmentProjectReleaseTag
		): Promise< DevelopmentProjectReleaseTagSwitchResult > => {
			const beforeSnapshot = await readEditableProjectSnapshot();
			const result = await switchProjectReleaseTag( project.id, tag.name );
			const afterSnapshot = await readEditableProjectSnapshot();
			const reviewLabel = sprintf(
				// translators: %s is an SVN ref such as trunk or a version tag.
				__( 'Changes after switching to %s' ),
				result.ref
			);
			const nextReviewPatches = createReleaseReviewPatches(
				beforeSnapshot.contents,
				afterSnapshot.contents,
				reviewLabel
			);

			shouldAutoOpenInitialFileRef.current = true;
			selectedPathRef.current = null;
			openTabsRef.current = [];
			setOpenTabs( [] );
			setSelectedPath( null );
			setRevealRequest( null );
			setFileError( null );
			setAiPatches( [] );
			setReleaseReviewPatches( nextReviewPatches );
			setReleaseReviewLabel( nextReviewPatches.length ? reviewLabel : null );
			setSelectedPatchId( nextReviewPatches[ 0 ]?.id ?? null );
			setDirectoryExpansionOverrides( {} );
			setValidationResult( null );
			applyProjectFilesResult( afterSnapshot.filesResult );
			setSidebarTab( nextReviewPatches.length ? 'review' : 'releases' );

			return result;
		},
		[ applyProjectFilesResult, project.id, readEditableProjectSnapshot, switchProjectReleaseTag ]
	);

	const closeFileTab = async ( filePath: string ) => {
		const tab = openTabs.find( ( item ) => item.path === filePath );
		if ( tab?.editable && tab.draftContent !== tab.savedContent ) {
			const KEEP_EDITING_BUTTON_INDEX = 1;
			const { response } = await ipcApi.showMessageBox( {
				type: 'warning',
				message: __( 'Discard unsaved changes?' ),
				detail: __( 'Closing this file will discard its current editor draft.' ),
				buttons: [ __( 'Discard changes' ), __( 'Keep editing' ) ],
				cancelId: KEEP_EDITING_BUTTON_INDEX,
			} );

			if ( response === KEEP_EDITING_BUTTON_INDEX ) {
				return;
			}
		}

		setOpenTabs( ( currentTabs ) => {
			const closedIndex = currentTabs.findIndex( ( item ) => item.path === filePath );
			const nextTabs = currentTabs.filter( ( item ) => item.path !== filePath );
			openTabsRef.current = nextTabs;
			if ( nextTabs.length === 0 ) {
				shouldAutoOpenInitialFileRef.current = false;
			}
			if ( selectedPath === filePath ) {
				const nextSelectedTab = nextTabs[ Math.max( 0, closedIndex - 1 ) ] || nextTabs[ 0 ];
				const nextPath = nextSelectedTab?.path ?? null;
				selectedPathRef.current = nextPath;
				setSelectedPath( nextPath );
			}
			return nextTabs;
		} );
	};

	const handleSelectFile = async ( filePath: string ) => {
		await openFileTab( filePath );
	};

	const handleSelectOpenTab = ( filePath: string ) => {
		setSelectedPatchId( null );
		selectedPathRef.current = filePath;
		setSelectedPath( filePath );
	};

	const closeReviewTab = ( patchPath?: string ) => {
		setSelectedPatchId( null );
		if (
			patchPath &&
			selectedPathRef.current === patchPath &&
			! openTabsRef.current.some( ( tab ) => tab.path === patchPath )
		) {
			const nextPath = openTabsRef.current[ 0 ]?.path ?? null;
			selectedPathRef.current = nextPath;
			setSelectedPath( nextPath );
		}
	};

	const handleSelectPatch = async ( patchId: string ) => {
		const patch = reviewPatches.find( ( currentPatch ) => currentPatch.id === patchId );
		if ( ! patch ) {
			setSelectedPatchId( null );
			return;
		}

		setSelectedPatchId( patchId );
		setSidebarTab( 'review' );
		if ( patch.status !== 'deleted' ) {
			await openFileTab( patch.path, { preserveSelectedPatch: true } );
		}
		setSelectedPatchId( patchId );
	};

	const handleSelectFileMode = ( mode: OpenFileTab[ 'mode' ] ) => {
		if ( ! selectedPath || ! selectedTab?.previewable ) {
			return;
		}
		updateOpenTab( selectedPath, ( tab ) => ( { ...tab, mode } ) );
	};

	const handleSave = async () => {
		if ( ! selectedPath || ! selectedTab?.editable || isBlocked ) {
			return;
		}

		setIsSaving( true );
		setFileError( null );
		try {
			const previousSavedContent = selectedTab.savedContent;
			const result = await writeProjectFile( project.id, selectedPath, selectedTab.draftContent );
			updateOpenTab( selectedPath, ( tab ) => ( {
				...tab,
				path: result.path,
				savedContent: result.content,
				draftContent: result.content,
				fileKind: result.fileKind,
				mediaType: result.mediaType,
				dataUrl: result.dataUrl,
				editable: result.editable,
				previewable: result.previewable,
				isLoading: false,
				error: undefined,
			} ) );
			setAiPatches( ( currentPatches ) =>
				currentPatches.filter( ( patch ) => patch.path !== selectedPath )
			);
			const reviewLabel = __( 'Local saved changes' );
			upsertReleaseReviewPatch( {
				filePath: selectedPath,
				beforeContent: previousSavedContent,
				afterContent: result.content,
				prompt: reviewLabel,
			} );
			setValidationResult( null );
			await refreshProject( project.id ).catch( () => undefined );
		} catch ( error ) {
			Sentry.captureException( error );
			setFileError( error instanceof Error ? error.message : String( error ) );
		} finally {
			setIsSaving( false );
		}
	};

	const handleRunAiReview = async ( prompt: string, _attachments?: ComposerSendAttachments ) => {
		const { displayPrompt, reviewPrompt } = resolvePluginDevelopmentAiPrompt( prompt );
		if ( ! displayPrompt || ! reviewPrompt || hasUnsavedChanges || isBlocked ) {
			return;
		}

		const isFixPluginRequest = isFixPluginSlashCommand( displayPrompt );
		lastAiReviewEventMessageRef.current = null;
		setIsRunningAiReview( true );
		setAiStatusMessage(
			isFixPluginRequest
				? __( 'Studio Code is fixing Plugin Check errors in a temporary copy…' )
				: __( 'Studio Code is reviewing a temporary copy…' )
		);
		setFileError( null );
		appendAiChatMessage( 'user', displayPrompt );

		try {
			if ( isFixPluginRequest ) {
				setAiStatusMessage( __( 'Running Plugin Check before asking Studio Code…' ) );
				setIsValidatingProject( true );
				const latestValidationResult = await runProjectValidation( project.id ).finally( () => {
					setIsValidatingProject( false );
				} );
				setValidationResult( latestValidationResult );

				if ( latestValidationResult.summary.pluginCheck === 0 ) {
					setAiStatusMessage( __( 'Plugin Check did not report findings.' ) );
					appendAiChatMessage(
						'assistant',
						__( 'I ran Plugin Check and did not find Plugin Check findings to fix.' )
					);
					return;
				}

				setAiStatusMessage(
					__( 'Studio Code is fixing Plugin Check errors in a temporary copy…' )
				);
			}

			const result = await runAiReview( project.id, {
				prompt: reviewPrompt,
				selectedPath: selectedPath ?? undefined,
				includeAllPluginCheckFindings: isFixPluginRequest,
			} );
			const createdAt = new Date().toISOString();
			const nextPatches = result.patches.map( ( patch, index ) => ( {
				...patch,
				id: `${ result.sessionId }:${ index }:${ patch.path }`,
				prompt: displayPrompt,
				createdAt,
			} ) );

			if ( nextPatches.length === 0 ) {
				setAiStatusMessage( __( 'Studio Code did not propose file changes.' ) );
				appendAiChatMessage(
					'assistant',
					__( 'I reviewed the project and did not propose file changes for that request.' )
				);
				return;
			}

			setAiPatches( ( currentPatches ) => [
				...nextPatches,
				...currentPatches.filter(
					( currentPatch ) =>
						! nextPatches.some( ( nextPatch ) => nextPatch.path === currentPatch.path )
				),
			] );
			setSelectedPatchId( nextPatches[ 0 ].id );
			setSidebarTab( 'review' );
			setAiStatusMessage(
				nextPatches.length === 1
					? __( '1 proposed change ready for review.' )
					: sprintf(
							// translators: %d is the number of file patches proposed by Studio Code.
							__( '%d proposed changes ready for review.' ),
							nextPatches.length
					  )
			);
			appendAiChatMessage(
				'assistant',
				`${ sprintf(
					// translators: %d is the number of file patches proposed by Studio Code.
					__(
						'I proposed %d file change(s). Review the diffs below, then accept or reject each one.'
					),
					nextPatches.length
				) }\n\n${ toMarkdownFileList( nextPatches ) }`
			);
		} catch ( error ) {
			Sentry.captureException( error );
			setAiStatusMessage( null );
			const message = error instanceof Error ? error.message : String( error );
			setFileError( message );
			appendAiChatMessage(
				'assistant',
				`${ __( "I couldn't complete that request." ) }\n\n\`${ escapeMarkdownInlineCode(
					message
				) }\``
			);
		} finally {
			setIsRunningAiReview( false );
		}
	};

	const handleFixPluginCheck = async () => {
		setSidebarTab( 'ai' );
		await handleRunAiReview( '/fix-plugin' );
	};

	const upsertReleaseReviewPatch = ( {
		filePath,
		beforeContent,
		afterContent,
		prompt,
		select = true,
	}: {
		filePath: string;
		beforeContent?: string;
		afterContent?: string;
		prompt: string;
		select?: boolean;
	} ) => {
		setReleaseReviewPatches( ( currentPatches ) => {
			const existingPatch = currentPatches.find( ( patch ) => patch.path === filePath );
			const nextPatch = createReviewPatchFromContents( {
				filePath,
				beforeContent: existingPatch?.beforeContent ?? beforeContent,
				afterContent,
				prompt,
				existingPatch,
			} );
			const remainingPatches = currentPatches.filter( ( patch ) => patch.path !== filePath );

			if ( ! nextPatch ) {
				if ( selectedPatchId === existingPatch?.id ) {
					setSelectedPatchId( remainingPatches[ 0 ]?.id ?? null );
				}
				if ( remainingPatches.length === 0 ) {
					setReleaseReviewLabel( null );
					setSidebarTab( 'releases' );
				}
				return remainingPatches;
			}

			setReleaseReviewLabel( prompt );
			if ( select ) {
				setSelectedPatchId( nextPatch.id );
				setSidebarTab( 'review' );
			}
			return [ nextPatch, ...remainingPatches ];
		} );
	};

	const removeReleaseReviewPatch = ( patch: AiPatchItem ) => {
		setReleaseReviewPatches( ( currentPatches ) => {
			const nextPatches = currentPatches.filter( ( currentPatch ) => currentPatch.id !== patch.id );
			if ( selectedPatchId === patch.id ) {
				setSelectedPatchId( nextPatches[ 0 ]?.id ?? null );
			}
			if ( nextPatches.length === 0 ) {
				setReleaseReviewLabel( null );
				setSidebarTab( 'releases' );
			}
			return nextPatches;
		} );
		closeReviewTab( patch.path );
	};

	const updateReleaseReviewPatchWithContents = (
		patch: AiPatchItem,
		beforeContent: string,
		afterContent: string
	) => {
		const nextHunks = buildDiffHunks( beforeContent, afterContent );
		if ( nextHunks.length === 0 ) {
			removeReleaseReviewPatch( patch );
			return;
		}

		setReleaseReviewPatches( ( currentPatches ) =>
			currentPatches.map( ( currentPatch ) =>
				currentPatch.id === patch.id
					? {
							...currentPatch,
							beforeContent,
							afterContent,
							status:
								patch.status === 'created' || patch.status === 'deleted'
									? patch.status
									: 'modified',
							hunks: nextHunks,
							additions: countDiffHunkLines( nextHunks, 'add' ),
							deletions: countDiffHunkLines( nextHunks, 'delete' ),
					  }
					: currentPatch
			)
		);
		setSelectedPatchId( patch.id );
	};

	const handleKeepReleasePatch = ( patch: AiPatchItem ) => {
		removeReleaseReviewPatch( patch );
	};

	const handleRevertReleasePatch = async ( patch: AiPatchItem ) => {
		setApplyingPatchId( patch.id );
		setFileError( null );
		try {
			const result = await applyAiPatch( project.id, {
				path: patch.path,
				status: patch.status === 'created' ? 'deleted' : 'modified',
				afterContent: patch.status === 'created' ? undefined : patch.beforeContent ?? '',
			} );
			filesRef.current = result.files;
			setFiles( result.files );
			setDirectories( result.directories );
			setValidationResult( null );

			if ( patch.status === 'created' ) {
				setOpenTabs( ( currentTabs ) => {
					const nextTabs = currentTabs.filter( ( tab ) => tab.path !== patch.path );
					openTabsRef.current = nextTabs;
					if ( selectedPath === patch.path ) {
						const nextPath = nextTabs[ 0 ]?.path ?? null;
						selectedPathRef.current = nextPath;
						setSelectedPath( nextPath );
					}
					return nextTabs;
				} );
			} else {
				const nextContent = patch.beforeContent ?? '';
				const revertedFile = result.files.find( ( file ) => file.path === patch.path );
				setOpenTabs( ( currentTabs ) => {
					const nextTabs = currentTabs.map( ( tab ) =>
						tab.path === patch.path
							? {
									...tab,
									savedContent: nextContent,
									draftContent: nextContent,
									fileKind: revertedFile?.fileKind ?? tab.fileKind,
									mediaType: revertedFile?.mediaType ?? tab.mediaType,
									editable: revertedFile?.editable ?? tab.editable,
									previewable: revertedFile?.previewable ?? tab.previewable,
									isLoading: false,
									error: undefined,
							  }
							: tab
					);
					openTabsRef.current = nextTabs;
					return nextTabs;
				} );
			}

			removeReleaseReviewPatch( patch );
			await refreshProject( project.id ).catch( () => undefined );
		} catch ( error ) {
			Sentry.captureException( error );
			setFileError( error instanceof Error ? error.message : String( error ) );
		} finally {
			setApplyingPatchId( null );
		}
	};

	const handleAcceptPatch = async ( patch: AiPatchItem ) => {
		if ( patch.source === 'release' ) {
			handleKeepReleasePatch( patch );
			return;
		}

		setApplyingPatchId( patch.id );
		setFileError( null );
		try {
			const result = await applyAiPatch( project.id, patch );
			setFiles( result.files );
			setDirectories( result.directories );
			setValidationResult( null );
			setAiPatches( ( currentPatches ) =>
				currentPatches.filter( ( currentPatch ) => currentPatch.id !== patch.id )
			);
			setSelectedPatchId( null );

			if ( patch.status === 'deleted' ) {
				setOpenTabs( ( currentTabs ) => {
					const nextTabs = currentTabs.filter( ( tab ) => tab.path !== patch.path );
					if ( selectedPath === patch.path ) {
						setSelectedPath( nextTabs[ 0 ]?.path ?? null );
					}
					return nextTabs;
				} );
			} else {
				const nextContent = patch.afterContent ?? '';
				const patchedFile = result.files.find( ( file ) => file.path === patch.path );
				setOpenTabs( ( currentTabs ) => {
					const existingTab = currentTabs.find( ( tab ) => tab.path === patch.path );
					if ( ! existingTab ) {
						const createdTab: OpenFileTab = {
							path: patch.path,
							savedContent: nextContent,
							draftContent: nextContent,
							fileKind: patchedFile?.fileKind ?? 'text',
							mediaType: patchedFile?.mediaType,
							editable: patchedFile?.editable ?? true,
							previewable: patchedFile?.previewable ?? false,
							mode: patchedFile?.previewable ? 'preview' : 'code',
							isLoading: false,
						};
						return [ ...currentTabs, createdTab ];
					}
					return currentTabs.map( ( tab ) =>
						tab.path === patch.path
							? {
									...tab,
									savedContent: nextContent,
									draftContent: nextContent,
									isLoading: false,
									error: undefined,
							  }
							: tab
					);
				} );
				setSelectedPath( patch.path );
			}

			upsertReleaseReviewPatch( {
				filePath: patch.path,
				beforeContent: patch.beforeContent,
				afterContent: patch.status === 'deleted' ? undefined : patch.afterContent ?? '',
				prompt: __( 'Studio Code changes' ),
			} );
			await refreshProject( project.id ).catch( () => undefined );
			appendAiChatMessage(
				'assistant',
				sprintf(
					// translators: %s is a file path shown as inline markdown code.
					__( 'Accepted the proposed change for `%s`.' ),
					escapeMarkdownInlineCode( patch.path )
				)
			);
		} catch ( error ) {
			Sentry.captureException( error );
			setFileError( error instanceof Error ? error.message : String( error ) );
		} finally {
			setApplyingPatchId( null );
		}
	};

	const handleRejectPatch = ( patch: AiPatchItem ) => {
		if ( patch.source === 'release' ) {
			void handleRevertReleasePatch( patch );
			return;
		}

		setAiPatches( ( currentPatches ) =>
			currentPatches.filter( ( currentPatch ) => currentPatch.id !== patch.id )
		);
		closeReviewTab( patch.path );

		updateOpenTab( patch.path, ( tab ) =>
			tab.draftContent === ( patch.afterContent ?? '' )
				? { ...tab, draftContent: patch.beforeContent ?? '' }
				: tab
		);
		appendAiChatMessage(
			'assistant',
			sprintf(
				// translators: %s is a file path shown as inline markdown code.
				__( 'Rejected the proposed change for `%s`.' ),
				escapeMarkdownInlineCode( patch.path )
			)
		);
	};

	const updatePatchWithRemainingHunks = (
		patch: AiPatchItem,
		beforeContent: string,
		afterContent: string,
		status: AiPatchItem[ 'status' ]
	) => {
		const nextHunks = buildDiffHunks( beforeContent, afterContent );
		if ( nextHunks.length === 0 ) {
			setAiPatches( ( currentPatches ) =>
				currentPatches.filter( ( currentPatch ) => currentPatch.id !== patch.id )
			);
			setSelectedPatchId( null );
			return;
		}

		setAiPatches( ( currentPatches ) =>
			currentPatches.map( ( currentPatch ) =>
				currentPatch.id === patch.id
					? {
							...currentPatch,
							status,
							beforeContent,
							afterContent,
							hunks: nextHunks,
							additions: countDiffHunkLines( nextHunks, 'add' ),
							deletions: countDiffHunkLines( nextHunks, 'delete' ),
					  }
					: currentPatch
			)
		);
		setSelectedPatchId( patch.id );
	};

	const handleAcceptPatchHunk = async ( patch: AiPatchItem, hunk: DiffHunk, hunkIndex: number ) => {
		if ( patch.source === 'release' ) {
			const nextBeforeContent = applyDiffHunkToContent( patch.beforeContent ?? '', hunk );
			updateReleaseReviewPatchWithContents( patch, nextBeforeContent, patch.afterContent ?? '' );
			return;
		}

		const hunks = getPatchHunks( patch );
		const applyingId = `${ patch.id }:hunk:${ hunkIndex }`;
		setApplyingPatchId( applyingId );
		setFileError( null );

		try {
			if ( patch.status === 'deleted' && hunks.length === 1 ) {
				await handleAcceptPatch( patch );
				return;
			}

			const currentContent =
				openTabsRef.current.find( ( tab ) => tab.path === patch.path )?.draftContent ??
				patch.beforeContent ??
				'';
			const nextContent = applyDiffHunkToContent( currentContent, hunk );
			const result = await writeProjectFile( project.id, patch.path, nextContent );
			const projectFiles = await listProjectFiles( project.id );
			filesRef.current = projectFiles.files;
			setFiles( projectFiles.files );
			setDirectories( projectFiles.directories );
			setValidationResult( null );
			setOpenTabs( ( currentTabs ) => {
				const nextTab: OpenFileTab = {
					path: result.path,
					savedContent: result.content,
					draftContent: result.content,
					fileKind: result.fileKind,
					mediaType: result.mediaType,
					dataUrl: result.dataUrl,
					editable: result.editable,
					previewable: result.previewable,
					mode: result.mode,
					isLoading: false,
				};
				const nextTabs = currentTabs.some( ( tab ) => tab.path === patch.path )
					? currentTabs.map( ( tab ) => ( tab.path === patch.path ? nextTab : tab ) )
					: [ ...currentTabs, nextTab ];
				openTabsRef.current = nextTabs;
				return nextTabs;
			} );

			selectedPathRef.current = patch.path;
			setSelectedPath( patch.path );

			upsertReleaseReviewPatch( {
				filePath: patch.path,
				beforeContent: patch.beforeContent,
				afterContent: result.content,
				prompt: __( 'Studio Code changes' ),
				select: false,
			} );
			const targetContent = patch.status === 'deleted' ? '' : patch.afterContent ?? '';
			const nextHunks = buildDiffHunks( nextContent, targetContent );
			if ( nextHunks.length === 0 && patch.status === 'deleted' ) {
				await handleAcceptPatch( {
					...patch,
					beforeContent: nextContent,
				} );
				return;
			}

			updatePatchWithRemainingHunks( patch, nextContent, targetContent, patch.status );
			await refreshProject( project.id ).catch( () => undefined );
			appendAiChatMessage(
				'assistant',
				sprintf(
					// translators: %s is a file path shown as inline markdown code.
					__( 'Accepted one proposed chunk in `%s`.' ),
					escapeMarkdownInlineCode( patch.path )
				)
			);
		} catch ( error ) {
			Sentry.captureException( error );
			setFileError( error instanceof Error ? error.message : String( error ) );
		} finally {
			setApplyingPatchId( null );
		}
	};

	const handleRevertReleasePatchHunk = async ( patch: AiPatchItem, hunk: DiffHunk ) => {
		const applyingId = `${ patch.id }:hunk:revert`;
		setApplyingPatchId( applyingId );
		setFileError( null );

		try {
			const currentContent =
				openTabsRef.current.find( ( tab ) => tab.path === patch.path )?.draftContent ??
				patch.afterContent ??
				'';
			const nextContent = revertDiffHunkInContent( currentContent, hunk );
			const result = await writeProjectFile( project.id, patch.path, nextContent );
			const projectFiles = await listProjectFiles( project.id );
			filesRef.current = projectFiles.files;
			setFiles( projectFiles.files );
			setDirectories( projectFiles.directories );
			setValidationResult( null );
			setOpenTabs( ( currentTabs ) => {
				const nextTab: OpenFileTab = {
					path: result.path,
					savedContent: result.content,
					draftContent: result.content,
					fileKind: result.fileKind,
					mediaType: result.mediaType,
					dataUrl: result.dataUrl,
					editable: result.editable,
					previewable: result.previewable,
					mode: result.mode,
					isLoading: false,
				};
				const nextTabs = currentTabs.some( ( tab ) => tab.path === patch.path )
					? currentTabs.map( ( tab ) => ( tab.path === patch.path ? nextTab : tab ) )
					: [ ...currentTabs, nextTab ];
				openTabsRef.current = nextTabs;
				return nextTabs;
			} );
			selectedPathRef.current = patch.path;
			setSelectedPath( patch.path );
			updateReleaseReviewPatchWithContents( patch, patch.beforeContent ?? '', result.content );
			await refreshProject( project.id ).catch( () => undefined );
		} catch ( error ) {
			Sentry.captureException( error );
			setFileError( error instanceof Error ? error.message : String( error ) );
		} finally {
			setApplyingPatchId( null );
		}
	};

	const handleRejectPatchHunk = ( patch: AiPatchItem, hunkIndex: number ) => {
		if ( patch.source === 'release' ) {
			const hunk = getPatchHunks( patch )[ hunkIndex ];
			if ( hunk ) {
				void handleRevertReleasePatchHunk( patch, hunk );
			}
			return;
		}

		const remainingHunks = getPatchHunks( patch ).filter( ( _, index ) => index !== hunkIndex );
		if ( remainingHunks.length === 0 ) {
			handleRejectPatch( patch );
			return;
		}

		const beforeContent = patch.beforeContent ?? '';
		const nextAfterContent = applyDiffHunksToContent( beforeContent, remainingHunks );
		updatePatchWithRemainingHunks(
			patch,
			beforeContent,
			nextAfterContent,
			patch.status === 'deleted' ? 'modified' : patch.status
		);
		appendAiChatMessage(
			'assistant',
			sprintf(
				// translators: %s is a file path shown as inline markdown code.
				__( 'Rejected one proposed chunk in `%s`.' ),
				escapeMarkdownInlineCode( patch.path )
			)
		);
	};

	const handleIgnoreMenuAction = useCallback(
		async ( actionData: DevelopmentProjectContextMenuAction ) => {
			if ( actionData.projectId !== project.id ) {
				return;
			}

			const pattern =
				actionData.action === 'remove-ignore'
					? actionData.ignoredBy
					: getExplorerIgnorePattern( actionData.kind, actionData.path );

			if ( ! pattern ) {
				return;
			}

			setIsUpdatingIgnorePattern( true );
			setFileError( null );
			try {
				const result =
					actionData.action === 'remove-ignore'
						? await removeProjectIgnorePattern( project.id, pattern )
						: await addProjectIgnorePattern( project.id, pattern );
				setFiles( result.files );
				setDirectories( result.directories );
				await refreshProject( project.id ).catch( () => undefined );
			} catch ( error ) {
				Sentry.captureException( error );
				setFileError( error instanceof Error ? error.message : String( error ) );
			} finally {
				setIsUpdatingIgnorePattern( false );
			}
		},
		[ addProjectIgnorePattern, project.id, refreshProject, removeProjectIgnorePattern ]
	);

	const handleExplorerContextMenu = useCallback(
		( event: ReactMouseEvent, entry: FileTreeEntry ) => {
			event.preventDefault();
			if ( isUpdatingIgnorePattern ) {
				return;
			}

			getIpcApi().showDevelopmentProjectContextMenu( {
				projectId: project.id,
				path: entry.path,
				kind: entry.kind,
				ignored: entry.ignored,
				ignoredBy: entry.ignoredBy,
				x: event.clientX,
				y: event.clientY,
			} );
		},
		[ isUpdatingIgnorePattern, project.id ]
	);
	const toggleDirectoryExpansion = useCallback(
		( entry: Extract< FileTreeEntry, { kind: 'directory' } > ) => {
			setDirectoryExpansionOverrides( ( currentOverrides ) => {
				const isExpanded = currentOverrides[ entry.path ] ?? ! entry.ignored;
				return {
					...currentOverrides,
					[ entry.path ]: ! isExpanded,
				};
			} );
		},
		[]
	);

	const handleOpenFinding = async ( finding: DevelopmentProjectValidationFinding ) => {
		if ( ! finding.file ) {
			return;
		}
		const wasOpened = await openFileTab( finding.file );
		if ( ! wasOpened ) {
			return;
		}
		setRevealRequest( {
			path: finding.file,
			line: finding.line || 1,
			column: finding.column || 1,
		} );
	};

	useEffect( () => {
		let isCancelled = false;
		let timeoutId: ReturnType< typeof setTimeout > | undefined;
		const applyValidationState = ( state: DevelopmentProjectValidationState ) => {
			if ( state.status === 'idle' ) {
				setValidationResult( null );
				setIsValidatingProject( false );
				return;
			}

			setSidebarTab( 'releases' );

			if ( state.status === 'running' ) {
				setValidationResult( state.previousResult ?? null );
				setIsValidatingProject( true );
				setFileError( null );
				return;
			}

			if ( state.status === 'completed' ) {
				setValidationResult( state.result );
				setIsValidatingProject( false );
				setFileError( null );
				return;
			}

			setValidationResult( state.previousResult ?? null );
			setIsValidatingProject( false );
			setFileError( state.error );
		};

		const hydrateValidationState = async () => {
			try {
				const state = await getProjectValidationState( project.id );
				if ( isCancelled ) {
					return;
				}

				applyValidationState( state );
				if ( state.status === 'running' ) {
					timeoutId = setTimeout( hydrateValidationState, 1500 );
				}
			} catch ( error ) {
				if ( isCancelled ) {
					return;
				}
				Sentry.captureException( error );
				setIsValidatingProject( false );
				setFileError( error instanceof Error ? error.message : String( error ) );
			}
		};

		void hydrateValidationState();

		return () => {
			isCancelled = true;
			if ( timeoutId ) {
				clearTimeout( timeoutId );
			}
		};
	}, [ getProjectValidationState, project.id ] );

	const handleRunValidation = async () => {
		if ( isBlocked || isValidatingProject ) {
			return;
		}

		if ( hasUnsavedChanges ) {
			await handleSave();
		}

		setIsValidatingProject( true );
		setFileError( null );
		try {
			const result = await runProjectValidation( project.id );
			setValidationResult( result );
			setSidebarTab( 'releases' );
			const firstFileFinding = result.findings.find( ( finding ) => finding.file );
			if ( firstFileFinding ) {
				await handleOpenFinding( firstFileFinding );
			}
		} catch ( error ) {
			Sentry.captureException( error );
			setFileError( error instanceof Error ? error.message : String( error ) );
		} finally {
			setIsValidatingProject( false );
		}
	};

	useEffect( () => {
		const unsubscribe = window.ipcListener.subscribe(
			'development-project-ai-review-event',
			( _, payload ) => {
				if ( payload.projectId !== project.id ) {
					return;
				}
				handleAiReviewEvent( payload.event );
			}
		);

		return () => {
			unsubscribe?.();
		};
	}, [ handleAiReviewEvent, project.id ] );

	useEffect( () => {
		const unsubscribe = window.ipcListener.subscribe(
			'development-project-context-menu-action',
			( _, actionData ) => {
				void handleIgnoreMenuAction( actionData );
			}
		);

		return () => {
			unsubscribe?.();
		};
	}, [ handleIgnoreMenuAction ] );

	const renderAiSidebar = () => {
		return (
			<StudioCodeSidebar
				projectId={ project.id }
				messages={ aiChatMessages }
				examples={ aiChatExamples }
				isRunning={ isRunningAiReview }
				error={ fileError }
				statusMessage={ aiStatusMessage }
				hasUnsavedChanges={ hasUnsavedChanges }
				isBlocked={ isBlocked }
				patches={ aiPatches }
				selectedPatch={ selectedFilePatch }
				onSend={ handleRunAiReview }
				onClearConversation={ handleClearAiChat }
				onSelectPatch={ ( patchId ) => void handleSelectPatch( patchId ) }
			/>
		);
	};

	const renderReviewSidebar = () => {
		return (
			<ReleaseReviewSidebar
				patches={ reviewPatches }
				selectedPatch={ selectedPatch }
				selectedPatchHunks={ selectedPatchHunks }
				reviewLabel={ selectedPatch?.source === 'release' ? releaseReviewLabel : null }
				applyingPatchId={ applyingPatchId }
				onSelectPatch={ ( patchId ) => void handleSelectPatch( patchId ) }
				onAcceptPatch={ ( patch ) => void handleAcceptPatch( patch ) }
				onRejectPatch={ handleRejectPatch }
				onAcceptPatchHunk={ ( patch, hunk, hunkIndex ) =>
					void handleAcceptPatchHunk( patch, hunk, hunkIndex )
				}
				onRejectPatchHunk={ handleRejectPatchHunk }
				onKeepAll={ () => {
					setReleaseReviewPatches( [] );
					setReleaseReviewLabel( null );
					setSelectedPatchId( null );
					setSidebarTab( 'releases' );
				} }
			/>
		);
	};

	return (
		<div className={ cx( workbenchStyles.workbench, 'app-no-drag-region' ) }>
			<ProjectWorkbenchTitlebar
				project={ project }
				selectedPath={ selectedPath }
				openButtons={ openButtons }
				isRefreshing={ isRefreshing }
				onRefresh={ () => void onRefresh() }
				onRemove={ () => void onRemove() }
			/>

			<div ref={ workbenchMainRef } className={ workbenchStyles.main } style={ workbenchMainStyle }>
				<WorkbenchActivityBar
					sidebarTab={ sidebarTab }
					reviewPatchCount={ reviewPatches.length }
					onSelectSidebarTab={ setSidebarTab }
				/>

				<FileExplorer
					fileEntries={ fileEntries }
					visibleFileEntries={ visibleFileEntries }
					isLoadingFiles={ isLoadingFiles }
					selectedPath={ selectedPath }
					directoryExpansionOverrides={ directoryExpansionOverrides }
					explorerValidationSummaries={ explorerValidationSummaries }
					resizingColumn={ resizingColumn }
					onSelectFile={ ( filePath ) => void handleSelectFile( filePath ) }
					onToggleDirectoryExpansion={ toggleDirectoryExpansion }
					onContextMenu={ handleExplorerContextMenu }
					onResizePointerDown={ handleColumnResizePointerDown }
					onResizeKeyDown={ handleColumnResizeKeyDown }
					onResetExplorerWidth={ () => resizeExplorer( EXPLORER_DEFAULT_WIDTH ) }
				/>

				<ProjectEditorPanel
					isBlocked={ isBlocked }
					projectError={ project.error }
					isLoadingFiles={ isLoadingFiles }
					fileError={ fileError }
					files={ files }
					openTabs={ openTabs }
					selectedPath={ selectedPath }
					selectedTab={ selectedTab }
					selectedFile={ selectedFile }
					selectedFilePatchHunks={ selectedFilePatchHunks }
					selectedFilePatchSide={ selectedFilePatchSide }
					selectedFileFindings={ selectedFileFindings }
					preferredProjectFile={ preferredProjectFile }
					revealRequest={ revealRequest }
					isLoadingFile={ isLoadingFile }
					hasUnsavedChanges={ hasUnsavedChanges }
					isSaving={ isSaving }
					selectedTabCanEdit={ selectedTabCanEdit }
					selectedTabCanPreview={ selectedTabCanPreview }
					activeDraftContent={ activeDraftContent }
					editorTabsListRef={ editorTabsListRef }
					setEditorTabRef={ setEditorTabRef }
					setEditorTabButtonRef={ setEditorTabButtonRef }
					validationResult={ validationResult }
					isValidatingProject={ isValidatingProject }
					onSelectOpenTab={ handleSelectOpenTab }
					onCloseFileTab={ ( filePath ) => void closeFileTab( filePath ) }
					onOpenFileTab={ ( filePath ) => void openFileTab( filePath ) }
					onSelectFileMode={ handleSelectFileMode }
					onUpdateOpenTab={ updateOpenTab }
					onSave={ () => void handleSave() }
					onRunValidation={ () => void handleRunValidation() }
					onOpenFinding={ ( finding ) => void handleOpenFinding( finding ) }
				/>

				<WorkbenchSidebar
					sidebarTab={ sidebarTab }
					reviewPatchCount={ reviewPatches.length }
					resizingColumn={ resizingColumn }
					onSelectSidebarTab={ setSidebarTab }
					onResizePointerDown={ handleColumnResizePointerDown }
					onResizeKeyDown={ handleColumnResizeKeyDown }
					onResetSidebarWidth={ () => resizeSidebar( SIDEBAR_DEFAULT_WIDTH ) }
				>
					{ sidebarTab === 'ai' && renderAiSidebar() }
					{ sidebarTab === 'review' && renderReviewSidebar() }
					{ sidebarTab === 'releases' && (
						<ReleaseSidebar
							project={ project }
							isBlocked={ isBlocked }
							validationResult={ validationResult }
							isValidatingProject={ isValidatingProject }
							isRunningAiReview={ isRunningAiReview }
							hasUnsavedChanges={ hasUnsavedChanges }
							onRunValidation={ () => void handleRunValidation() }
							onFixPluginCheck={ () => void handleFixPluginCheck() }
							onSwitchReleaseTag={ handleSwitchReleaseTag }
							onReleaseRefSwitched={ handleProjectReleaseRefSwitched }
						/>
					) }
				</WorkbenchSidebar>
			</div>
		</div>
	);
}
