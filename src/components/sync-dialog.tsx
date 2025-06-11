import { SelectControl } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { ArrowIcon } from 'src/components/arrow-icon';
import Button from 'src/components/button';
import { RightArrowIcon } from 'src/components/icons/right-arrow';
import Modal from 'src/components/modal';
import { TreeView, TreeNode } from 'src/components/tree-view';
import { useI18nData } from 'src/hooks/use-i18n-data';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getLocalizedLink } from 'src/lib/get-localized-link';
import { CircleProdIcon } from './icons/circle-prod';
import { CircleStagingIcon } from './icons/circle-staging';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

const useCopy = ( type: 'pull' | 'push' ) => {
	const { __ } = useI18n();

	if ( type === 'pull' ) {
		return {
			staging: {
				title: __( 'Pull from Staging' ),
				description: __(
					"Pulling will replace your Studio site's files and database with a copy from your staging site."
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
};

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
	const { locale } = useI18nData();
	const copy = useCopy( type );
	const [ showAllFiles, setShowAllFiles ] = useState( false );

	const [ treeState, setTreeState ] = useState< TreeNode[] >( [
		{
			id: 'filesAndFolders',
			label: __( 'Files and folders' ),
			checked: true,
			indeterminate: false,
			expanded: false,
			disableExpand: true,
			children: [
				{
					id: 'wp-content',
					label: 'wp-content',
					checked: true,
					indeterminate: false,
					type: 'folder',
					children: [
						{
							id: 'plugins',
							label: 'plugins',
							checked: true,
							type: 'folder',
							children: [
								{ id: 'akismet', label: 'akismet', checked: true, type: 'folder' },
								{ id: 'jetpack', label: 'jetpack', checked: true, type: 'folder' },
							],
						},
						{
							id: 'themes',
							label: 'themes',
							checked: true,
							type: 'folder',
						},
						{
							id: 'uploads',
							label: 'uploads',
							checked: true,
							type: 'folder',
						},
					],
				},
			],
		},
		{
			id: 'database',
			label: 'Database',
			checked: true,
		},
	] );

	const remoteSiteType = remoteSite.isStaging ? 'staging' : 'production';

	const localSiteName = localSite.name;
	const remoteSiteName = (
		<div className="flex items-center gap-2 flex-wrap">
			<span className="flex-shrink-0">
				{ remoteSite.isStaging ? <CircleStagingIcon /> : <CircleProdIcon /> }
			</span>
			<span>{ remoteSite.isStaging ? __( 'Staging' ) : __( 'Production' ) }</span>
			<span className="text-gray-600 break-all">
				{ remoteSite.url.replace( /https?:\/\//, '' ) }
			</span>
		</div>
	);

	const syncFrom = type === 'push' ? localSiteName : remoteSiteName;
	const syncTo = type === 'push' ? remoteSiteName : localSiteName;

	const handleExpanderChange = ( value: 'expanded' | 'collapsed' ) => {
		setShowAllFiles( value === 'expanded' );
		setTreeState( ( prev ) =>
			prev.map( ( node ) => {
				if ( node.id === 'filesAndFolders' ) {
					return {
						...node,
						expanded: value === 'expanded',
						children: node.children?.map( ( child ) => ( {
							...child,
							expanded: value === 'expanded',
							children: child.children?.map( ( grandChild ) => ( {
								...grandChild,
								expanded: value === 'expanded',
							} ) ),
						} ) ),
					};
				}
				return node;
			} )
		);
	};

	const handleSubmit = () => {
		onSubmit( treeState );

		onRequestClose();
	};

	return (
		<Modal
			className="w-3/5 min-w-[550px] h-full max-h-[84vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ copy[ remoteSiteType ].title }
		>
			<div className="pb-[70px]">
				<div className="px-8 pb-6 pt-2">{ copy[ remoteSiteType ].description }</div>
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
					<div className="absolute end-2 top-2">
						<SelectControl
							value={ showAllFiles ? 'expanded' : 'collapsed' }
							variant="minimal"
							options={ [
								{
									label: __( 'All files and folders' ),
									value: 'collapsed',
								},
								{
									label: __( 'Specific files and folders' ),
									value: 'expanded',
								},
							] }
							onChange={ handleExpanderChange }
							__next40pxDefaultSize
							__nextHasNoMarginBottom
						/>
					</div>
					<TreeView tree={ treeState } setTree={ setTreeState } />
				</div>
				<div className="flex px-8 py-4 border-t border-a8c-gray-5 justify-between items-center absolute left-0 right-0 bottom-0 bg-white">
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
