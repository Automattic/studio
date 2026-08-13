import { PRESSABLE_PHP_VERSION } from '@studio/common/constants';
import { SYNC_PUSH_SIZE_LIMIT_GB } from '@studio/common/lib/sync/constants';
import {
	Icon,
	SelectControl,
	Notice,
	__experimentalHeading as Heading,
} from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf, __ } from '@wordpress/i18n';
import { cautionFilled } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { format } from 'date-fns';
import { useState, useEffect, useCallback } from 'react';
import { useI18nLocale } from '@/components/selective-sync/data/stores';
import {
	useHostingPhpVersion,
	useLatestRewindId,
	useRemoteFileTree,
	useLocalFileTree,
} from '@/components/selective-sync/data/sync-stores';
import { useGetWpVersion } from '@/components/selective-sync/hooks/use-get-wp-version';
import { useIsMultisite } from '@/components/selective-sync/hooks/use-is-multisite';
import { useSelectedItemsPushSize } from '@/components/selective-sync/hooks/use-selected-items-push-size';
import { useSyncDialogTexts } from '@/components/selective-sync/hooks/use-sync-dialog-texts';
import { useTopLevelSyncTree } from '@/components/selective-sync/hooks/use-top-level-sync-tree';
import { ArrowIcon } from '@/components/selective-sync/icons/arrow-icon';
import { RightArrowIcon } from '@/components/selective-sync/icons/right-arrow';
import { cx } from '@/components/selective-sync/lib/cx';
import { getSiteEnvironment } from '@/components/selective-sync/lib/environment-utils';
import { getIpcApi } from '@/components/selective-sync/lib/get-ipc-api';
import { getLocalizedLink } from '@/components/selective-sync/lib/get-localized-link';
import { hasVersionMismatch } from '@/components/selective-sync/lib/version-comparison';
import Button from '@/components/selective-sync/primitives/button';
import Modal from '@/components/selective-sync/primitives/modal';
import { TwoColorProgressBar } from '@/components/selective-sync/primitives/progress-bar';
import { Tooltip } from '@/components/selective-sync/primitives/tooltip';
import { SiteNameBox } from '@/components/selective-sync/site-name-box';
import { TreeView, TreeNode, updateNodeById } from '@/components/selective-sync/tree-view';
import { TreeViewLoadingSkeleton } from './tree-view-loading-skeleton';
import type { SiteDetails } from '@/data/core';
import type { SyncSite } from '@studio/common/types/sync';

type SyncDialogProps = {
	type: 'push' | 'pull';
	localSite: SiteDetails;
	remoteSite: SyncSite;
	onPush: ( syncData: TreeNode[] ) => void;
	onPull: ( syncData: TreeNode[] ) => void;
	onRequestClose: () => void;
};

