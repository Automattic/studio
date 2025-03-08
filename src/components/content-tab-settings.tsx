import { DropdownMenu, MenuGroup } from '@wordpress/components';
import { moreVertical } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import { CopyTextButton } from 'src/components/copy-text-button';
import DeleteSite from 'src/components/delete-site';
import { useGetWpVersion } from 'src/hooks/use-get-wp-version';
import { decodePassword } from 'src/lib/passwords';
import EditSiteDetails from 'src/modules/site-settings/edit-site-details';

interface ContentTabSettingsProps {
	selectedSite: SiteDetails;
}

function SettingsRow( { children, label }: PropsWithChildren< { label: string } > ) {
	return (
		<tr className="align-top">
			<th className="text-nowrap text-a8c-gray-50 pb-4 ltr:pr-6 rtl:pl-6 ltr:text-left rtl:text-right font-normal">
				{ label }
			</th>
			<td className="pb-4">{ children }</td>
		</tr>
	);
}

export function ContentTabSettings( { selectedSite }: ContentTabSettingsProps ) {
	const { __ } = useI18n();
	const username = 'admin';
	// Empty strings account for legacy sites lacking a stored password.
	const storedPassword = decodePassword( selectedSite.adminPassword ?? '' );
	const password = storedPassword === '' ? 'password' : storedPassword;
	const [ wpVersion, refreshWpVersion ] = useGetWpVersion( selectedSite );
	const domain = selectedSite.customDomain
		? `${ selectedSite.customDomain }`
		: `localhost:${ selectedSite.port }`;
	const protocol = selectedSite.customDomain && selectedSite.useHttps ? 'https' : 'http';
	return (
		<div className="p-8 ltr:pr-0 rtl:pl-0">
			<div className="flex justify-between items-center mb-4">
				<h3 role="heading" className="text-black text-sm font-semibold">
					{ __( 'Site details' ) }
				</h3>
				<div className="flex items-center">
					<EditSiteDetails currentWpVersion={ wpVersion } onSave={ refreshWpVersion } />
					<DropdownMenu
						icon={ moreVertical }
						label={ __( 'More options' ) }
						className="p-1 flex items-center"
					>
						{ ( { onClose }: { onClose: () => void } ) => (
							<MenuGroup>
								<DeleteSite onClose={ onClose } />
							</MenuGroup>
						) }
					</DropdownMenu>
				</div>
			</div>
			<table className="mb-2 m-w-full" cellPadding={ 0 } cellSpacing={ 0 }>
				<tbody>
					<SettingsRow label={ __( 'Site name' ) }>
						<div className="flex">
							<span className="line-clamp-1 break-all">{ selectedSite.name }</span>
						</div>
					</SettingsRow>
					<SettingsRow label={ __( 'Local URL' ) }>
						<CopyTextButton
							text={ `${ protocol }://${ domain }` }
							label={ `${ domain }, ${ __( 'Copy site url to clipboard' ) }` }
							copyConfirmation={ __( 'Copied!' ) }
						>
							{ domain }
						</CopyTextButton>
					</SettingsRow>
					<SettingsRow label={ __( 'Local path' ) }>
						<CopyTextButton
							text={ selectedSite.path }
							label={ __( 'Copy local path to clipboard' ) }
							copyConfirmation={ __( 'Copied!' ) }
						>
							<span className="line-clamp-1 break-all">{ selectedSite.path }</span>
						</CopyTextButton>
					</SettingsRow>
					<SettingsRow label={ __( 'WP Version' ) }>{ wpVersion }</SettingsRow>
					<SettingsRow label={ __( 'PHP Version' ) }>
						<div className="flex">
							<span className="line-clamp-1 break-all">{ selectedSite.phpVersion }</span>
						</div>
					</SettingsRow>

					<tr>
						<th colSpan={ 2 } className="pb-4 ltr:text-left rtl:text-right">
							<h3 className="text-black text-sm font-semibold mt-4">{ __( 'WP Admin' ) }</h3>
						</th>
					</tr>
					<SettingsRow label={ __( 'Username' ) }>
						<CopyTextButton
							copyConfirmation={ __( 'Copied!' ) }
							label={ `${ username }, ${ __( 'Copy admin username to clipboard' ) }` }
							text={ username }
						>
							{ username }
						</CopyTextButton>
					</SettingsRow>
					<SettingsRow label={ __( 'Password' ) }>
						<CopyTextButton
							copyConfirmation={ __( 'Copied!' ) }
							label={ __( 'Copy admin password to clipboard' ) }
							text={ password || '' }
						>
							************
						</CopyTextButton>
					</SettingsRow>
					<SettingsRow label={ __( 'Admin URL' ) }>
						<CopyTextButton
							text={ `${ protocol }://${ domain }/wp-admin` }
							label={ `${ domain }/wp-admin, ${ __( 'Copy wp-admin url to clipboard' ) }` }
							copyConfirmation={ __( 'Copied!' ) }
						>
							{ `${ domain }/wp-admin` }
						</CopyTextButton>
					</SettingsRow>
				</tbody>
			</table>
		</div>
	);
}
