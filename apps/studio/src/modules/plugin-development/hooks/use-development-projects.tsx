import {
	createContext,
	ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useGetPluginDevelopmentEnabledQuery } from 'src/stores/installed-apps-api';
import type {
	DevelopmentProject,
	DevelopmentProjectAiPatch,
	DevelopmentProjectAiPatchResult,
	DevelopmentProjectAiReviewOptions,
	DevelopmentProjectAiReviewResult,
	DevelopmentProjectChatMessage,
	DevelopmentProjectChatState,
	DevelopmentProjectFileContent,
	DevelopmentProjectFilesResult,
	DevelopmentProjectPlaygroundOptions,
	DevelopmentProjectPlaygroundResult,
	DevelopmentProjectReleaseTagList,
	DevelopmentProjectReleaseTagSwitchResult,
	DevelopmentProjectValidationResult,
	DevelopmentProjectValidationState,
	DevelopmentProjectVersionBump,
	DevelopmentProjectVersionState,
	RemoteDevelopmentPlugin,
} from '@studio/common/types/publishing';

interface DevelopmentProjectsContext {
	projects: DevelopmentProject[];
	remotePlugins: RemoteDevelopmentPlugin[];
	loadingProjects: boolean;
	loadingRemotePlugins: boolean;
	isPluginDevelopmentEnabled: boolean;
	loadingPluginDevelopmentEnabled: boolean;
	selectedProject: DevelopmentProject | null;
	selectedProjectId: string | null;
	selectedRemotePlugin: RemoteDevelopmentPlugin | null;
	selectedRemotePluginSlug: string | null;
	remotePluginsError: string | null;
	remotePluginsUsername: string | null;
	cloningRemotePluginSlug: string | null;
	startingPlaygroundProjectId: string | null;
	selectProject: ( projectId: string | null ) => void;
	selectRemotePlugin: ( slug: string | null ) => void;
	reloadProjects: () => Promise< void >;
	reloadRemotePlugins: () => Promise< void >;
	addProject: ( projectPath: string ) => Promise< DevelopmentProject >;
	removeProject: ( projectId: string ) => Promise< void >;
	refreshProject: ( projectId: string ) => Promise< DevelopmentProject >;
	cloneRemotePlugin: ( slug: string ) => Promise< DevelopmentProject >;
	getProjectVersionState: ( projectId: string ) => Promise< DevelopmentProjectVersionState >;
	listProjectFiles: ( projectId: string ) => Promise< DevelopmentProjectFilesResult >;
	addProjectIgnorePattern: (
		projectId: string,
		pattern: string
	) => Promise< DevelopmentProjectFilesResult >;
	removeProjectIgnorePattern: (
		projectId: string,
		pattern: string
	) => Promise< DevelopmentProjectFilesResult >;
	readProjectFile: (
		projectId: string,
		relativePath: string
	) => Promise< DevelopmentProjectFileContent >;
	writeProjectFile: (
		projectId: string,
		relativePath: string,
		content: string
	) => Promise< DevelopmentProjectFileContent >;
	applyAiPatch: (
		projectId: string,
		patch: DevelopmentProjectAiPatch
	) => Promise< DevelopmentProjectAiPatchResult >;
	runAiReview: (
		projectId: string,
		options: DevelopmentProjectAiReviewOptions
	) => Promise< DevelopmentProjectAiReviewResult >;
	loadProjectChat: ( projectId: string ) => Promise< DevelopmentProjectChatState >;
	saveProjectChat: (
		projectId: string,
		messages: DevelopmentProjectChatMessage[]
	) => Promise< DevelopmentProjectChatState >;
	runProjectValidation: ( projectId: string ) => Promise< DevelopmentProjectValidationResult >;
	getProjectValidationState: ( projectId: string ) => Promise< DevelopmentProjectValidationState >;
	bumpProjectVersion: (
		projectId: string,
		bump: DevelopmentProjectVersionBump
	) => Promise< DevelopmentProjectVersionState >;
	listProjectReleaseTags: ( projectId: string ) => Promise< DevelopmentProjectReleaseTagList >;
	switchProjectReleaseTag: (
		projectId: string,
		tagName: string
	) => Promise< DevelopmentProjectReleaseTagSwitchResult >;
	startProjectPlayground: (
		projectId: string,
		options?: DevelopmentProjectPlaygroundOptions
	) => Promise< DevelopmentProjectPlaygroundResult >;
}

