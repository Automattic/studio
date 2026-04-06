import * as Sentry from '@sentry/electron/renderer';
import { __ } from '@wordpress/i18n';
import { cloudUpload } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useMemo } from 'react';
import { ButtonsSection, ButtonsSectionProps } from 'src/components/buttons-section';
import { TaskChatInput } from 'src/components/new-ui/tasks/task-chat-input';
import {
	FinderIcon,
	PhpMyAdminIcon,
	TerminalIcon,
	editorIcons,
	terminalIcons,
} from 'src/components/shortcut-icons';
import { useAuth } from 'src/hooks/use-auth';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isWindows } from 'src/lib/app-globals';
import { generateCheckoutUrl } from 'src/lib/generate-checkout-url';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ConnectButton } from 'src/modules/sync/components/connect-button';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';
import { syncOperationsSelectors } from 'src/stores/sync';
import { useGetConnectedSitesForLocalSiteQuery } from 'src/stores/sync/connected-sites';
import { createNewTask, setSelectedTaskId, enqueueMessage } from 'src/stores/tasks-slice';

interface ContentTabOverviewProps {
	selectedSite: SiteDetails;
}

function ShortcutsSection( { selectedSite }: Pick< ContentTabOverviewProps, 'selectedSite' > ) {
	const { data: editor } = useGetUserEditorQuery( undefined, { refetchOnMountOrArgChange: true } );
	const { data: terminal } = useGetUserTerminalQuery( undefined, {
		refetchOnMountOrArgChange: true,
	} );
	const { startServer, loadingServer } = useSiteDetails();
	const isServerLoading = loadingServer[ selectedSite.id ];

	const buttonsArray: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: isWindows()
				? // translators: name of app used to navigate files and folders on Windows
				  __( 'File Explorer' )
				: // translators: name of app used to navigate files and folders on macOS
				  __( 'Finder' ),
			icon: <FinderIcon />,
			onClick: () => {
				getIpcApi().openLocalPath( selectedSite.path );
			},
		},
	];

	const editorConfig = editor ? supportedEditorConfig[ editor ] : false;
	if ( editor && editorConfig ) {
		const EditorIcon = editorIcons[ editor ];
		buttonsArray.push( {
			label: editorConfig.label,
			icon: EditorIcon ? <EditorIcon /> : <FinderIcon />,
			onClick: async () => {
				await getIpcApi().openAppAtPath( editor, selectedSite.path );
			},
		} );
	}

	const TermIcon = terminal ? terminalIcons[ terminal ] : null;
	const terminalName = getTerminalName( terminal );
	buttonsArray.push( {
		label: terminalName,
		icon: TermIcon ? <TermIcon /> : <TerminalIcon />,
		onClick: async () => {
			try {
				await getIpcApi().openTerminalAtPath( selectedSite.path );
			} catch ( error ) {
				Sentry.captureException( error );
				alert( __( 'Could not open the terminal.' ) );
			}
		},
	} );

	buttonsArray.push( {
		label: __( 'phpMyAdmin' ),
		icon: <PhpMyAdminIcon />,
		disabled: isServerLoading,
		onClick: async () => {
			if ( ! selectedSite.running ) {
				await startServer( selectedSite );
			}
			const siteUrl =
				( selectedSite.running ? selectedSite.url : undefined ) ??
				`http://localhost:${ selectedSite.port }`;
			const phpMyAdminPath = '/phpmyadmin/index.php?route=/database/structure&db=wordpress';
			const targetUrl = new URL( phpMyAdminPath, siteUrl ).toString();
			const autoLoginUrl = new URL( '/studio-auto-login', siteUrl );
			autoLoginUrl.searchParams.append( 'redirect_to', targetUrl );
			window.dispatchEvent(
				new CustomEvent( 'studio:browser-open-tab', {
					detail: { siteId: selectedSite.id, url: autoLoginUrl.toString() },
				} )
			);
		},
	} );

	return <ButtonsSection buttonsArray={ buttonsArray } title={ __( 'Open in…' ) } />;
}

