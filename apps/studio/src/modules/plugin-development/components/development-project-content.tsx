import * as Sentry from '@sentry/electron/renderer';
import { DEFAULT_PHP_VERSION, DEFAULT_WORDPRESS_VERSION } from '@studio/common/constants';
import {
	SupportedPHPVersions,
	isSupportedPHPVersion,
	type SupportedPHPVersion,
} from '@studio/common/types/php-versions';
import { SelectControl } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import {
	Icon,
	archive,
	cautionFilled,
	check,
	cloud,
	code,
	external,
	globe,
	plugins,
	preformatted,
	reset,
	update,
} from '@wordpress/icons';
import { useEffect, useMemo, useState } from 'react';
import Button from 'src/components/button';
import { ButtonsSection, ButtonsSectionProps } from 'src/components/buttons-section';
import { WPVersionSelector } from 'src/components/wp-version-selector';
import { cx } from 'src/lib/cx';
import { simplifyErrorForDisplay } from 'src/lib/error-formatting';
import { getFileManagerLabel } from 'src/lib/file-manager';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { supportedEditorConfig } from 'src/modules/user-settings/lib/editor';
import { getTerminalName } from 'src/modules/user-settings/lib/terminal';
import { useGetUserEditorQuery, useGetUserTerminalQuery } from 'src/stores/installed-apps-api';
import { useDevelopmentProjects } from '../hooks/use-development-projects';
import { AddDevelopmentProjectButton } from './add-development-project-button';
import type {
	DevelopmentProject,
	DevelopmentProjectVersionBump,
	DevelopmentProjectVersionState,
	DevelopmentProjectVersionStateStatus,
	RemoteDevelopmentPlugin,
} from '@studio/common/types/publishing';

function ProjectEmptyState() {
	return (
		<div className="w-full h-full flex items-center justify-center app-no-drag-region px-8">
			<div className="max-w-[420px] flex flex-col items-center text-center gap-4">
				<div className="w-10 h-10 rounded-sm border border-frame-border bg-frame-surface flex items-center justify-center">
					<Icon icon={ plugins } size={ 24 } className="fill-frame-text-secondary" />
				</div>
				<div>
					<h1 className="text-xl font-medium">{ __( 'Add a plugin project' ) }</h1>
					<p className="mt-2 text-sm text-frame-text-secondary">
						{ __( 'Choose a local WordPress plugin folder to manage it from Studio.' ) }
					</p>
				</div>
				<AddDevelopmentProjectButton variant="primary" />
			</div>
		</div>
	);
}

function MetadataRow( { label, value }: { label: string; value?: string } ) {
	if ( ! value ) {
		return null;
	}
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<div className="a8c-label text-frame-text-secondary">{ label }</div>
			<div className="text-sm text-frame-text break-words">{ value }</div>
		</div>
	);
}

function ReadinessItem( {
	label,
	description,
	state,
}: {
	label: string;
	description: string;
	state: 'ready' | 'blocked' | 'next';
} ) {
	const icon = state === 'ready' ? check : state === 'blocked' ? cautionFilled : update;
	return (
		<li className="flex gap-3 py-3 border-t border-frame-border first:border-t-0">
			<div
				className={ cx(
					'w-7 h-7 rounded-sm border flex items-center justify-center shrink-0',
					state === 'ready' && 'border-frame-running text-frame-running bg-frame-surface',
					state === 'blocked' && 'border-frame-error text-frame-error bg-frame-surface',
					state === 'next' && 'border-frame-border text-frame-text-secondary bg-frame-surface'
				) }
			>
				<Icon icon={ icon } size={ 18 } className="fill-current" />
			</div>
			<div className="min-w-0">
				<div className="text-sm font-medium text-frame-text">{ label }</div>
				<div className="text-sm text-frame-text-secondary">{ description }</div>
			</div>
		</li>
	);
}

function getStatusLabel( status: DevelopmentProjectVersionStateStatus ) {
	switch ( status ) {
		case 'ready':
			return __( 'Ready' );
		case 'duplicate_tag_blocked':
			return __( 'Duplicate SVN tag' );
		case 'header_readme_mismatch':
			return __( 'Version mismatch' );
		case 'remote_newer':
			return __( 'Remote newer' );
		case 'missing_version':
			return __( 'Missing version' );
		case 'unknown_svn_state':
			return __( 'SVN tags unknown' );
	}
}