const defaultContext: DevelopmentProjectsContext = {
	projects: [],
	remotePlugins: [],
	loadingProjects: true,
	loadingRemotePlugins: true,
	isPluginDevelopmentEnabled: false,
	loadingPluginDevelopmentEnabled: true,
	selectedProject: null,
	selectedProjectId: null,
	selectedRemotePlugin: null,
	selectedRemotePluginSlug: null,
	remotePluginsError: null,
	remotePluginsUsername: null,
	cloningRemotePluginSlug: null,
	startingPlaygroundProjectId: null,
	selectProject: () => undefined,
	selectRemotePlugin: () => undefined,
	reloadProjects: async () => undefined,
	reloadRemotePlugins: async () => undefined,
	addProject: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	removeProject: async () => undefined,
	refreshProject: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	cloneRemotePlugin: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	getProjectVersionState: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	listProjectFiles: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	addProjectIgnorePattern: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	removeProjectIgnorePattern: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	readProjectFile: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	writeProjectFile: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	applyAiPatch: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	runAiReview: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	loadProjectChat: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	saveProjectChat: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	runProjectValidation: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	getProjectValidationState: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	bumpProjectVersion: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	listProjectReleaseTags: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	switchProjectReleaseTag: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
	startProjectPlayground: async () => {
		throw new Error( 'DevelopmentProjectsProvider is not mounted.' );
	},
};

const SELECTED_PROJECT_ID_KEY = 'selectedDevelopmentProjectId';
const SELECTED_REMOTE_PLUGIN_SLUG_KEY = 'selectedRemoteDevelopmentPluginSlug';
const developmentProjectsContext = createContext< DevelopmentProjectsContext >( defaultContext );

export function useDevelopmentProjects() {
	const context = useContext( developmentProjectsContext );
	if ( ! context ) {
		throw new Error( 'useDevelopmentProjects must be used within a DevelopmentProjectsProvider' );
	}
	return context;
}

