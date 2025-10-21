import { SelectControl, Notice, __experimentalHeading as Heading } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf, __ } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { format } from 'date-fns';
import { useState, useEffect, useMemo } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { RightArrowIcon } from 'src/components/icons/right-arrow';
import Modal from 'src/components/modal';
import { Tooltip } from 'src/components/tooltip';
import { TreeView, TreeNode, updateNodeById } from 'src/components/tree-view';
import { SYNC_OPTIONS, SYNC_PUSH_SIZE_LIMIT_GB } from 'src/constants';
import { useContentFolders } from 'src/hooks/use-content-folders';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { SiteNameBox } from 'src/modules/sync/components/site-name-box';
import { GRANULAR_SYNC_FOLDERS } from 'src/modules/sync/constants';
import { useDefaultSyncTree } from 'src/modules/sync/hooks/use-default-sync-tree';
import { useSelectedItemsPushSize } from 'src/modules/sync/hooks/use-selected-items-push-size';
import { useSyncDialogTexts } from 'src/modules/sync/hooks/use-sync-dialog-texts';
import { getSiteEnvironment } from 'src/modules/sync/lib/environment-utils';
import { useI18nLocale } from 'src/stores';
import { useLatestRewindId, useRemoteFileTree } from 'src/stores/sync';
import { TreeViewLoadingSkeleton } from './tree-view-loading-skeleton';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

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
	const wpFolders = useMemo( () => [ ...GRANULAR_SYNC_FOLDERS ], [] );
	const wpContent = useContentFolders( localSiteId, wpFolders );
	const {
		rewindId,
		isLoading: isLoadingRewindId,
		isError: isErrorRewindId,
	} = useLatestRewindId( remoteSiteId, {
		skip: type === 'push',
	} );
	const { fetchChildren } = useRemoteFileTree();

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
				try {
					if ( rewindId ) {
						const remoteTree = await fetchChildren( remoteSiteId, rewindId, '/wp-content/', false );
						if ( ! isCancelled ) {
							setTreeState( ( treeState ) =>
								updateNodeById( treeState, 'wp-content', { children: remoteTree || [] } )
							);
						}
					}
				} catch ( error ) {
					console.error( 'Failed to load remote file tree:', error );
				}
			};
			void loadRemoteTree();
			return () => {
				isCancelled = true;
			};
		}

		if ( type === 'push' ) {
			setTreeState( ( prev ) => {
				let newState = [ ...prev ];

				wpFolders.forEach( ( wpType ) => {
					const { items, isLoading, error } = wpContent[ wpType ];
					const children: TreeNode[] | undefined = error
						? undefined
						: items.map( ( item ) => ( {
								id: `${ wpType }-${ item.name }`,
								name: item.name,
								label: item.name,
								checked: false,
								type: item.type,
						  } ) );

					newState = updateNodeById( newState, SYNC_OPTIONS[ wpType ], {
						loading: isLoading,
						children,
					} );
				} );

				return newState;
			} );
		}
	}, [ type, wpContent, setTreeState, wpFolders, remoteSiteId, rewindId, fetchChildren ] );

	return { rewindId, fetchChildren, isLoadingRewindId, isErrorRewindId };
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
	const { __ } = useI18n();
	const siteEnv = getSiteEnvironment( remoteSite );
	const syncTexts = useSyncDialogTexts( type, siteEnv );
	const defaultTree = useDefaultSyncTree();

	const [ showAllFiles, setShowAllFiles ] = useState( false );
	const [ treeState, setTreeState ] = useState< TreeNode[] >( defaultTree );
	const isSubmitDisabled = treeState.every( ( node ) => ! node.checked && ! node.indeterminate );
	const { isPushSelectionOverLimit, isLoading: isSizeCheckLoading } = useSelectedItemsPushSize(
		localSite.id,
		treeState,
		type
	);

	const { fetchChildren, rewindId, isLoadingRewindId, isErrorRewindId } = useDynamicTreeState(
		type,
		localSite.id,
		remoteSite.id,
		setTreeState
	);

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

	const handleExpanderChange = ( value: boolean ) => {
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
	};

	const handleExpand = async ( node: TreeNode ) => {
		if ( type === 'pull' && rewindId && node.path && node.children?.length === 0 ) {
			const children = await fetchChildren( remoteSite.id, rewindId, node.path, node.checked );
			if ( children ) {
				setTreeState( ( prev ) => updateNodeById( prev, node.id, { children } ) );
			}
		}
	};

	const handleSubmit = () => {
		if ( type === 'pull' ) {
			if ( ! rewindId ) {
				return;
			}
			onPull( treeState );
		} else {
			onPush( treeState );
		}

		onRequestClose();
	};

	return (
		<Modal
			className="sync-dialog-wrapper w-3/5 min-w-[550px] h-full max-h-[84vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ syncTexts.title }
		>
			<div className={ isPushSelectionOverLimit ? 'pb-[140px]' : 'pb-[70px]' }>
				<div className="px-8 pb-6 pt-3">{ syncTexts.description }</div>
				<div className="px-8">
					<span className="sr-only">
						{ /* translators: first %s is the source site name, second %s is the destination site name */ }
						{ sprintf( __( 'From %s to %s' ), syncFromText, syncToText ) }
					</span>
					<div
						aria-hidden="true"
						className="flex max-w-full overflow-hidden pb-6 border-b border-a8c-gray-5"
					>
						<div className="overflow-hidden max-w-[calc(50%-25px)]">
							<div className="whitespace-nowrap truncate">{ syncFrom }</div>
						</div>
						<div className="w-[50px] flex items-center justify-center text-a8c-gray-600">
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
					className="px-8 pt-7 pb-3"
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
						{ ! isLoadingRewindId && (
							<>
								<div className="absolute end-6 z-10">
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
										className="h-9"
									/>
								</div>
								<TreeView
									disabled={ isErrorRewindId }
									tree={ treeState }
									setTree={ setTreeState }
									onExpand={ handleExpand }
									renderBeforeChildren={ ( nodeId ) => {
										if ( nodeId === 'filesAndFolders' && showAllFiles && rewindId ) {
											const backupUrl = `https://wordpress.com/backup/${ remoteSite.url.replace(
												/^https?:\/\//,
												''
											) }`;
											const backupDate = format( parseInt( rewindId ) * 1000, 'MMM d, h:mm a' );
											return (
												<div className="mt-2 pb-2 text-xs text-gray-600">
													{ sprintf(
														__( 'Listing files from the latest backup: %s.' ),
														backupDate
													) }{ ' ' }
													<Button
														variant="link"
														className="p-0 h-auto text-xs"
														onClick={ () => getIpcApi().openURL( backupUrl ) }
													>
														{ __( 'Create fresh backup now ↗' ) }
													</Button>
												</div>
											);
										}
										return null;
									} }
								/>
							</>
						) }
					</div>
				</Tooltip>

				<div className="px-8 py-4 border-t border-a8c-gray-5 absolute left-0 right-0 bottom-0 bg-white z-10">
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