function VersionStatusBadge( { status }: { status: DevelopmentProjectVersionStateStatus } ) {
	const state = [ 'ready', 'remote_newer', 'unknown_svn_state' ].includes( status )
		? 'ready'
		: 'blocked';
	return (
		<span
			className={ cx(
				'inline-flex items-center rounded-sm border px-2 py-1 text-xs font-medium',
				state === 'ready'
					? 'border-frame-border text-frame-text-secondary bg-frame-surface'
					: 'border-frame-error text-frame-error bg-frame-surface'
			) }
		>
			{ getStatusLabel( status ) }
		</span>
	);
}

function VersionManagementSection( {
	project,
	isBlocked,
}: {
	project: DevelopmentProject;
	isBlocked: boolean;
} ) {
	const { getProjectVersionState, bumpProjectVersion } = useDevelopmentProjects();
	const [ versionState, setVersionState ] = useState< DevelopmentProjectVersionState | null >(
		null
	);
	const [ isLoading, setIsLoading ] = useState( false );
	const [ bumpingVersion, setBumpingVersion ] = useState< DevelopmentProjectVersionBump | null >(
		null
	);
	const [ errorMessage, setErrorMessage ] = useState< string | null >( null );

	useEffect( () => {
		let isMounted = true;
		if ( isBlocked ) {
			setVersionState( null );
			return;
		}

		setIsLoading( true );
		setErrorMessage( null );
		void getProjectVersionState( project.id )
			.then( ( state ) => {
				if ( isMounted ) {
					setVersionState( state );
				}
			} )
			.catch( ( error ) => {
				Sentry.captureException( error );
				if ( isMounted ) {
					setErrorMessage( error instanceof Error ? error.message : String( error ) );
				}
			} )
			.finally( () => {
				if ( isMounted ) {
					setIsLoading( false );
				}
			} );

		return () => {
			isMounted = false;
		};
	}, [ getProjectVersionState, isBlocked, project.id, project.updatedAt ] );

	const handleBump = async ( bump: DevelopmentProjectVersionBump ) => {
		setBumpingVersion( bump );
		setErrorMessage( null );
		try {
			setVersionState( await bumpProjectVersion( project.id, bump ) );
		} catch ( error ) {
			Sentry.captureException( error );
			setErrorMessage( error instanceof Error ? error.message : String( error ) );
		} finally {
			setBumpingVersion( null );
		}
	};

	const bumpButtons: Array< { bump: DevelopmentProjectVersionBump; label: string } > = [
		{
			bump: 'patch',
			label: sprintf(
				// translators: %s is the next patch version.
				__( 'Patch %s' ),
				versionState?.nextVersions?.patch || ''
			).trim(),
		},
		{
			bump: 'minor',
			label: sprintf(
				// translators: %s is the next minor version.
				__( 'Minor %s' ),
				versionState?.nextVersions?.minor || ''
			).trim(),
		},
		{
			bump: 'major',
			label: sprintf(
				// translators: %s is the next major version.
				__( 'Major %s' ),
				versionState?.nextVersions?.major || ''
			).trim(),
		},
	];

	return (
		<section>
			<h2 className="a8c-subtitle-small mb-3">{ __( 'Version' ) }</h2>
			<div className="rounded-sm border border-frame-border bg-frame-surface p-4 flex flex-col gap-4">
				{ isLoading ? (
					<div className="text-sm text-frame-text-secondary">
						{ __( 'Checking version state…' ) }
					</div>
				) : (
					<>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<MetadataRow label={ __( 'Plugin header' ) } value={ versionState?.localVersion } />
							<MetadataRow
								label={ __( 'Readme stable tag' ) }
								value={ versionState?.readmeStableTag }
							/>
							<MetadataRow
								label={ __( 'WordPress.org version' ) }
								value={ versionState?.remoteVersion }
							/>
							<MetadataRow label={ __( 'Latest SVN tag' ) } value={ versionState?.latestSvnTag } />
						</div>

						{ versionState && (
							<div className="flex flex-wrap gap-2">
								{ versionState.statuses.map( ( status ) => (
									<VersionStatusBadge key={ status } status={ status } />
								) ) }
							</div>
						) }

						{ versionState && (
							<ul className="text-sm text-frame-text-secondary flex flex-col gap-1">
								{ versionState.messages.map( ( message ) => (
									<li key={ message }>{ message }</li>
								) ) }
							</ul>
						) }
					</>
				) }

				{ errorMessage && (
					<div className="text-sm text-frame-error">
						{ sprintf(
							// translators: %s is an error message.
							__( 'Could not check version state: %s' ),
							errorMessage
						) }
					</div>
				) }

				<div className="flex flex-wrap gap-2">
					{ bumpButtons.map( ( button ) => (
						<Button
							key={ button.bump }
							variant="secondary"
							disabled={
								isBlocked ||
								isLoading ||
								Boolean( bumpingVersion ) ||
								! versionState?.nextVersions?.[ button.bump ]
							}
							onClick={ () => handleBump( button.bump ) }
						>
							{ bumpingVersion === button.bump ? __( 'Updating…' ) : button.label }
						</Button>
					) ) }
				</div>
			</div>
		</section>
	);
}

