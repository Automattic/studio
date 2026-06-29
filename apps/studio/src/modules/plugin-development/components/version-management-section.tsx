import * as Sentry from '@sentry/electron/renderer';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import Button from 'src/components/button';
import { cx } from 'src/lib/cx';
import { useDevelopmentProjects } from '../hooks/use-development-projects';
import { MetadataRow } from './shared-ui';
import type {
	DevelopmentProject,
	DevelopmentProjectReleaseTag,
	DevelopmentProjectReleaseTagList,
	DevelopmentProjectReleaseTagSwitchResult,
	DevelopmentProjectVersionBump,
	DevelopmentProjectVersionState,
	DevelopmentProjectVersionStateStatus,
} from '@studio/common/types/publishing';

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

export function VersionManagementSection( {
	project,
	isBlocked,
	isCompact = false,
	hasUnsavedChanges = false,
	onSwitchReleaseTag,
	onReleaseRefSwitched,
}: {
	project: DevelopmentProject;
	isBlocked: boolean;
	isCompact?: boolean;
	hasUnsavedChanges?: boolean;
	onSwitchReleaseTag?: (
		tag: DevelopmentProjectReleaseTag
	) => Promise< DevelopmentProjectReleaseTagSwitchResult >;
	onReleaseRefSwitched?: () => void | Promise< void >;
} ) {
	const {
		getProjectVersionState,
		bumpProjectVersion,
		listProjectReleaseTags,
		switchProjectReleaseTag,
	} = useDevelopmentProjects();
	const [ versionState, setVersionState ] = useState< DevelopmentProjectVersionState | null >(
		null
	);
	const [ releaseTags, setReleaseTags ] = useState< DevelopmentProjectReleaseTagList | null >(
		null
	);
	const [ isLoading, setIsLoading ] = useState( false );
	const [ isLoadingTags, setIsLoadingTags ] = useState( false );
	const [ bumpingVersion, setBumpingVersion ] = useState< DevelopmentProjectVersionBump | null >(
		null
	);
	const [ switchingTag, setSwitchingTag ] = useState< string | null >( null );
	const [ errorMessage, setErrorMessage ] = useState< string | null >( null );
	const [ tagErrorMessage, setTagErrorMessage ] = useState< string | null >( null );

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

	useEffect( () => {
		let isMounted = true;
		if ( isBlocked ) {
			setReleaseTags( null );
			return;
		}

		setIsLoadingTags( true );
		setTagErrorMessage( null );
		void listProjectReleaseTags( project.id )
			.then( ( tags ) => {
				if ( isMounted ) {
					setReleaseTags( tags );
				}
			} )
			.catch( ( error ) => {
				Sentry.captureException( error );
				if ( isMounted ) {
					setReleaseTags( null );
					setTagErrorMessage( error instanceof Error ? error.message : String( error ) );
				}
			} )
			.finally( () => {
				if ( isMounted ) {
					setIsLoadingTags( false );
				}
			} );

		return () => {
			isMounted = false;
		};
	}, [ isBlocked, listProjectReleaseTags, project.id, project.updatedAt ] );

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

	const handleSwitchTag = async ( tag: DevelopmentProjectReleaseTag ) => {
		if (
			tag.isCurrent ||
			tag.isUncommitted ||
			! releaseTags?.svnRootDir ||
			isBlocked ||
			hasUnsavedChanges
		) {
			return;
		}

		setSwitchingTag( tag.name );
		setTagErrorMessage( null );
		try {
			const result = onSwitchReleaseTag
				? await onSwitchReleaseTag( tag )
				: await switchProjectReleaseTag( project.id, tag.name );
			setReleaseTags( result.tags );
			try {
				setVersionState( await getProjectVersionState( project.id ) );
			} catch ( versionError ) {
				Sentry.captureException( versionError );
			}
			if ( ! onSwitchReleaseTag ) {
				await onReleaseRefSwitched?.();
			}
		} catch ( error ) {
			Sentry.captureException( error );
			setTagErrorMessage( error instanceof Error ? error.message : String( error ) );
		} finally {
			setSwitchingTag( null );
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
	const releaseTagRows = releaseTags
		? ( [ releaseTags.trunk, ...releaseTags.tags ].filter(
				Boolean
		  ) as DevelopmentProjectReleaseTag[] )
		: [];
	const currentRefLabel = releaseTags?.currentRef
		? sprintf(
				// translators: %s is an SVN ref such as trunk or a version tag.
				__( 'Current: %s' ),
				releaseTags.currentRef
		  )
		: releaseTags?.svnRootDir
		? __( 'Current ref unknown' )
		: __( 'Local SVN checkout required to switch' );

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
						<div className={ cx( 'grid grid-cols-1 gap-4', ! isCompact && 'md:grid-cols-2' ) }>
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

				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-2">
						<h3 className="a8c-body-title m-0">{ __( 'SVN tags' ) }</h3>
						<span className="text-xs text-frame-text-secondary">{ currentRefLabel }</span>
					</div>
					{ isLoadingTags ? (
						<div className="rounded-sm border border-frame-border bg-frame-bg px-3 py-2 text-sm text-frame-text-secondary">
							{ __( 'Loading SVN tags…' ) }
						</div>
					) : releaseTagRows.length ? (
						<div className="flex flex-col overflow-hidden rounded-sm border border-frame-border bg-frame-bg">
							{ releaseTagRows.map( ( tag ) => {
								const canSwitch =
									Boolean( releaseTags?.svnRootDir ) &&
									! tag.isCurrent &&
									! tag.isUncommitted &&
									! hasUnsavedChanges &&
									! isBlocked;
								return (
									<div
										key={ tag.name }
										className="flex items-center justify-between gap-3 border-b border-frame-border px-3 py-2 last:border-b-0"
									>
										<div className="min-w-0 flex flex-col gap-1">
											<div className="flex min-w-0 flex-wrap items-center gap-2">
												<span className="truncate text-sm font-medium text-frame-text">
													{ tag.name }
												</span>
												{ tag.isCurrent && (
													<span className="rounded-sm border border-frame-border bg-frame-surface px-1.5 py-0.5 text-xs text-frame-text-secondary">
														{ __( 'Current' ) }
													</span>
												) }
												{ tag.isUncommitted && (
													<span className="rounded-sm border border-frame-border bg-frame-surface px-1.5 py-0.5 text-xs text-frame-text-secondary">
														{ __( 'Uncommitted' ) }
													</span>
												) }
											</div>
											{ tag.isUncommitted && (
												<span className="text-xs text-frame-text-secondary">
													{ __( 'Ready for release' ) }
												</span>
											) }
										</div>
										{ canSwitch && (
											<Button
												variant="secondary"
												disabled={ Boolean( switchingTag ) }
												onClick={ () => void handleSwitchTag( tag ) }
											>
												{ switchingTag === tag.name ? __( 'Switching…' ) : __( 'Switch' ) }
											</Button>
										) }
									</div>
								);
							} ) }
						</div>
					) : (
						<div className="rounded-sm border border-frame-border bg-frame-bg px-3 py-2 text-sm text-frame-text-secondary">
							{ releaseTags?.source === 'unknown'
								? __( 'SVN tags are not available for this project yet.' )
								: __( 'No SVN tags found yet.' ) }
						</div>
					) }
					{ tagErrorMessage && <div className="text-sm text-frame-error">{ tagErrorMessage }</div> }
				</div>

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
