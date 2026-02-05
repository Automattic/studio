import { DropdownMenu, MenuGroup } from '@wordpress/components';
import { moreVertical } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren, useState } from 'react';
import Button from 'src/components/button';
import { CopyTextButton } from 'src/components/copy-text-button';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useVipContext } from '../context/vip-context';
import { EditVipEnvironment } from './edit-vip-environment';
import type { VipEnvironment } from '../types';

interface VipContentTabSettingsProps {
	selectedEnvironment: VipEnvironment;
}

function SettingsRow( { children, label }: PropsWithChildren< { label: string } > ) {
	return (
		<tr className="align-top">
			<th className="text-nowrap text-a8c-gray-50 pb-4 pe-10 ltr:text-left rtl:text-right font-normal">
				{ label }
			</th>
			<td className="pb-4">{ children }</td>
		</tr>
	);
}

function DeleteVipSite( {
	environment,
	onClose,
}: {
	environment: VipEnvironment;
	onClose: () => void;
} ) {
	const { __ } = useI18n();
	const { refresh } = useVipContext();
	const [ isDestroying, setIsDestroying ] = useState( false );

	const handleDestroy = async () => {
		const CANCEL_BUTTON_INDEX = 0;
		const DESTROY_BUTTON_INDEX = 1;

		const { response } = await getIpcApi().showMessageBox( {
			type: 'warning',
			message: __( 'Are you sure you want to delete this site?' ),
			detail: __(
				'This will permanently delete the environment and all its data. This action cannot be undone.'
			),
			buttons: [ __( 'Cancel' ), __( 'Delete' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );

		if ( response !== DESTROY_BUTTON_INDEX ) {
			onClose();
			return;
		}

		setIsDestroying( true );

		try {
			// Stop the environment first if it's running
			if ( environment.running ) {
				await getIpcApi().executeVipCliCommand( [
					'dev-env',
					'stop',
					`--slug=${ environment.slug }`,
				] );
			}

			await getIpcApi().executeVipCliCommand( [
				'dev-env',
				'destroy',
				`--slug=${ environment.slug }`,
				'--yes',
			] );

			await refresh();
		} finally {
			setIsDestroying( false );
			onClose();
		}
	};

	return (
		<Button
			variant="tertiary"
			className="!text-a8c-red-50 w-full !justify-start"
			onClick={ handleDestroy }
			disabled={ isDestroying }
		>
			{ isDestroying ? __( 'Deleting…' ) : __( 'Delete site' ) }
		</Button>
	);
}

export function VipContentTabSettings( { selectedEnvironment }: VipContentTabSettingsProps ) {
	const { __ } = useI18n();

	const siteUrl =
		selectedEnvironment.urls.length > 0
			? selectedEnvironment.urls[ 0 ]
			: `http://${ selectedEnvironment.slug }.vipdev.lndo.site/`;

	const domain = siteUrl.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );

	return (
		<div className="p-8 ltr:pr-4 rtl:pl-4">
			<div className="flex justify-between items-center mb-4">
				<h3 role="heading" className="text-black text-sm font-semibold">
					{ __( 'Site details' ) }
				</h3>
				<div className="flex items-center gap-1">
					<EditVipEnvironment environment={ selectedEnvironment } />
					<DropdownMenu
						icon={ moreVertical }
						label={ __( 'More options' ) }
						className="flex items-center"
					>
						{ ( { onClose }: { onClose: () => void } ) => (
							<MenuGroup>
								<DeleteVipSite environment={ selectedEnvironment } onClose={ onClose } />
							</MenuGroup>
						) }
					</DropdownMenu>
				</div>
			</div>
			<table className="mb-2 m-w-full" cellPadding={ 0 } cellSpacing={ 0 }>
				<tbody>
					<SettingsRow label={ __( 'Site name' ) }>
						<div className="flex">
							<span className="line-clamp-1 break-all">
								{ selectedEnvironment.title || selectedEnvironment.slug }
							</span>
						</div>
					</SettingsRow>
					<SettingsRow label={ __( 'Site URL' ) }>
						<CopyTextButton
							text={ siteUrl }
							label={ `${ domain }, ${ __( 'Copy site url to clipboard' ) }` }
							copyConfirmation={ __( 'Copied!' ) }
						>
							{ domain }
						</CopyTextButton>
					</SettingsRow>
					<SettingsRow label={ __( 'Local path' ) }>
						<CopyTextButton
							text={ selectedEnvironment.path }
							label={ __( 'Copy local path to clipboard' ) }
							copyConfirmation={ __( 'Copied!' ) }
						>
							<span className="line-clamp-1 break-all">{ selectedEnvironment.path }</span>
						</CopyTextButton>
					</SettingsRow>
					{ selectedEnvironment.appCodePath && (
						<SettingsRow label={ __( 'App code path' ) }>
							<CopyTextButton
								text={ selectedEnvironment.appCodePath }
								label={ __( 'Copy app code path to clipboard' ) }
								copyConfirmation={ __( 'Copied!' ) }
							>
								<span className="line-clamp-1 break-all">{ selectedEnvironment.appCodePath }</span>
							</CopyTextButton>
						</SettingsRow>
					) }
					<SettingsRow label={ __( 'WordPress version' ) }>
						{ selectedEnvironment.wordpressVersion || __( 'Unknown' ) }
					</SettingsRow>
					<SettingsRow label={ __( 'PHP version' ) }>
						<div className="flex">
							<span className="line-clamp-1 break-all">
								{ selectedEnvironment.phpVersion || __( 'Unknown' ) }
							</span>
						</div>
					</SettingsRow>
					<SettingsRow label={ __( 'Multisite' ) }>
						{ selectedEnvironment.multisite === false
							? __( 'No' )
							: selectedEnvironment.multisite === 'subdomain'
							? __( 'Subdomain' )
							: __( 'Subdirectory' ) }
					</SettingsRow>

					<tr>
						<th colSpan={ 2 } className="pb-4 ltr:text-left rtl:text-right">
							<h3 className="text-black text-sm font-semibold mt-4">{ __( 'WP Admin' ) }</h3>
						</th>
					</tr>
					<SettingsRow label={ __( 'Username' ) }>
						<CopyTextButton
							copyConfirmation={ __( 'Copied!' ) }
							label={ `vipgo, ${ __( 'Copy admin username to clipboard' ) }` }
							text="vipgo"
						>
							vipgo
						</CopyTextButton>
					</SettingsRow>
					<SettingsRow label={ __( 'Password' ) }>
						<CopyTextButton
							copyConfirmation={ __( 'Copied!' ) }
							label={ __( 'Copy admin password to clipboard' ) }
							text={ selectedEnvironment.adminPassword || 'password' }
						>
							************
						</CopyTextButton>
					</SettingsRow>
					<SettingsRow label={ __( 'Admin URL' ) }>
						<CopyTextButton
							text={ `${ siteUrl }wp-admin` }
							label={ `${ domain }/wp-admin, ${ __( 'Copy wp-admin url to clipboard' ) }` }
							copyConfirmation={ __( 'Copied!' ) }
							data-testid="copy-wp-admin-url"
						>
							{ `${ domain }/wp-admin` }
						</CopyTextButton>
					</SettingsRow>
				</tbody>
			</table>
		</div>
	);
}