function getDefaultProjectPhpVersion( project: DevelopmentProject ): SupportedPHPVersion {
	const requestedVersion = project.info?.requiresPhp;
	return isSupportedPHPVersion( requestedVersion ) ? requestedVersion : DEFAULT_PHP_VERSION;
}

function PlaygroundSection( {
	project,
	isBlocked,
}: {
	project: DevelopmentProject;
	isBlocked: boolean;
} ) {
	const { startProjectPlayground, startingPlaygroundProjectId } = useDevelopmentProjects();
	const ipcApi = getIpcApi();
	const [ wpVersion, setWpVersion ] = useState< string >( DEFAULT_WORDPRESS_VERSION );
	const [ phpVersion, setPhpVersion ] = useState< SupportedPHPVersion >(
		getDefaultProjectPhpVersion( project )
	);
	const [ playground, setPlayground ] = useState< {
		siteId: string;
		siteName: string;
		sitePath: string;
		url?: string;
	} | null >( null );
	const [ errorMessage, setErrorMessage ] = useState< string | null >( null );
	const isStartingPlayground = startingPlaygroundProjectId === project.id;
	const requiredPhpVersion = project.info?.requiresPhp;
	const extraWpOptions = useMemo(
		() =>
			[ project.info?.testedUpTo, project.info?.requiresAtLeast ]
				.filter( ( value ): value is string => Boolean( value && value !== 'latest' ) )
				.map( ( value ) => ( { label: value, value } ) ),
		[ project.info?.requiresAtLeast, project.info?.testedUpTo ]
	);

	useEffect( () => {
		setPhpVersion(
			isSupportedPHPVersion( requiredPhpVersion ) ? requiredPhpVersion : DEFAULT_PHP_VERSION
		);
	}, [ project.id, requiredPhpVersion ] );

	const handleStart = async ( resetPlayground = false ) => {
		setErrorMessage( null );
		try {
			const result = await startProjectPlayground( project.id, {
				wpVersion,
				phpVersion,
				reset: resetPlayground,
			} );
			setPlayground( {
				siteId: result.siteId,
				siteName: result.siteName,
				sitePath: result.sitePath,
				url: result.url,
			} );
			ipcApi.openSiteURL( result.siteId );
		} catch ( error ) {
			Sentry.captureException( error );
			setErrorMessage( error instanceof Error ? error.message : String( error ) );
		}
	};

	const linkedSiteId = playground?.siteId || project.linkedSiteId;

	return (
		<section>
			<h2 className="a8c-subtitle-small mb-3">{ __( 'Playground' ) }</h2>
			<div className="rounded-sm border border-frame-border bg-frame-surface p-4 flex flex-col gap-4">
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<WPVersionSelector
						selectedValue={ wpVersion }
						onChange={ setWpVersion }
						disabled={ isBlocked || isStartingPlayground }
						extraOptions={ extraWpOptions }
						fallbackOptions={ [
							{
								label: __( 'latest' ),
								value: DEFAULT_WORDPRESS_VERSION,
							},
						] }
					/>
					<label className="flex flex-1 flex-col gap-1.5 leading-4">
						<span className="font-semibold">{ __( 'PHP version' ) }</span>
						<SelectControl< SupportedPHPVersion >
							value={ phpVersion }
							onChange={ setPhpVersion }
							disabled={ isBlocked || isStartingPlayground }
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						>
							{ SupportedPHPVersions.map( ( version ) => (
								<option key={ version } value={ version }>
									{ version }
								</option>
							) ) }
						</SelectControl>
					</label>
				</div>

				<div className="flex flex-wrap gap-2">
					<Button
						variant="primary"
						icon={ globe }
						iconSize={ 18 }
						disabled={ isBlocked || isStartingPlayground }
						onClick={ () => handleStart( false ) }
					>
						{ isStartingPlayground ? __( 'Starting…' ) : __( 'Start Playground' ) }
					</Button>
					<Button
						variant="secondary"
						icon={ reset }
						iconSize={ 18 }
						disabled={ isBlocked || isStartingPlayground || ! linkedSiteId }
						onClick={ () => handleStart( true ) }
					>
						{ __( 'Reset' ) }
					</Button>
					<Button
						variant="secondary"
						icon={ external }
						iconSize={ 18 }
						disabled={ ! linkedSiteId }
						onClick={ () => linkedSiteId && ipcApi.openSiteURL( linkedSiteId ) }
					>
						{ __( 'Open' ) }
					</Button>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<MetadataRow label={ __( 'Site' ) } value={ playground?.siteName } />
					<MetadataRow label={ __( 'Folder' ) } value={ playground?.sitePath } />
					<MetadataRow label={ __( 'URL' ) } value={ playground?.url } />
					<MetadataRow
						label={ __( 'Runtime' ) }
						value={ sprintf(
							// translators: %1$s is a WordPress version, %2$s is a PHP version.
							__( 'WordPress %1$s, PHP %2$s' ),
							wpVersion,
							phpVersion
						) }
					/>
				</div>

				{ errorMessage && (
					<div className="text-sm text-frame-error">
						{ sprintf(
							// translators: %s is an error message.
							__( 'Could not start Playground: %s' ),
							errorMessage
						) }
					</div>
				) }
			</div>
		</section>
	);
}