const useDynamicTreeState = (
	type: 'push' | 'pull',
	localSiteId: string,
	remoteSiteId: number | undefined,
	setTreeState: React.Dispatch< React.SetStateAction< TreeNode[] > >
) => {
	const {
		rewindId,
		isLoading: isLoadingRewindId,
		isError: isErrorRewindId,
	} = useLatestRewindId( remoteSiteId, {
		skip: type === 'push',
	} );
	const { fetchChildren } = useRemoteFileTree();
	const {
		fetchChildren: fetchLocalChildren,
		isLoading: isLoadingLocalFileTree,
		error: localFileTreeError,
	} = useLocalFileTree();
	const [ remoteFileTreeError, setRemoteFileTreeError ] = useState< Error | null >( null );

	// If the site was just created and if there is no rewind_id yet,
	// then all options are pre-checked to allow only a full sync
	useEffect( () => {
		if ( type === 'pull' && ! isLoadingRewindId && ! rewindId && remoteSiteId ) {
			setTreeState( ( prev ) => {
				const treeToUpdate = updateNodeById( prev, 'filesAndFolders', { checked: true } );
				return updateNodeById( treeToUpdate, 'sqls', { checked: true } );
			} );
		}
	}, [ type, isLoadingRewindId, rewindId, remoteSiteId, setTreeState ] );

	useEffect( () => {
		if ( type === 'pull' && remoteSiteId ) {
			let isCancelled = false;
			const loadRemoteTree = async () => {
				setRemoteFileTreeError( null );
				try {
					if ( rewindId ) {
						const remoteTree = await fetchChildren( remoteSiteId, rewindId, '/wp-content/', false );
						if ( ! isCancelled ) {
							setTreeState( ( treeState ) =>
								updateNodeById( treeState, 'wp-content', { children: remoteTree } )
							);
						}
					}
				} catch ( error ) {
					const errorObj = error instanceof Error ? error : new Error( 'Unknown error occurred' );
					if ( ! isCancelled ) {
						setRemoteFileTreeError( errorObj );
					}
				}
			};
			void loadRemoteTree();
			return () => {
				isCancelled = true;
			};
		}

		if ( type === 'push' ) {
			let isCancelled = false;
			const loadLocalTree = async () => {
				const localTree = await fetchLocalChildren( localSiteId, 'wp-content' );
				if ( ! isCancelled ) {
					setTreeState( ( treeState ) =>
						updateNodeById( treeState, 'wp-content', { children: localTree } )
					);
				}
			};
			void loadLocalTree();
			return () => {
				isCancelled = true;
			};
		}
	}, [
		type,
		setTreeState,
		remoteSiteId,
		rewindId,
		fetchChildren,
		fetchLocalChildren,
		localSiteId,
	] );

	return {
		rewindId,
		fetchChildren,
		fetchLocalChildren,
		isLoadingRewindId,
		isErrorRewindId,
		isLoadingLocalFileTree,
		localFileTreeError,
		remoteFileTreeError,
	};
};