export function DevelopmentProjectsProvider( { children }: { children?: ReactNode } ) {
	const { Provider } = developmentProjectsContext;
	const { data: pluginDevelopmentEnabled, isLoading: loadingPluginDevelopmentEnabled } =
		useGetPluginDevelopmentEnabledQuery();
	const isPluginDevelopmentEnabled = pluginDevelopmentEnabled ?? false;
	const [ projects, setProjects ] = useState< DevelopmentProject[] >( [] );
	const [ remotePlugins, setRemotePlugins ] = useState< RemoteDevelopmentPlugin[] >( [] );
	const [ loadingProjects, setLoadingProjects ] = useState( true );
	const [ loadingRemotePlugins, setLoadingRemotePlugins ] = useState( true );
	const [ remotePluginsError, setRemotePluginsError ] = useState< string | null >( null );
	const [ remotePluginsUsername, setRemotePluginsUsername ] = useState< string | null >( null );
	const [ cloningRemotePluginSlug, setCloningRemotePluginSlug ] = useState< string | null >( null );
	const [ startingPlaygroundProjectId, setStartingPlaygroundProjectId ] = useState< string | null >(
		null
	);
	const [ selectedProjectId, setSelectedProjectId ] = useState< string | null >(
		localStorage.getItem( SELECTED_PROJECT_ID_KEY )
	);
	const [ selectedRemotePluginSlug, setSelectedRemotePluginSlug ] = useState< string | null >(
		localStorage.getItem( SELECTED_REMOTE_PLUGIN_SLUG_KEY )
	);

	const selectProject = useCallback( ( projectId: string | null ) => {
		setSelectedProjectId( projectId );
		setSelectedRemotePluginSlug( null );
		if ( projectId ) {
			localStorage.setItem( SELECTED_PROJECT_ID_KEY, projectId );
		} else {
			localStorage.removeItem( SELECTED_PROJECT_ID_KEY );
		}
		localStorage.removeItem( SELECTED_REMOTE_PLUGIN_SLUG_KEY );
	}, [] );

	const selectRemotePlugin = useCallback( ( slug: string | null ) => {
		setSelectedRemotePluginSlug( slug );
		setSelectedProjectId( null );
		if ( slug ) {
			localStorage.setItem( SELECTED_REMOTE_PLUGIN_SLUG_KEY, slug );
		} else {
			localStorage.removeItem( SELECTED_REMOTE_PLUGIN_SLUG_KEY );
		}
		localStorage.removeItem( SELECTED_PROJECT_ID_KEY );
	}, [] );

	const reloadRemotePlugins = useCallback( async () => {
		if ( ! isPluginDevelopmentEnabled ) {
			setRemotePlugins( [] );
			setRemotePluginsUsername( null );
			setRemotePluginsError( null );
			setLoadingRemotePlugins( false );
			return;
		}

		setLoadingRemotePlugins( true );
		setRemotePluginsError( null );
		try {
			const result = await getIpcApi().listRemoteDevelopmentPlugins();
			setRemotePlugins( result.plugins );
			setRemotePluginsUsername( result.username ?? null );
		} catch ( error ) {
			setRemotePlugins( [] );
			setRemotePluginsUsername( null );
			setRemotePluginsError( error instanceof Error ? error.message : String( error ) );
		} finally {
			setLoadingRemotePlugins( false );
		}
	}, [ isPluginDevelopmentEnabled ] );

	const reloadProjects = useCallback( async () => {
		if ( ! isPluginDevelopmentEnabled ) {
			setProjects( [] );
			setLoadingProjects( false );
			await reloadRemotePlugins();
			return;
		}

		setLoadingProjects( true );
		try {
			setProjects( await getIpcApi().listDevelopmentProjects() );
		} finally {
			setLoadingProjects( false );
		}
		await reloadRemotePlugins();
	}, [ isPluginDevelopmentEnabled, reloadRemotePlugins ] );

	useEffect( () => {
		void reloadProjects();
	}, [ reloadProjects ] );

	useEffect( () => {
		if (
			isPluginDevelopmentEnabled &&
			selectedProjectId &&
			! projects.some( ( project ) => project.id === selectedProjectId )
		) {
			selectProject( null );
		}
	}, [ isPluginDevelopmentEnabled, projects, selectProject, selectedProjectId ] );

	useEffect( () => {
		if ( ! isPluginDevelopmentEnabled || ! selectedRemotePluginSlug || loadingRemotePlugins ) {
			return;
		}

		const remotePlugin = remotePlugins.find(
			( plugin ) => plugin.slug === selectedRemotePluginSlug
		);
		if ( ! remotePlugin ) {
			selectRemotePlugin( null );
			return;
		}

		if ( remotePlugin.localProjectId ) {
			selectProject( remotePlugin.localProjectId );
		}
	}, [
		isPluginDevelopmentEnabled,
		loadingRemotePlugins,
		remotePlugins,
		selectProject,
		selectRemotePlugin,
		selectedRemotePluginSlug,
	] );

	const addProject = useCallback(
		async ( projectPath: string ) => {
			const project = await getIpcApi().addDevelopmentProject( projectPath );
			setProjects( await getIpcApi().listDevelopmentProjects() );
			await reloadRemotePlugins();
			selectProject( project.id );
			return project;
		},
		[ reloadRemotePlugins, selectProject ]
	);

	const removeProject = useCallback(
		async ( projectId: string ) => {
			const updatedProjects = await getIpcApi().removeDevelopmentProject( projectId );
			setProjects( updatedProjects );
			await reloadRemotePlugins();
			if ( selectedProjectId === projectId ) {
				selectProject( null );
			}
		},
		[ reloadRemotePlugins, selectProject, selectedProjectId ]
	);

	const refreshProject = useCallback(
		async ( projectId: string ) => {
			const refreshedProject = await getIpcApi().refreshDevelopmentProject( projectId );
			setProjects( ( currentProjects ) =>
				currentProjects.map( ( project ) =>
					project.id === refreshedProject.id ? refreshedProject : project
				)
			);
			await reloadRemotePlugins();
			return refreshedProject;
		},
		[ reloadRemotePlugins ]
	);

	const cloneRemotePlugin = useCallback(
		async ( slug: string ) => {
			setCloningRemotePluginSlug( slug );
			try {
				const project = await getIpcApi().cloneRemoteDevelopmentPlugin( slug );
				setProjects( await getIpcApi().listDevelopmentProjects() );
				await reloadRemotePlugins();
				selectProject( project.id );
				return project;
			} finally {
				setCloningRemotePluginSlug( null );
			}
		},
		[ reloadRemotePlugins, selectProject ]
	);

	const getProjectVersionState = useCallback( async ( projectId: string ) => {
		return getIpcApi().getDevelopmentProjectVersionState( projectId );
	}, [] );

	const listProjectFiles = useCallback( async ( projectId: string ) => {
		return getIpcApi().listDevelopmentProjectFiles( projectId );
	}, [] );

	const addProjectIgnorePattern = useCallback( async ( projectId: string, pattern: string ) => {
		return getIpcApi().addDevelopmentProjectIgnorePattern( projectId, pattern );
	}, [] );

	const removeProjectIgnorePattern = useCallback( async ( projectId: string, pattern: string ) => {
		return getIpcApi().removeDevelopmentProjectIgnorePattern( projectId, pattern );
	}, [] );

	const readProjectFile = useCallback( async ( projectId: string, relativePath: string ) => {
		return getIpcApi().readDevelopmentProjectFile( projectId, relativePath );
	}, [] );

	const writeProjectFile = useCallback(
		async ( projectId: string, relativePath: string, content: string ) => {
			return getIpcApi().writeDevelopmentProjectFile( projectId, relativePath, content );
		},
		[]
	);

	const applyAiPatch = useCallback(
		async ( projectId: string, patch: DevelopmentProjectAiPatch ) => {
			return getIpcApi().applyDevelopmentProjectAiPatch( projectId, patch );
		},
		[]
	);

	const runAiReview = useCallback(
		async ( projectId: string, options: DevelopmentProjectAiReviewOptions ) => {
			return getIpcApi().runDevelopmentProjectAiReview( projectId, options );
		},
		[]
	);

	const loadProjectChat = useCallback( async ( projectId: string ) => {
		return getIpcApi().loadDevelopmentProjectChat( projectId );
	}, [] );

	const saveProjectChat = useCallback(
		async ( projectId: string, messages: DevelopmentProjectChatMessage[] ) => {
			return getIpcApi().saveDevelopmentProjectChat( projectId, messages );
		},
		[]
	);

	const runProjectValidation = useCallback( async ( projectId: string ) => {
		return getIpcApi().runDevelopmentProjectValidation( projectId );
	}, [] );

	const getProjectValidationState = useCallback( async ( projectId: string ) => {
		return getIpcApi().getDevelopmentProjectValidationState( projectId );
	}, [] );

	const bumpProjectVersion = useCallback(
		async ( projectId: string, bump: DevelopmentProjectVersionBump ) => {
			const result = await getIpcApi().bumpDevelopmentProjectVersion( projectId, bump );
			setProjects( ( currentProjects ) =>
				currentProjects.map( ( project ) =>
					project.id === result.project.id ? result.project : project
				)
			);
			await reloadRemotePlugins();
			return result.versionState;
		},
		[ reloadRemotePlugins ]
	);

	const listProjectReleaseTags = useCallback( async ( projectId: string ) => {
		return getIpcApi().listDevelopmentProjectReleaseTags( projectId );
	}, [] );

	const switchProjectReleaseTag = useCallback(
		async ( projectId: string, tagName: string ) => {
			const result = await getIpcApi().switchDevelopmentProjectReleaseTag( projectId, tagName );
			setProjects( ( currentProjects ) =>
				currentProjects.map( ( project ) =>
					project.id === result.project.id ? result.project : project
				)
			);
			await reloadRemotePlugins();
			return result;
		},
		[ reloadRemotePlugins ]
	);

	const startProjectPlayground = useCallback(
		async ( projectId: string, options: DevelopmentProjectPlaygroundOptions = {} ) => {
			setStartingPlaygroundProjectId( projectId );
			try {
				const result = await getIpcApi().startDevelopmentProjectPlayground( projectId, options );
				setProjects( ( currentProjects ) =>
					currentProjects.map( ( project ) =>
						project.id === result.project.id ? result.project : project
					)
				);
				return result;
			} finally {
				setStartingPlaygroundProjectId( null );
			}
		},
		[]
	);

	const visibleProjects = useMemo(
		() => ( isPluginDevelopmentEnabled ? projects : [] ),
		[ isPluginDevelopmentEnabled, projects ]
	);
	const visibleRemotePlugins = useMemo(
		() => ( isPluginDevelopmentEnabled ? remotePlugins : [] ),
		[ isPluginDevelopmentEnabled, remotePlugins ]
	);
	const visibleSelectedProjectId = isPluginDevelopmentEnabled ? selectedProjectId : null;
	const visibleSelectedRemotePluginSlug = isPluginDevelopmentEnabled
		? selectedRemotePluginSlug
		: null;
	const selectedProject =
		visibleProjects.find( ( project ) => project.id === visibleSelectedProjectId ) || null;
	const selectedRemotePlugin =
		visibleRemotePlugins.find( ( plugin ) => plugin.slug === visibleSelectedRemotePluginSlug ) ||
		null;
	const isLoadingProjects =
		loadingPluginDevelopmentEnabled || ( isPluginDevelopmentEnabled && loadingProjects );
	const isLoadingRemotePlugins =
		loadingPluginDevelopmentEnabled || ( isPluginDevelopmentEnabled && loadingRemotePlugins );

	const context = useMemo(
		() => ( {
			projects: visibleProjects,
			remotePlugins: visibleRemotePlugins,
			loadingProjects: isLoadingProjects,
			loadingRemotePlugins: isLoadingRemotePlugins,
			isPluginDevelopmentEnabled,
			loadingPluginDevelopmentEnabled,
			selectedProject,
			selectedProjectId: visibleSelectedProjectId,
			selectedRemotePlugin,
			selectedRemotePluginSlug: visibleSelectedRemotePluginSlug,
			remotePluginsError,
			remotePluginsUsername,
			cloningRemotePluginSlug,
			startingPlaygroundProjectId,
			selectProject,
			selectRemotePlugin,
			reloadProjects,
			reloadRemotePlugins,
			addProject,
			removeProject,
			refreshProject,
			cloneRemotePlugin,
			getProjectVersionState,
			listProjectFiles,
			addProjectIgnorePattern,
			removeProjectIgnorePattern,
			readProjectFile,
			writeProjectFile,
			applyAiPatch,
			runAiReview,
			loadProjectChat,
			saveProjectChat,
			runProjectValidation,
			getProjectValidationState,
			bumpProjectVersion,
			listProjectReleaseTags,
			switchProjectReleaseTag,
			startProjectPlayground,
		} ),
		[
			visibleProjects,
			visibleRemotePlugins,
			isLoadingProjects,
			isLoadingRemotePlugins,
			isPluginDevelopmentEnabled,
			loadingPluginDevelopmentEnabled,
			selectedProject,
			visibleSelectedProjectId,
			selectedRemotePlugin,
			visibleSelectedRemotePluginSlug,
			remotePluginsError,
			remotePluginsUsername,
			cloningRemotePluginSlug,
			startingPlaygroundProjectId,
			selectProject,
			selectRemotePlugin,
			reloadProjects,
			reloadRemotePlugins,
			addProject,
			removeProject,
			refreshProject,
			cloneRemotePlugin,
			getProjectVersionState,
			listProjectFiles,
			addProjectIgnorePattern,
			removeProjectIgnorePattern,
			readProjectFile,
			writeProjectFile,
			applyAiPatch,
			runAiReview,
			loadProjectChat,
			saveProjectChat,
			runProjectValidation,
			getProjectValidationState,
			bumpProjectVersion,
			listProjectReleaseTags,
			switchProjectReleaseTag,
			startProjectPlayground,
		]
	);

	return <Provider value={ context }>{ children }</Provider>;
}
