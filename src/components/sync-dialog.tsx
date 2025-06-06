import { SelectControl } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { useEffect, useState } from 'react';
import Button from 'src/components/button';
import { RightArrowIcon } from 'src/components/icons/right-arrow';
import Modal from 'src/components/modal';
import { TreeView, TreeNode } from 'src/components/tree-view';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { CircleProdIcon } from './icons/circle-prod';
import { CircleStagingIcon } from './icons/circle-staging';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

const allCopy = {
	pull: {
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
		fromLabel: __( 'Pull from' ),
		toLabel: __( 'To' ),
		subtitleSelector: __( 'What would you like to pull?' ),
		submit: __( 'Pull' ),
	},
	push: {
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
		submit: __( 'Push' ),
	},
};

type SyncDialogProps = {
	type: 'push' | 'pull';
	localSite: SiteDetails;
	remoteSite: SyncSite;
	onSubmit: ( syncData: TreeNode[] ) => void;
	onRequestClose: () => void;
};

export function SyncDialog( {
	type = 'push',
	localSite,
	remoteSite,
	onSubmit,
	onRequestClose,
}: SyncDialogProps ) {
	const [ treeState, setTreeState ] = useState< TreeNode[] >( [
		{
			id: 'filesAndFolders',
			label: 'Files and folders',
			checked: true,
			indeterminate: false,
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

	const [ dialogMode, setDialogMode ] = useState< 'basic' | 'advanced' >( 'basic' );

	const copy = allCopy[ type ];
	const remoteSiteType = remoteSite.isStaging ? 'staging' : 'production';

	const localSiteName = localSite.name;
	const remoteSiteName = (
		<div className="flex items-center gap-2 flex-wrap py-2">
			<span className="flex-shrink-0">
				{ remoteSite.isStaging ? <CircleStagingIcon /> : <CircleProdIcon /> }
			</span>
			<span>{ remoteSite.isStaging ? 'Staging' : 'Production' }</span>
			<span className="text-gray-600 break-all">
				{ remoteSite.url.replace( /https?:\/\//, '' ) }
			</span>
		</div>
	);

	const syncFrom = type === 'push' ? localSiteName : remoteSiteName;
	const syncTo = type === 'push' ? remoteSiteName : localSiteName;

	const handleSubmit = () => {
		onSubmit( treeState );

		onRequestClose();
	};

	useEffect( () => {
		const element = document.querySelector(
			'.treeItemIdfilesAndFolders > div:nth-child(2)'
		) as HTMLElement;

		if ( ! element ) {
			return;
		}

		element.style.display = dialogMode === 'advanced' ? 'block' : 'none';
	}, [ dialogMode ] );

	return (
		<Modal
			className="w-3/5 min-w-[550px] h-full max-h-[84vh] [&>div]:!p-0"
			onRequestClose={ onRequestClose }
			title={ copy[ remoteSiteType ].title }
		>
			<div>
				<div className="px-8 pb-6 pt-2">{ copy[ remoteSiteType ].description }</div>
				<div className="px-8">
					<div className="flex items-start gap-1 pb-7 border-b border-a8c-gray-5">
						<div className="flex-1">
							<div className="leading-[32px]">{ copy.fromLabel }</div>
							<div className="border border-gray-300 rounded-[2px] min-h-12 px-[19px] flex items-center">
								{ syncFrom }
							</div>
						</div>
						<div className="w-10 mt-[32px] h-12 flex items-center justify-center">
							<RightArrowIcon />
						</div>
						<div className="flex-1">
							<div className="leading-[32px]">{ copy.toLabel }</div>
							<div className="border border-gray-300 rounded-[2px] min-h-12 px-[19px] flex items-center">
								{ syncTo }
							</div>
						</div>
					</div>
				</div>
				<div className="px-8 pt-7 pb-3">{ copy.subtitleSelector }</div>
				<div className="px-8 pb-6 relative">
					<SelectControl
						value={ dialogMode }
						variant="minimal"
						options={ [
							{
								label: 'All files and folders',
								value: 'basic',
							},
							{
								label: 'Specific files and folders',
								value: 'advanced',
							},
						] }
						onChange={ ( value: 'basic' | 'advanced' ) => setDialogMode( value ) }
						className="absolute right-7 top-1"
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<TreeView tree={ treeState } setTree={ setTreeState } className="sync-tree" />
				</div>
				<div className="px-8 pb-6">
					{ createInterpolateElement( __( 'Read more about <a>environment push</a> ↗' ), {
						a: (
							<Button
								variant="link"
								onClick={ () => getIpcApi().openURL( 'https://example.com' ) }
							/>
						),
					} ) }
				</div>
				<div className="px-8">
					<div className="flex pb-8 gap-4 justify-end">
						<Button variant="link" onClick={ onRequestClose }>
							{ __( 'Cancel' ) }
						</Button>
						<Button variant="primary" onClick={ handleSubmit }>
							{ copy.submit }
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