export function SyncDialog( {
	type,
	localSite,
	remoteSite,
	onPush,
	onPull,
	onRequestClose,
}: SyncDialogProps ) {
	const locale = useI18nLocale();
	const { __, _n } = useI18n();
	const siteEnv = getSiteEnvironment( remoteSite );
	const syncTexts = useSyncDialogTexts( type, siteEnv );
	const defaultTree = useTopLevelSyncTree();

	const [ showAllFiles, setShowAllFiles ] = useState( false );
	const [ treeState, setTreeState ] = useState< TreeNode[] >( defaultTree );
	const isSubmitDisabled = treeState.every( ( node ) => ! node.checked && ! node.indeterminate );
	const {
		isPushSelectionOverLimit,
		isLoading: isSizeCheckLoading,
		totalSize,
		limitBytes,
		formattedSize,
		formattedLimit,
		formattedOverAmount,
	} = useSelectedItemsPushSize( localSite.id, treeState, type );

	const {
		fetchChildren,
		rewindId,
		isLoadingRewindId,
		isErrorRewindId,
		isLoadingLocalFileTree,
		localFileTreeError,
		remoteFileTreeError,
	} = useDynamicTreeState( type, localSite.id, remoteSite.id, setTreeState );

	const {
		phpVersion: remotePhpVersion,
		isLoading: isLoadingRemotePhpVersion,
		isError: isRemotePhpVersionError,
	} = useHostingPhpVersion( remoteSite.id, { skip: type !== 'push' || remoteSite.isPressable } );

	const shouldShowPhpVersionMismatch =
		type === 'push' &&
		! isLoadingRemotePhpVersion &&
		! isRemotePhpVersionError &&
		hasVersionMismatch(
			localSite.phpVersion,
			remoteSite.isPressable ? PRESSABLE_PHP_VERSION : remotePhpVersion
		);

	const [ wpVersion ] = useGetWpVersion( localSite );
	const shouldShowWpVersionMismatch =
		type === 'push' && hasVersionMismatch( wpVersion, remoteSite.wpVersion );

	let versionMismatchNotice = '';
	if ( shouldShowPhpVersionMismatch && shouldShowWpVersionMismatch ) {
		versionMismatchNotice = __(
			'Your Studio site is using different WordPress and PHP versions than your remote site. The remote site will keep using the newest supported versions.'
		);
	} else if ( shouldShowPhpVersionMismatch ) {
		versionMismatchNotice = __(
			'Your Studio site is using a different PHP version than your remote site. The remote site will keep using the newest supported version.'
		);
	} else if ( shouldShowWpVersionMismatch ) {
		versionMismatchNotice = __(
			'Your Studio site is using a different WordPress version than your remote site. The remote site will keep using the newest supported version.'
		);
	}

	const isMultisite = useIsMultisite( localSite );
	const shouldShowMultisiteWarning = type === 'push' && isMultisite && ! remoteSite.isPressable;

	const warningCount = [ versionMismatchNotice, shouldShowMultisiteWarning ].filter(
		Boolean
	).length;
	const [ warningsExpanded, setWarningsExpanded ] = useState( true );

	const localSiteName = <SiteNameBox siteName={ localSite.name } envType="studio" />;
	const remoteSiteName = <SiteNameBox siteName={ remoteSite.name } envType={ siteEnv } />;

	let syncFrom, syncTo, syncFromText, syncToText, tooltipNoRewindId;
	if ( type === 'push' ) {
		syncFrom = localSiteName;
		syncTo = remoteSiteName;
		syncFromText = localSite.name;
		syncToText = remoteSite.name;
	} else {
		syncFrom = remoteSiteName;
		syncTo = localSiteName;
		syncFromText = remoteSite.name;
		syncToText = localSite.name;
		tooltipNoRewindId = createInterpolateElement(
			__(
				'Selecting individual items to pull will be enabled automatically once your first backup is complete.<br/>Wait a few minutes or run a full sync in the meantime.'
			),
			{ br: <br /> }
		);
	}

	const handleExpanderChange = useCallback(
		( value: boolean ) => {
			setShowAllFiles( value );

			const previousFilesAndFolders = treeState.find( ( node ) => node.id === 'filesAndFolders' );
			const toUpdate: { expanded: boolean; checked?: boolean } = {
				...previousFilesAndFolders,
				expanded: value,
			};

			if ( ! value && previousFilesAndFolders ) {
				toUpdate.checked = previousFilesAndFolders.checked || previousFilesAndFolders.indeterminate;
			}

			setTreeState( ( prev ) => updateNodeById( prev, 'filesAndFolders', toUpdate ) );
		},
		[ treeState ]
	);

	const handleExpand = useCallback(
		async ( node: TreeNode ) => {
			if ( node.hideExpandButton ) {
				return;
			}

			if ( type === 'pull' && rewindId && node.path && node.children?.length === 0 ) {
				// Set loading state for the node
				setTreeState( ( prev ) => updateNodeById( prev, node.id, { loading: true } ) );

				try {
					const children = await fetchChildren( remoteSite.id, rewindId, node.path, node.checked );
					setTreeState( ( prev ) =>
						updateNodeById( prev, node.id, { children, loading: false, hasError: false } )
					);
				} catch ( error ) {
					setTreeState( ( prev ) =>
						updateNodeById( prev, node.id, {
							children: [],
							loading: false,
							hasError: true,
						} )
					);
				}
			}
			// For push operations, children are already loaded - no async fetching needed
		},
		[ type, rewindId, remoteSite.id, fetchChildren ]
	);

	const handleSubmit = () => {
		if ( type === 'pull' ) {
			onPull( treeState );
		} else {
			onPush( treeState );
		}

		onRequestClose();
	};

	const getBottomPadding = () => {
		if ( type === 'pull' ) {
			return 70;
		}
		let padding = 140; // Base: progress bar + buttons
		if ( isPushSelectionOverLimit ) {
			padding += 80;
		}
		if ( warningCount > 0 ) {
			padding += warningsExpanded ? 70 * warningCount + 30 : 20;
		}
		return padding;
	};

	return (
		<Modal
			className="w-3/5 min-w-[550px] max-h-[84vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ syncTexts.title }
		>
			<div style={ { paddingBottom: getBottomPadding() } }>
				<div className="px-8 pb-6 pt-1">{ syncTexts.description }</div>
				<div className="px-8">
					<span className="sr-only">
						{ /* translators: %1$s is the source site name, %2$s is the destination site name */ }
						{ sprintf( __( 'From %1$s to %2$s' ), syncFromText, syncToText ) }
					</span>
					<div
						aria-hidden="true"
						className="flex max-w-full overflow-hidden pb-6 border-b border-frame-border"
					>
						<div className="overflow-hidden max-w-[calc(50%-25px)]">
							<div className="whitespace-nowrap truncate">{ syncFrom }</div>
						</div>
						<div className="w-[50px] flex items-center justify-center text-frame-text-secondary">
							<RightArrowIcon />
						</div>
						<div className="overflow-hidden max-w-[calc(50%-25px)]">
							<div className="whitespace-nowrap truncate">{ syncTo }</div>
						</div>
					</div>
				</div>
				<Heading
					level={ 2 }
					lineHeight="28px"
					size={ 11 }
					weight={ 500 }
					upperCase
					className="px-8 pt-5 pb-3"
				>
					{ syncTexts.subtitleSelector }
				</Heading>
				<Tooltip
					className={ cx( 'w-full', isErrorRewindId && 'cursor-not-allowed' ) }
					text={ tooltipNoRewindId }
					disabled={ ! isErrorRewindId }
				>
					<div className="px-8 pb-2 relative">
						{ type === 'pull' && isLoadingRewindId && <TreeViewLoadingSkeleton /> }
						{ type === 'push' && isLoadingLocalFileTree && <TreeViewLoadingSkeleton /> }
						{ ! isLoadingRewindId && ! isLoadingLocalFileTree && (
							<>
								<div className="absolute end-6 z-10 top-[6px]">
									<SelectControl
										value={ showAllFiles ? 'true' : 'false' }
										variant="minimal"
										options={ [
											{
												label: __( 'All files and folders' ),
												value: 'false',
											},
											{
												label: __( 'Specific files and folders' ),
												value: 'true',
											},
										] }
										onChange={ ( value ) => handleExpanderChange( value === 'true' ) }
										disabled={ isErrorRewindId }
										__next40pxDefaultSize
										__nextHasNoMarginBottom
										aria-label={ __( 'Select files and folders to sync' ) }
										className="h-9 select-minimal"
									/>
								</div>
								<TreeView
									disabled={ isErrorRewindId }
									tree={ treeState }
									setTree={ setTreeState }
									onExpand={ handleExpand }
									renderAfterChildren={ ( nodeId ) => {
										if ( nodeId === 'filesAndFolders' && showAllFiles && rewindId ) {
											const backupUrl = `https://wordpress.com/backup/${ remoteSite.url.replace(
												/^https?:\/\//,
												''
											) }`;
											const backupDate = format( parseInt( rewindId ) * 1000, 'MMM d, y, h:mm a' );
											return (
												<div className="mt-2 pb-2 text-xs text-frame-text-secondary">
													{ sprintf( __( 'Content from the latest backup: %s.' ), backupDate ) }{ ' ' }
													<Button
														variant="link"
														className="p-0 h-auto text-xs"
														onClick={ () => getIpcApi().openURL( backupUrl ) }
													>
														{ __( 'Create new backup ↗' ) }
													</Button>
												</div>
											);
										}
										return null;
									} }
									renderEmptyContent={ ( nodeId, node ) => {
										if ( nodeId === 'wp-content' && type === 'push' && localFileTreeError ) {
											return (
												<div className="text-frame-text-secondary italic">
													{ __(
														'Could not load files. Please close and reopen this dialog to try again.'
													) }
												</div>
											);
										}
										if (
											( nodeId === 'wp-content' && type === 'pull' && remoteFileTreeError ) ||
											node.hasError
										) {
											return (
												<div className="text-frame-text-secondary italic">
													{ __(
														'Error retrieving remote files and directories. Please close and reopen this dialog to try again.'
													) }
												</div>
											);
										}
										return (
											<div
												className="text-frame-text-secondary italic"
												aria-label={ __( 'Empty folder' ) }
											>
												{ __( 'Empty' ) }
											</div>
										);
									} }
								/>
							</>
						) }
					</div>
				</Tooltip>

				<div className="px-8 py-4 absolute left-0 right-0 bottom-0 bg-frame z-10 border-t border-frame-border">
					{ type === 'push' && (
						<div className="mb-4">
							<TwoColorProgressBar
								value={ totalSize }
								maxValue={ limitBytes }
								showLabels
								valueLabel={ formattedSize }
								limitLabel={ formattedLimit }
								// translators: %s is a filesize string, e.g. "1.3GB". This label is displayed if a sync
								// archive is larger than a given limit.
								overLimitLabel={ sprintf( __( '%s over' ), formattedOverAmount ) }
							/>
						</div>
					) }
					{ type === 'push' && isPushSelectionOverLimit && (
						<Notice status="warning" isDismissible={ false } className="mb-4">
							<p data-testid="push-selection-over-limit-notice">
								{ sprintf(
									__(
										'The current selection exceeds the %d GB push limit. To continue, please change your selection to reduce the total size.'
									),
									SYNC_PUSH_SIZE_LIMIT_GB
								) }
							</p>
						</Notice>
					) }
					{ warningCount > 0 && (
						<div className="mb-4" data-testid="push-warnings-section">
							<div
								className="flex items-center gap-1 text-amber-500 text-[13px] leading-[16px]"
								data-testid="push-warnings-toggle"
							>
								<Icon icon={ cautionFilled } size={ 16 } className="fill-amber-500" />
								{ sprintf(
									/* translators: %d: number of warnings */
									_n( '%d warning', '%d warnings', warningCount ),
									warningCount
								) }
								<Button
									variant="link"
									className="!p-0 !h-auto text-[12px] leading-[16px] [&.is-link]:text-frame-text-secondary [&.is-link]:hover:text-frame-theme"
									onClick={ () => setWarningsExpanded( ! warningsExpanded ) }
								>
									{ warningsExpanded ? __( 'Hide' ) : __( 'Show' ) }
								</Button>
							</div>
							{ warningsExpanded && (
								<div className="mt-2 flex flex-col gap-2">
									{ versionMismatchNotice && (
										<Notice status="warning" isDismissible={ false }>
											<p data-testid="push-version-mismatch-notice">{ versionMismatchNotice }</p>
										</Notice>
									) }
									{ shouldShowMultisiteWarning && (
										<Notice status="warning" isDismissible={ false }>
											<p data-testid="push-multisite-warning-notice">
												{ __(
													'Your Studio site is configured as a multisite network. WordPress.com does not support multisite, so pushing may cause unexpected issues on the remote site.'
												) }
											</p>
										</Notice>
									) }
								</div>
							) }
						</div>
					) }
					<div className="flex justify-between items-center">
						<div>
							{ createInterpolateElement( syncTexts.envSync, {
								a: (
									<Button
										variant="link"
										onClick={ () =>
											getIpcApi().openURL( getLocalizedLink( locale, 'docsSync' ) + '#' + type )
										}
									/>
								),
								ArrowIcon: <ArrowIcon />,
							} ) }
						</div>
						<div>
							<div className="flex gap-4 justify-end">
								<Button variant="link" onClick={ onRequestClose }>
									{ __( 'Cancel' ) }
								</Button>
								<Button
									variant="primary"
									onClick={ handleSubmit }
									disabled={
										isSubmitDisabled ||
										isLoadingRewindId ||
										isPushSelectionOverLimit ||
										isSizeCheckLoading
									}
									data-testid={ `sync-dialog-${ type }-button` }
								>
									{ syncTexts.submit }
								</Button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</Modal>
	);
}
