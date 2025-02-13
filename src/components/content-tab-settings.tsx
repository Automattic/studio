import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import { CopyTextButton } from 'src/components/copy-text-button';
import DeleteSite from 'src/components/delete-site';
import EditAbsoluteUrl from 'src/components/edit-absolute-url';
import EditPhpVersion from 'src/components/edit-php-version';
import EditSite from 'src/components/edit-site';
import { useGetWpVersion } from 'src/hooks/use-get-wp-version';
import { decodePassword } from 'src/lib/passwords';

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
	const wpVersion = useGetWpVersion( selectedSite );
	const url = selectedSite.absoluteUrl || `http://localhost:${ selectedSite.port }`;
	const urlWihtoutProtocol = url.replace( /http(s)?:\/\//, '' );
	return (
		<div className="p-8">
			<table className="mb-2 m-w-full" cellPadding={ 0 } cellSpacing={ 0 }>
				<tbody>
					<tr>
						<th colSpan={ 2 } className="pb-4 ltr:text-left rtl:text-right">
							<h3 className="text-black text-sm font-semibold">{ __( 'Site details' ) }</h3>
						</th>
					</tr>
					<SettingsRow label={ __( 'Site name' ) }>
						<div className="flex">
							<span className="line-clamp-1 break-all">{ selectedSite.name }</span>
							<EditSite />
						</div>
					</SettingsRow>
					<SettingsRow label={ __( 'URL' ) }>
						<div className="flex">
							<CopyTextButton
								text={ url }
								label={ `${ urlWihtoutProtocol }, ${ __( 'Copy site url to clipboard' ) }` }
								copyConfirmation={ __( 'Copied!' ) }
							>
								{ urlWihtoutProtocol }
							</CopyTextButton>
							<EditAbsoluteUrl key={ selectedSite.id } />
						</div>
					</SettingsRow>
					<SettingsRow label={ __( 'Local path' ) }>
						<div className="flex">
							<CopyTextButton
								text={ selectedSite.path }
								label={ __( 'Copy local path to clipboard' ) }
								copyConfirmation={ __( 'Copied!' ) }
							>
								<span className="line-clamp-1 break-all">{ selectedSite.path }</span>
							</CopyTextButton>
						</div>
					</SettingsRow>
					<SettingsRow label={ __( 'WP Version' ) }>{ wpVersion }</SettingsRow>
					<SettingsRow label={ __( 'PHP Version' ) }>
						<div className="flex">
							<span className="line-clamp-1 break-all">{ selectedSite.phpVersion }</span>
							<EditPhpVersion />
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
							text={ `http://localhost:${ selectedSite.port }/wp-admin` }
							label={ `localhost:${ selectedSite.port }/wp-admin, ${ __(
								'Copy wp-admin url to clipboard'
							) }` }
							copyConfirmation={ __( 'Copied!' ) }
						>
							{ `localhost:${ selectedSite.port }/wp-admin` }
						</CopyTextButton>
					</SettingsRow>
				</tbody>
			</table>
			<DeleteSite />
		</div>
	);
}
