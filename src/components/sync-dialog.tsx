import { SelectControl } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { useI18n } from '@wordpress/react-i18n';
import { useState, useEffect, useMemo } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { RightArrowIcon } from 'src/components/icons/right-arrow';
import Modal from 'src/components/modal';
import { TreeView, TreeNode, updateNodeById } from 'src/components/tree-view';
import { SYNC_OPTIONS } from 'src/hooks/sync-sites/sync-option';
import { useContentFolders, WpContentFolder } from 'src/hooks/use-content-folders';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { useI18nLocale } from 'src/stores';
import { EnvironmentBadge, getSiteEnvironment } from './environment-badge';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

const useCopy = ( type: 'pull' | 'push' ) => {
	const { __ } = useI18n();

	return useMemo( () => {
		if ( type === 'pull' ) {
			return {
				staging: {
					title: __( 'Pull from Staging' ),
					description: __(
						"Pulling will replace your Studio site's files and database with a copy from your staging site."
					),
				},
				sandbox: {
					title: __( 'Pull from Sandbox' ),
					description: __(
						"Pulling will replace your Studio site's files and database with a copy from your sandbox site."
					),
				},
				production: {
					title: __( 'Pull from Production' ),
					description: __(
						"Pulling will replace your Studio site's files and database with a copy from your production site."
					),
				},
				fromLabel: __( 'Pull' ),
				toLabel: __( 'To' ),
				subtitleSelector: __( 'What would you like to pull?' ),
				envSync: __( 'Read more about <a>environment pull <ArrowIcon /></a>' ),
				submit: __( 'Pull' ),
			};
		} else {
			return {
				staging: {
					title: __( 'Push to Staging' ),
					description: __(
						'Pushing will replace the existing files and database with a copy from your local site.\n\n The staging site will be backed-up before any changes are applied.'
					),
				},
				sandbox: {
					title: __( 'Push to Sandbox' ),
					description: __(
						'Pushing will replace the existing files and database with a copy from your local site.\n\n The sandbox site will be backed-up before any changes are applied.'
					),
				},
				production: {
					title: __( 'Push to Production' ),
					description: __(
						'Pushing will replace the existing files and database with a copy from your local site.\n\n The production site will be backed-up before any changes are applied.'
					),
				},
				fromLabel: __( 'Push' ),
				toLabel: __( 'To' ),
				subtitleSelector: __( 'What would you like to push?' ),
				envSync: __( 'Read more about <a>environment push <ArrowIcon /></a>' ),
				submit: __( 'Push' ),
			};
		}
	}, [ type, __ ] );
};

type SyncDialogProps = {
	type: 'push' | 'pull';
	localSite: SiteDetails;
	remoteSite: SyncSite;
	onSubmit: ( syncData: TreeNode[] ) => void;
	onRequestClose: () => void;
};

export const useDefaultTree = (): TreeNode[] => {
	const { __ } = useI18n();

	return useMemo( () => {
		return [
			{
				id: 'filesAndFolders',
				label: __( 'Files and folders' ),
				checked: true,
				indeterminate: false,
				expanded: false,
				hideExpandButton: true,
				children: [
					{
						id: 'wp-content',
						label: 'wp-content',
						checked: true,
						indeterminate: false,
						type: 'folder',
						children: [
							{
								id: SYNC_OPTIONS.plugins,
								label: 'plugins',
								checked: true,
								type: 'folder',
							},
							{
								id: SYNC_OPTIONS.themes,
								label: 'themes',
								checked: true,
								type: 'folder',
							},
							{
								id: SYNC_OPTIONS.uploads,
								label: 'uploads',
								checked: true,
								type: 'folder',
							},
							{
								id: SYNC_OPTIONS.contents,
								label: __( 'Other files and directories' ),
								checked: true,
								type: 'more',
							},
						],
					},
				],
			},
			{
				id: SYNC_OPTIONS.sqls,
				label: __( 'Database' ),
				checked: true,
			},
		];
	}, [ __ ] );
};

const useDynamicTreeState = (
	type: 'push' | 'pull',
	localSiteId: string,
	setTreeState: React.Dispatch< React.SetStateAction< TreeNode[] > >
) => {
	const wpFolders: WpContentFolder[] = useMemo( () => [ 'plugins', 'themes' ], [] );
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
							id: item.name,
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
	const copy = useCopy( type );
	const defaultTree = useDefaultTree();

	const [ showAllFiles, setShowAllFiles ] = useState( false );
	const [ treeState, setTreeState ] = useState< TreeNode[] >( defaultTree );

	useDynamicTreeState( type, localSite.id, setTreeState );

	const siteEnv = getSiteEnvironment( remoteSite );

	const localSiteName = localSite.name;
	const remoteSiteName = (
		<div>
			<span className="inline-block">
				<EnvironmentBadge type={ siteEnv } />
			</span>
			<span className="text-gray-600"> { remoteSite.name } </span>
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
			title={ copy[ siteEnv ].title }
		>
			<div className="pb-[70px]">
				<div className="px-8 pb-6 pt-2">{ copy[ siteEnv ].description }</div>
				<div className="px-8">
					<div className="flex items-start gap-1 pb-7 border-b border-a8c-gray-5">
						<div className="flex-1">
							<div className="leading-[32px]">{ copy.fromLabel }</div>
							<div className="border border-gray-300 rounded-[2px] min-h-12 px-[19px] flex items-center py-2">
								{ syncFrom }
							</div>
						</div>
						<div className="w-10 mt-[32px] h-12 flex items-center justify-center">
							<RightArrowIcon />
						</div>
						<div className="flex-1">
							<div className="leading-[32px]">{ copy.toLabel }</div>
							<div className="border border-gray-300 rounded-[2px] min-h-12 px-[19px] flex items-center py-2">
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
							aria-label={ __( 'Select files and folders to sync' ) }
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
