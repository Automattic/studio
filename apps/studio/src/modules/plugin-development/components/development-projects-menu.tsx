import * as Sentry from '@sentry/electron/renderer';
import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { Icon, cautionFilled, cloud, plugins, plus } from '@wordpress/icons';
import { isMac } from 'src/lib/app-globals';
import { cx } from 'src/lib/cx';
import { simplifyErrorForDisplay } from 'src/lib/error-formatting';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useDevelopmentProjects } from '../hooks/use-development-projects';

function AddProjectSidebarButton() {
	const { addProject } = useDevelopmentProjects();

	const handleAddProject = async () => {
		const ipcApi = getIpcApi();
		const response = await ipcApi.showOpenFolderDialog( __( 'Choose plugin folder' ), '' );
		if ( response?.path ) {
			try {
				await addProject( response.path );
			} catch ( error ) {
				Sentry.captureException( error );
				ipcApi.showErrorMessageBox( {
					title: __( 'Could not add plugin project' ),
					message: __( 'Select a folder that contains a WordPress plugin header and try again.' ),
					error: simplifyErrorForDisplay( error ),
				} );
			}
		}
	};

	return (
		<button
			type="button"
			className={ cx(
				'flex items-center min-w-[168px] h-8 gap-2 rounded text-xs text-left rtl:text-right px-2 transition-all hover:bg-[#ffffff0C] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme',
				isMac() ? 'me-5 ms-1' : 'me-4 ms-1'
			) }
			onClick={ handleAddProject }
		>
			<Icon icon={ plus } size={ 16 } className="fill-current opacity-70 shrink-0" />
			<span className="truncate">{ __( 'Add plugin project' ) }</span>
		</button>
	);
}

export function DevelopmentProjectsMenu() {
	const {
		projects,
		remotePlugins,
		loadingProjects,
		loadingRemotePlugins,
		remotePluginsError,
		selectedProjectId,
		selectedRemotePluginSlug,
		selectProject,
		selectRemotePlugin,
	} = useDevelopmentProjects();
	const remotePluginRows = remotePlugins.filter( ( plugin ) => ! plugin.localProjectId );
	const isLoading = loadingProjects || loadingRemotePlugins;

	return (
		<nav aria-label={ __( 'Plugin projects' ) } className="w-full overflow-x-hidden pb-4">
			<div
				className={ cx(
					'pt-5 pb-1 text-[11px] font-medium uppercase text-chrome-inverted/60',
					isMac() ? 'me-5 ms-3' : 'me-4 ms-2'
				) }
			>
				{ __( 'Plugins' ) }
			</div>
			<ul className="pt-px">
				{ projects.map( ( project ) => {
					const isSelected = project.id === selectedProjectId;
					return (
						<li
							key={ project.id }
							className={ cx(
								'flex flex-row min-w-[168px] h-8 hover:bg-[#ffffff0C] rounded transition-all ms-1 items-center',
								isMac() ? 'me-5' : 'me-4',
								isSelected && 'bg-[#ffffff19] hover:bg-[#ffffff19]'
							) }
						>
							<button
								type="button"
								className="flex items-center gap-2 p-2 text-xs rounded whitespace-nowrap overflow-hidden w-full text-left rtl:text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
								onClick={ () => selectProject( project.id ) }
							>
								<Icon icon={ plugins } size={ 16 } className="fill-current opacity-70 shrink-0" />
								<span className="truncate">{ project.name }</span>
								{ ( ! project.exists || project.error ) && (
									<Icon
										icon={ cautionFilled }
										size={ 14 }
										className="fill-current text-frame-error shrink-0 ms-auto"
									/>
								) }
							</button>
						</li>
					);
				} ) }
				{ remotePluginRows.map( ( plugin ) => {
					const isSelected = plugin.slug === selectedRemotePluginSlug;
					return (
						<li
							key={ `remote-${ plugin.slug }` }
							className={ cx(
								'flex flex-row min-w-[168px] h-8 hover:bg-[#ffffff0C] rounded transition-all ms-1 items-center',
								isMac() ? 'me-5' : 'me-4',
								isSelected && 'bg-[#ffffff19] hover:bg-[#ffffff19]'
							) }
						>
							<button
								type="button"
								className="flex items-center gap-2 p-2 text-xs rounded whitespace-nowrap overflow-hidden w-full text-left rtl:text-right focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-frame-theme"
								onClick={ () => selectRemotePlugin( plugin.slug ) }
							>
								<Icon icon={ cloud } size={ 16 } className="fill-current opacity-70 shrink-0" />
								<span className="truncate">{ plugin.name }</span>
								{ plugin.localState === 'missing' && (
									<Icon
										icon={ cautionFilled }
										size={ 14 }
										className="fill-current text-frame-error shrink-0 ms-auto"
									/>
								) }
							</button>
						</li>
					);
				} ) }
			</ul>
			{ remotePluginsError && ! isLoading && (
				<div
					className={ cx(
						'min-w-[168px] px-2 py-1 text-[11px] text-chrome-inverted/60',
						isMac() ? 'me-5 ms-1' : 'me-4 ms-1'
					) }
					title={ remotePluginsError }
				>
					{ __( 'Could not load WordPress.org plugins.' ) }
				</div>
			) }
			{ isLoading ? (
				<div className={ cx( 'h-8 flex items-center', isMac() ? 'me-5 ms-3' : 'me-4 ms-2' ) }>
					<Spinner className="!w-2.5 !h-2.5 !m-0 [&>circle]:stroke-a8c-gray-70" />
				</div>
			) : (
				<AddProjectSidebarButton />
			) }
		</nav>
	);
}
