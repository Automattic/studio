import * as Sentry from '@sentry/electron/renderer';
import { speak } from '@wordpress/a11y';
import { Spinner } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect } from 'react';
import { Tooltip } from 'src/components/tooltip';
import { useSyncSites } from 'src/hooks/sync-sites';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useDeleteSite } from 'src/hooks/use-delete-site';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { isMac, isWindows } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';

interface SiteMenuProps {
	className?: string;
}

function ButtonToRun( { running, id, name }: Pick< SiteDetails, 'running' | 'id' | 'name' > ) {
	const { startServer, stopServer, loadingServer } = useSiteDetails();
	const siteStartedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site started.' ),
		name
	);
	const siteStoppedMessage = sprintf(
		// translators: %s is the site name.
		__( '%s site stopped.' ),
		name
	);

	useEffect( () => {
		speak( running ? siteStartedMessage : siteStoppedMessage );
	}, [ running, siteStartedMessage, siteStoppedMessage ] );

	const classCircle = `rounded-full`;
	const triangle = (
		<svg
			width="8"
			height="10"
			viewBox="0 0 8 10"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="rtl:scale-x-[-1]"
		>
			<path
				d="M0.25 0.854923C0.25 0.663717 0.455914 0.543288 0.622565 0.63703L7.17821 4.32458C7.33948 4.41529 7.34975 4.64367 7.19728 4.74849L0.641632 9.2555C0.475757 9.36953 0.25 9.25078 0.25 9.04949V0.854923Z"
				fill="#1ED15A"
				stroke="#00BA37"
				strokeWidth="0.5"
			/>
		</svg>
	);

	const rectangle = (
		<svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path
				d="M0.25 2C0.25 1.0335 1.0335 0.25 2 0.25H8C8.9665 0.25 9.75 1.0335 9.75 2V8C9.75 8.9665 8.9665 9.75 8 9.75H2C1.0335 9.75 0.25 8.9665 0.25 8V2Z"
				fill="#FF8085"
				stroke="#F86368"
				strokeWidth="0.5"
			/>
		</svg>
	);

	const tooltipText = loadingServer[ id ]
		? __( 'Starting' )
		: running
		? __( 'Stop site' )
		: __( 'Start site' );

	return (
		<Tooltip text={ tooltipText }>
			<button
				aria-disabled={ loadingServer[ id ] }
				onClick={ () => {
					if ( loadingServer[ id ] ) {
						return;
					}
					return running ? stopServer( id ) : startServer( id );
				} }
				className="w-7 h-8 rounded-tr rounded-br group grid focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-a8c-blue-50"
				aria-label={ sprintf( running ? __( 'stop %s site' ) : __( 'start %s site' ), name ) }
			>
				{ /* Circle */ }
				<div
					className={ cx(
						'w-2.5 h-2.5 transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0 border-[0.5px]',
						'row-start-1 col-start-1 place-self-center',
						classCircle,
						loadingServer[ id ] && 'animate-pulse border-[#00BA3775] bg-[#1ED15A75] duration-100',
						running && 'border-[#00BA37] bg-[#1ED15A] duration-100',
						! running && ! loadingServer[ id ] && 'border-[#ffffff19] bg-[#ffffff26]'
					) }
				>
					&nbsp;
				</div>
				{ /* Shapes on hover */ }
				{ ! loadingServer[ id ] && (
					<div
						className={ cx(
							'opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
							'row-start-1 col-start-1 place-self-center'
						) }
					>
						{ running ? rectangle : triangle }
					</div>
				) }
			</button>
		</Tooltip>
	);
}
function SiteItem( { site }: { site: SiteDetails } ) {
	const { selectedSite, setSelectedSiteId, loadingServer, isSiteDeleting } = useSiteDetails();
	const isSelected = site === selectedSite;
	const { isSiteImporting, isSiteExporting } = useImportExport();
	const { isSiteIdPulling, isSiteIdPushing } = useSyncSites();
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();
	const isImporting = isSiteImporting( site.id );
	const isExporting = isSiteExporting( site.id );
	const isPulling = isSiteIdPulling( site.id );
	const isPushing = isSiteIdPushing( site.id );
	const isSyncing = isPulling || isPushing;
	const isDeleting = isSiteDeleting( site.id );
	const showSpinner =
		site.isAddingSite || isImporting || isPulling || isPushing || isExporting || isDeleting;

	let tooltipText;
	if ( site.isAddingSite ) {
		tooltipText = __( 'Adding' );
	} else if ( isImporting ) {
		tooltipText = __( 'Importing' );
	} else if ( isSyncing ) {
		tooltipText = __( 'Syncing' );
	} else {
		tooltipText = __( 'Loading' );
	}

	const handleContextMenu = ( e: React.MouseEvent ) => {
		e.preventDefault();
		const ipcApi = getIpcApi();
		const isLoading = loadingServer[ site.id ] || false;
		const isAddingSite = site.isAddingSite || false;
		const finderLabel = isWindows() ? __( 'File Explorer' ) : __( 'Finder' );
		const editorLabel =
			editor && supportedEditorConfig[ editor ] ? supportedEditorConfig[ editor ].label : null;
		const terminalLabel = getTerminalName( terminal );

		ipcApi.showSiteContextMenu( {
			siteId: site.id,
			isRunning: site.running,
			isLoading,
			isAddingSite,
			isSyncing,
			finderLabel,
			editorLabel,
			terminalLabel,
		} );
	};

	return (
		<li
			className={ cx(
				'flex flex-row min-w-[168px] h-8 hover:bg-[#ffffff0C] rounded transition-all ms-1',
				isMac() ? 'me-5' : 'me-4',
				isSelected && 'bg-[#ffffff19] hover:bg-[#ffffff19]'
			) }
			onContextMenu={ handleContextMenu }
		>
			<button
				className="p-2 text-xs rounded-tl rounded-bl whitespace-nowrap overflow-hidden text-ellipsis w-full text-left rtl:text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-a8c-blue-50"
				onClick={ () => {
					setSelectedSiteId( site.id );
				} }
			>
				{ site.name }
			</button>
			{ showSpinner ? (
				<Tooltip text={ tooltipText }>
					<div className="grid place-items-center">
						<Spinner className="!w-2.5 !h-2.5 !top-[6px] !mr-2 [&>circle]:stroke-a8c-gray-70" />
					</div>
				</Tooltip>
			) : (
				<ButtonToRun { ...site } />
			) }
		</li>
	);
}

