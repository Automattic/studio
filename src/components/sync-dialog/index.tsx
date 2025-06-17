import { SelectControl } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useEffect } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { CircleEnvIcon } from 'src/components/icons/circle-env';
import { RightArrowIcon } from 'src/components/icons/right-arrow';
import Modal from 'src/components/modal';
import { TreeView, TreeNode, updateNodeById } from 'src/components/tree-view';
import { SYNC_OPTIONS } from 'src/hooks/sync-sites/sync-option';
import { useWpList } from 'src/hooks/use-wp-list';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { useI18nLocale } from 'src/stores';
import { useCopy } from './use-copy';
import { useDefaultTree } from './use-default-tree';
import { useEnvDetails } from './use-env-details';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

type SyncDialogProps = {
	type: 'push' | 'pull';
	localSite: SiteDetails;
	remoteSite: SyncSite;
	onSubmit: ( syncData: TreeNode[] ) => void;
	onRequestClose: () => void;
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
	const copy = useCopy( type );
	const defaultTree = useDefaultTree();

	const [ showAllFiles, setShowAllFiles ] = useState( false );
	const [ treeState, setTreeState ] = useState< TreeNode[] >( defaultTree );
	const {
		items: plugins,
		isLoading: isLoadingPlugins,
		error: pluginsError,
	} = useWpList( localSite.id, 'plugin' );
	const {
		items: themes,
		isLoading: isLoadingThemes,
		error: themesError,
	} = useWpList( localSite.id, 'theme' );

	// Update the plugins tree state when the plugins are loaded
	useEffect( () => {
		if ( type === 'pull' ) {
			return;
		}

		setTreeState( ( prev ) => {
			const newState = [ ...prev ];
			const pluginsChildren: TreeNode[] | undefined = pluginsError
				? undefined
				: plugins.map( ( plugin ) => ( {
						id: plugin,
						label: plugin,
						checked: true,
						type: 'folder',
				  } ) );
			const updated = updateNodeById( newState, SYNC_OPTIONS.plugins, {
				loading: isLoadingPlugins,
				children: pluginsChildren,
			} );

			return updated;
		} );
	}, [ type, plugins, isLoadingPlugins, pluginsError ] );

	// Update the themes tree state when the themes are loaded
	useEffect( () => {
		if ( type === 'pull' ) {
			return;
		}

		setTreeState( ( prev ) => {
			const newState = [ ...prev ];
			const themesChildren: TreeNode[] | undefined = themesError
				? undefined
				: themes.map( ( theme ) => ( {
						id: theme,
						label: theme,
						checked: true,
						type: 'folder',
				  } ) );
			const updated = updateNodeById( newState, SYNC_OPTIONS.themes, {
				loading: isLoadingThemes,
				children: themesChildren,
			} );

			return updated;
		} );
	}, [ type, themes, isLoadingThemes, themesError ] );

	const envDetails = useEnvDetails( remoteSite );

	const localSiteName = localSite.name;
	const remoteSiteName = (
		<div className="flex items-center gap-2 flex-wrap">
			<span className="flex-shrink-0">
				<CircleEnvIcon fillClass={ envDetails.fillClass } />
			</span>
			<span>{ envDetails.label }</span>
			<span className="text-gray-600 break-all">
				{ remoteSite.url.replace( /https?:\/\//, '' ) }
			</span>
		</div>
	);

	const syncFrom = type === 'push' ? localSiteName : remoteSiteName;
	const syncTo = type === 'push' ? remoteSiteName : localSiteName;

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
			title={ copy[ envDetails.envType ].title }
		>
			<div className="pb-[70px]">
				<div className="px-8 pb-6 pt-2">{ copy[ envDetails.envType ].description }</div>
				<div className="px-8">
					<div className="flex items-start gap-1 pb-7 border-b border-a8c-gray-5">
						<div className="flex-1">
							<div className="leading-[32px]">{ copy.fromLabel }</div>
							<div className="border border-gray-300 rounded-[2px] min-h-12 px-[19px] flex items-center py-2 break-all">
								{ syncFrom }
							</div>
						</div>
						<div className="w-10 mt-[32px] h-12 flex items-center justify-center">
							<RightArrowIcon />
						</div>
						<div className="flex-1">
							<div className="leading-[32px]">{ copy.toLabel }</div>
							<div className="border border-gray-300 rounded-[2px] min-h-12 px-[19px] flex items-center py-2 break-all">
								{ syncTo }
							</div>
						</div>
					</div>
				</div>
				<div className="px-8 pt-7 pb-3">{ copy.subtitleSelector }</div>
				<div className="px-8 relative">
					<div className="absolute end-6 top-2 z-10">
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
							<Button variant="primary" onClick={ handleSubmit }>
								{ copy.submit }
							</Button>
						</div>
					</div>
				</div>
			</div>
		</Modal>
	);
}