function formatRemoteRoles( roles: RemoteDevelopmentPlugin[ 'roles' ] ) {
	if ( roles.length === 0 ) {
		return undefined;
	}

	return roles
		.map( ( role ) => ( role === 'committer' ? __( 'Committer' ) : __( 'Contributor' ) ) )
		.join( ', ' );
}

function getRemoteStateDescription( plugin: RemoteDevelopmentPlugin ) {
	if ( plugin.localState === 'missing' ) {
		return __( 'The previous local folder is missing. Studio can recreate the SVN checkout.' );
	}

	if ( plugin.localState === 'cloned' || plugin.localState === 'tracked' ) {
		return plugin.localPath || __( 'This WordPress.org plugin already has a local project.' );
	}

	return __( 'Clone the WordPress.org SVN repository before editing or publishing this plugin.' );
}

function RemotePluginContent( { plugin }: { plugin: RemoteDevelopmentPlugin } ) {
	const { cloneRemotePlugin, cloningRemotePluginSlug, selectProject } = useDevelopmentProjects();
	const ipcApi = getIpcApi();
	const isCloning = cloningRemotePluginSlug === plugin.slug;
	const hasLocalProject = Boolean( plugin.localProjectId );

	const handlePrimaryAction = async () => {
		if ( plugin.localProjectId ) {
			selectProject( plugin.localProjectId );
			return;
		}

		try {
			await cloneRemotePlugin( plugin.slug );
		} catch ( error ) {
			Sentry.captureException( error );
			ipcApi.showErrorMessageBox( {
				title: __( 'Could not clone WordPress.org plugin' ),
				message: __( 'Studio could not create a local SVN checkout for this plugin.' ),
				error: simplifyErrorForDisplay( error ),
			} );
		}
	};

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto">
			<div className="flex justify-between items-start w-full gap-5 px-8">
				<div className="flex min-w-0 flex-col">
					<div className="flex items-center gap-2 text-frame-text-secondary text-sm">
						<Icon icon={ cloud } size={ 18 } className="fill-current" />
						<span>{ __( 'WordPress.org plugin' ) }</span>
					</div>
					<h1 className="text-xl font-medium max-h-full line-clamp-1 break-all mt-1">
						{ plugin.name }
					</h1>
					<div className="flex mt-1 gap-x-4 text-sm text-frame-text-secondary min-w-0">
						<span className="truncate">{ plugin.slug }</span>
						{ plugin.testedWith && (
							<span>
								{ sprintf(
									// translators: %s is a WordPress version number.
									__( 'Tested up to %s' ),
									plugin.testedWith
								) }
							</span>
						) }
					</div>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<Button variant="secondary" onClick={ () => ipcApi.openURL( plugin.url ) }>
						{ __( 'Open on WordPress.org' ) }
					</Button>
					<Button variant="primary" onClick={ handlePrimaryAction } disabled={ isCloning }>
						{ hasLocalProject
							? __( 'Open local project' )
							: isCloning
							? __( 'Cloning…' )
							: __( 'Work on this' ) }
					</Button>
				</div>
			</div>

			<div className="px-8 pb-8 mt-7 flex flex-col gap-8 max-w-[960px]">
				<section>
					<h2 className="a8c-subtitle-small mb-3">{ __( 'Local development' ) }</h2>
					<ul className="rounded-sm border border-frame-border bg-frame-surface px-4">
						<ReadinessItem
							label={ hasLocalProject ? __( 'Local project' ) : __( 'Local checkout' ) }
							description={ getRemoteStateDescription( plugin ) }
							state={ hasLocalProject ? 'ready' : 'next' }
						/>
					</ul>
				</section>

				<section>
					<h2 className="a8c-subtitle-small mb-3">{ __( 'WordPress.org' ) }</h2>
					<div className="rounded-sm border border-frame-border bg-frame-surface p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
						<MetadataRow label={ __( 'Slug' ) } value={ plugin.slug } />
						<MetadataRow label={ __( 'Role' ) } value={ formatRemoteRoles( plugin.roles ) } />
						<MetadataRow label={ __( 'Author' ) } value={ plugin.author } />
						<MetadataRow label={ __( 'Active installs' ) } value={ plugin.activeInstalls } />
						<MetadataRow label={ __( 'Tested up to' ) } value={ plugin.testedWith } />
						<MetadataRow label={ __( 'URL' ) } value={ plugin.url } />
						<MetadataRow label={ __( 'Local folder' ) } value={ plugin.localPath } />
					</div>
				</section>
			</div>
		</div>
	);
}