export default function SiteMenu( { className }: SiteMenuProps ) {
	const { sites, selectedSite, setSelectedSiteId, startServer, stopServer, setIsEditModalOpen } =
		useSiteDetails();
	const { setSelectedTab } = useContentTabs();
	const { handleDeleteSite } = useDeleteSite();
	const { data: editor } = useGetUserEditorQuery();

	useEffect( () => {
		const unsubscribe = window.ipcListener.subscribe(
			'site-context-menu-action',
			async ( _, actionData: { action: string; siteId: string } ) => {
				const site = sites.find( ( site ) => site.id === actionData.siteId );
				if ( ! site ) {
					return;
				}

				const ipcApi = getIpcApi();
				switch ( actionData.action ) {
					case 'start':
						void startServer( site.id );
						break;
					case 'stop':
						void stopServer( site.id );
						break;
					case 'open-site':
						if ( ! site.running ) {
							await startServer( site.id );
						}
						ipcApi.openSiteURL( site.id, '', { autoLogin: false } );
						break;
					case 'open-admin':
						if ( ! site.running ) {
							await startServer( site.id );
						}
						ipcApi.openSiteURL( site.id, '/wp-admin/' );
						break;
					case 'open-finder':
						ipcApi.openLocalPath( site.path );
						break;
					case 'open-editor':
						if ( editor ) {
							void ipcApi.openAppAtPath( editor, site.path );
						}
						break;
					case 'open-terminal':
						void ( async () => {
							try {
								await ipcApi.openTerminalAtPath( site.path );
							} catch ( error ) {
								Sentry.captureException( error );
								alert( __( 'Could not open the terminal.' ) );
							}
						} )();
						break;
					case 'edit-site':
						if ( site.id !== selectedSite?.id ) {
							setSelectedSiteId( site.id );
						}
						setSelectedTab( 'settings' );
						setIsEditModalOpen( true );
						break;
					case 'delete':
						await handleDeleteSite( site.id, site.name );
						break;
				}
			}
		);

		return () => {
			unsubscribe?.();
		};
	}, [
		sites,
		editor,
		selectedSite?.id,
		setSelectedTab,
		setIsEditModalOpen,
		setSelectedSiteId,
		startServer,
		stopServer,
		handleDeleteSite,
	] );

	return (
		<nav
			aria-label={ __( 'Sites' ) }
			style={ {
				scrollbarGutter: 'stable',
			} }
			className={ cx(
				'w-full overflow-y-auto overflow-x-hidden flex flex-col gap-0.5 pb-4',
				className
			) }
		>
			<ul className="pt-px">
				{ sites.map( ( site ) => (
					<SiteItem key={ site.id } site={ site } />
				) ) }
			</ul>
		</nav>
	);
}
