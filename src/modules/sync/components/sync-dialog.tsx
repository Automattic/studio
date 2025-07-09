import { SelectControl } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useEffect, useMemo } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { getSiteEnvironment } from 'src/components/environment-badge';
import { RightArrowIcon } from 'src/components/icons/right-arrow';
import Modal from 'src/components/modal';
import { TreeView, TreeNode, updateNodeById } from 'src/components/tree-view';
import { SYNC_OPTIONS } from 'src/constants';
import { useContentFolders } from 'src/hooks/use-content-folders';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { GRANULAR_SYNC_FOLDERS } from 'src/modules/sync/constants';
import { useDefaultSyncTree } from 'src/modules/sync/hooks/use-default-sync-tree';
import { useSyncDialogTexts } from 'src/modules/sync/hooks/use-sync-dialog-texts';
import { useI18nLocale } from 'src/stores';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';
import { SiteNameBox } from 'src/modules/sync/components/site-name-box';

type SyncDialogProps = {
	type: 'push' | 'pull';
	localSite: SiteDetails;
	remoteSite: SyncSite;
	onSubmit: ( syncData: TreeNode[] ) => void;
	onRequestClose: () => void;
};

const useDynamicTreeState = (
	type: 'push' | 'pull',
	localSiteId: string,
	setTreeState: React.Dispatch< React.SetStateAction< TreeNode[] > >
) => {
	const wpFolders = useMemo( () => [ ...GRANULAR_SYNC_FOLDERS ], [] );
	const wpContent = useContentFolders( localSiteId, wpFolders );

	useEffect( () => {
		if ( type === 'pull' ) {
			return;
		}

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
							checked: true,
							type: item.type,
					  } ) );

				newState = updateNodeById( newState, SYNC_OPTIONS[ wpType ], {
					loading: isLoading,
					children,
				} );
			} );

			return newState;
		} );
	}, [ type, wpContent, setTreeState, wpFolders ] );
};

export function SyncDialog( {
	type,
	localSite,
	remoteSite,
	onSubmit,
	onRequestClose,
}: SyncDialogProps ) {
	const locale = useI18nLocale();
	const { __ } = useI18n();
	const copy = useSyncDialogTexts( type );
	const defaultTree = useDefaultSyncTree();

	const [ showAllFiles, setShowAllFiles ] = useState( false );
	const [ treeState, setTreeState ] = useState< TreeNode[] >( defaultTree );
	const isSubmitDisabled = treeState.every( ( node ) => ! node.checked && ! node.indeterminate );

	useDynamicTreeState( type, localSite.id, setTreeState );

	const siteEnv = getSiteEnvironment( remoteSite );

	const localSiteName = <SiteNameBox siteName={ localSite.name } envType="studio" />;
	const remoteSiteName = <SiteNameBox siteName={ remoteSite.name } envType={ siteEnv } />;

	let syncFrom, syncTo, syncFromText, syncToText;
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
	}

	const handleExpanderChange = ( value: boolean ) => {
		setShowAllFiles( value );

		const toUpdate: { expanded: boolean; checked?: boolean } = { expanded: value };

		if ( ! value ) {
			toUpdate.checked = true;
		}

		setTreeState( ( prev ) => updateNodeById( prev, 'filesAndFolders', toUpdate ) );
	};

	const handleSubmit = () => {
		onSubmit( treeState );

		onRequestClose();
	};

	return (
		<Modal
			className="sync-dialog-wrapper w-3/5 min-w-[550px] h-full max-h-[84vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ copy[ siteEnv ].title }
		>
			<div className="pb-[70px]">
				<div className="px-8 pb-6 pt-3">{ copy[ siteEnv ].description }</div>
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
							<div className="leading-[32px]">{ copy.fromLabel }</div>
							<div className="whitespace-nowrap truncate">{ syncFrom }</div>
						</div>
						<div className="mt-[32px] w-[50px] flex items-center justify-center text-a8c-gray-600">
							<RightArrowIcon />
						</div>
						<div className="overflow-hidden max-w-[calc(50%-25px)]">
							<div className="leading-[32px]">{ copy.toLabel }</div>
							<div className="whitespace-nowrap truncate">{ syncTo }</div>
						</div>
					</div>
				</div>
				<div className="px-8 pt-7 pb-3">{ copy.subtitleSelector }</div>
				<div className="px-8 pb-2 relative">
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
							__next40pxDefaultSize
							__nextHasNoMarginBottom
							aria-label={ __( 'Select files and folders to sync' ) }
							className="h-9"
						/>
					</div>
					<TreeView tree={ treeState } setTree={ setTreeState } />
				</div>
				<div className="flex px-8 py-4 border-t border-a8c-gray-5 justify-between items-center absolute left-0 right-0 bottom-0 bg-white z-10">
					<div>
						{ createInterpolateElement( copy.envSync, {
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
							<Button variant="primary" onClick={ handleSubmit } disabled={ isSubmitDisabled }>
								{ copy.submit }
							</Button>
						</div>
					</div>
				</div>
			</div>
		</Modal>
	);
}