export function DevelopmentProjectContent() {
	const { selectedProject, selectedRemotePlugin, removeProject, refreshProject } =
		useDevelopmentProjects();
	const { data: editor } = useGetUserEditorQuery();
	const { data: terminal } = useGetUserTerminalQuery();
	const [ isRefreshing, setIsRefreshing ] = useState( false );

	if ( selectedRemotePlugin ) {
		return <RemotePluginContent plugin={ selectedRemotePlugin } />;
	}

	if ( ! selectedProject ) {
		return <ProjectEmptyState />;
	}

	const ipcApi = getIpcApi();
	const editorConfig = editor ? supportedEditorConfig[ editor ] : false;
	const terminalName = getTerminalName( terminal );
	const projectInfo = selectedProject.info;
	const isBlocked = ! selectedProject.exists || Boolean( selectedProject.error );

	const openButtons: ButtonsSectionProps[ 'buttonsArray' ] = [
		{
			label: getFileManagerLabel(),
			className: 'text-nowrap',
			icon: archive,
			disabled: ! selectedProject.exists,
			onClick: () => ipcApi.openLocalPath( selectedProject.path ),
		},
	];

	if ( editor && editorConfig ) {
		openButtons.push( {
			label: editorConfig.label,
			className: 'text-nowrap',
			icon: code,
			disabled: ! selectedProject.exists,
			onClick: async () => {
				await ipcApi.openAppAtPath( editor, selectedProject.path );
			},
		} );
	}

	openButtons.push( {
		label: terminalName,
		className: 'text-nowrap',
		icon: preformatted,
		disabled: ! selectedProject.exists,
		onClick: async () => {
			try {
				await ipcApi.openTerminalAtPath( selectedProject.path );
			} catch ( error ) {
				Sentry.captureException( error );
				alert( __( 'Could not open the terminal.' ) );
			}
		},
	} );

	const handleRefresh = async () => {
		setIsRefreshing( true );
		try {
			await refreshProject( selectedProject.id );
		} catch ( error ) {
			Sentry.captureException( error );
			ipcApi.showErrorMessageBox( {
				title: __( 'Could not refresh plugin project' ),
				message: __( 'Studio could not read the plugin metadata from this folder.' ),
				error: simplifyErrorForDisplay( error ),
			} );
		} finally {
			setIsRefreshing( false );
		}
	};

	const handleRemove = async () => {
		const REMOVE_BUTTON_INDEX = 0;
		const CANCEL_BUTTON_INDEX = 1;
		const { response } = await ipcApi.showMessageBox( {
			type: 'warning',
			message: sprintf( __( 'Remove %s from Studio' ), selectedProject.name ),
			detail: __( 'The plugin folder will stay on your computer.' ),
			buttons: [ __( 'Remove project' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );

		if ( response === REMOVE_BUTTON_INDEX ) {
			await removeProject( selectedProject.id );
		}
	};

	return (
		<div className="flex flex-col w-full h-full app-no-drag-region pt-8 overflow-y-auto">
			<div className="flex justify-between items-start w-full gap-5 px-8">
				<div className="flex min-w-0 flex-col">
					<div className="flex items-center gap-2 text-frame-text-secondary text-sm">
						<Icon icon={ plugins } size={ 18 } className="fill-current" />
						<span>{ __( 'Plugin project' ) }</span>
					</div>
					<h1 className="text-xl font-medium max-h-full line-clamp-1 break-all mt-1">
						{ selectedProject.name }
					</h1>
					<div className="flex mt-1 gap-x-4 text-sm text-frame-text-secondary min-w-0">
						<span className="truncate">{ selectedProject.slug }</span>
						{ projectInfo?.version && <span>{ projectInfo.version }</span> }
					</div>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<Button variant="secondary" onClick={ handleRefresh } disabled={ isRefreshing }>
						{ isRefreshing ? __( 'Refreshing…' ) : __( 'Refresh' ) }
					</Button>
					<Button variant="secondary" isDestructive onClick={ handleRemove }>
						{ __( 'Remove' ) }
					</Button>
				</div>
			</div>

			<div className="px-8 pb-8 mt-7 flex flex-col gap-8 max-w-[960px]">
				{ isBlocked && (
					<div className="rounded-sm border border-frame-error bg-frame-surface p-4 flex gap-3">
						<Icon icon={ cautionFilled } size={ 20 } className="fill-frame-error shrink-0 mt-0.5" />
						<div>
							<div className="text-sm font-medium text-frame-text">
								{ __( 'Studio cannot prepare this project yet.' ) }
							</div>
							<div className="mt-1 text-sm text-frame-text-secondary">
								{ selectedProject.error }
							</div>
						</div>
					</div>
				) }

				<ButtonsSection buttonsArray={ openButtons } title={ __( 'Open in…' ) } />

				<PlaygroundSection project={ selectedProject } isBlocked={ isBlocked } />

				<VersionManagementSection project={ selectedProject } isBlocked={ isBlocked } />

				<section>
					<h2 className="a8c-subtitle-small mb-3">{ __( 'Project' ) }</h2>
					<div className="rounded-sm border border-frame-border bg-frame-surface p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
						<MetadataRow label={ __( 'Folder' ) } value={ selectedProject.path } />
						<MetadataRow label={ __( 'Main file' ) } value={ projectInfo?.mainFile } />
						<MetadataRow label={ __( 'Text domain' ) } value={ projectInfo?.textDomain } />
						<MetadataRow label={ __( 'Author' ) } value={ projectInfo?.author } />
						<MetadataRow
							label={ __( 'Requires at least' ) }
							value={ projectInfo?.requiresAtLeast }
						/>
						<MetadataRow label={ __( 'Tested up to' ) } value={ projectInfo?.testedUpTo } />
						<MetadataRow label={ __( 'Requires PHP' ) } value={ projectInfo?.requiresPhp } />
					</div>
				</section>

				<section>
					<h2 className="a8c-subtitle-small mb-3">{ __( 'Publishing readiness' ) }</h2>
					<ul className="rounded-sm border border-frame-border bg-frame-surface px-4">
						<ReadinessItem
							label={ __( 'Plugin metadata' ) }
							description={
								isBlocked
									? __( 'Fix the folder or plugin headers before Studio can package it.' )
									: __( 'Studio found the plugin header and local project folder.' )
							}
							state={ isBlocked ? 'blocked' : 'ready' }
						/>
						<ReadinessItem
							label={ __( 'Plugin Check' ) }
							description={ __( 'Run WordPress Plugin Check before packaging.' ) }
							state="next"
						/>
						<ReadinessItem
							label={ __( 'Package dry run' ) }
							description={ __(
								'Build a release zip and review ignored files before submission.'
							) }
							state="next"
						/>
						<ReadinessItem
							label={ __( 'WordPress.org publish' ) }
							description={ __( 'Submit or release only after an explicit confirmation step.' ) }
							state="next"
						/>
					</ul>
				</section>
			</div>
		</div>
	);
}