function PublishSection( { selectedSite }: Pick< ContentTabOverviewProps, 'selectedSite' > ) {
	const { __ } = useI18n();
	const { user } = useAuth();
	const { data: connectedSites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite.id,
		userId: user?.id,
	} );
	const isAnySitePulling = useRootSelector( syncOperationsSelectors.selectIsAnySitePulling );
	const isAnySitePushing = useRootSelector( syncOperationsSelectors.selectIsAnySitePushing );
	const isAnySiteSyncing = isAnySitePulling || isAnySitePushing;

	const handlePublishClick = useCallback( () => {
		getIpcApi().openURL(
			generateCheckoutUrl( selectedSite, 'publish-site', { autoOpenPush: true } )
		);
	}, [ selectedSite ] );

	if ( connectedSites.length !== 0 ) return null;

	return (
		<div className="w-full">
			<h2 className="a8c-subtitle-small mb-1">{ __( 'Publish' ) }</h2>
			<p className="text-frame-text-secondary text-[13px] leading-[140%] mb-3">
				{ __( 'Make your site live on WordPress.com with a custom domain.' ) }
			</p>
			<ConnectButton
				variant="primary"
				icon={ cloudUpload }
				connectSite={ handlePublishClick }
				disabled={ isAnySiteSyncing }
				tooltipText={
					isAnySiteSyncing
						? __(
								'Another site is syncing. Please wait for the sync to finish before you publish your site.'
						  )
						: __( 'Publishing your site requires an internet connection.' )
				}
			>
				{ __( 'Publish site' ) }
			</ConnectButton>
			<p className="text-frame-text-secondary text-[12px] leading-[140%] mt-2">
				{ __( 'Opens WordPress.com in your browser to complete setup.' ) }
			</p>
		</div>
	);
}

function timeSince( timestamp: number ): string {
	const seconds = Math.floor( ( Date.now() - timestamp ) / 1000 );
	if ( seconds < 60 ) return __( 'just now' );
	const minutes = Math.floor( seconds / 60 );
	if ( minutes < 60 ) return `${ minutes }m`;
	const hours = Math.floor( minutes / 60 );
	if ( hours < 24 ) return `${ hours }h`;
	const days = Math.floor( hours / 24 );
	return `${ days }d`;
}

function TasksSection( { selectedSite }: Pick< ContentTabOverviewProps, 'selectedSite' > ) {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const { tasks } = useRootSelector( ( state ) => state.tasks );

	const siteTasks = useMemo(
		() =>
			tasks
				.filter( ( t ) => t.siteId === selectedSite.id && ! t.archived )
				.sort( ( a, b ) => b.updatedAt - a.updatedAt ),
		[ tasks, selectedSite.id ]
	);

	const handleNewTask = useCallback(
		async ( text: string ) => {
			const task = await dispatch( createNewTask( selectedSite.id ) ).unwrap();
			dispatch(
				enqueueMessage( {
					taskId: task.id,
					message: { id: crypto.randomUUID(), text },
				} )
			);
		},
		[ selectedSite.id, dispatch ]
	);

	return (
		<div className="w-full">
			<h2 className="a8c-subtitle-small mb-3">{ __( 'Tasks' ) }</h2>
			<TaskChatInput
				onSubmit={ handleNewTask }
				placeholder={ __( 'Ask anything…' ) }
				className="!p-0 mb-3"
			/>
			{ siteTasks.length > 0 && (
				<div className="flex flex-col">
					{ siteTasks.map( ( task ) => (
						<button
							key={ task.id }
							onClick={ () => dispatch( setSelectedTaskId( task.id ) ) }
							className="flex items-baseline gap-2 py-1.5 text-left transition-colors text-frame-text hover:text-frame-theme"
						>
							<span className="text-sm truncate">{ task.title }</span>
							{ task.status === 'in-progress' ? (
								<span className="w-1.5 h-1.5 rounded-full bg-[#4f94f8] animate-pulse flex-shrink-0 self-center" />
							) : (
								<span className="text-xs text-frame-text-secondary flex-shrink-0">
									{ timeSince( task.updatedAt ) }
								</span>
							) }
						</button>
					) ) }
				</div>
			) }
		</div>
	);
}

export function ContentTabOverview( { selectedSite }: ContentTabOverviewProps ) {
	return (
		<div className="p-8 flex flex-col gap-8 max-w-4xl">
			<PublishSection selectedSite={ selectedSite } />
			<ShortcutsSection selectedSite={ selectedSite } />
			<TasksSection selectedSite={ selectedSite } />
		</div>
	);
}
