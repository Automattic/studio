import { Icon, file } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import { useGetWpVersion } from '../hooks/use-get-wp-version';
import { getIpcApi } from '../lib/get-ipc-api';
import { decodePassword } from '../lib/passwords';
import Button from './button';
import CliExecuteButton from './cli-execute-button';
import { CopyTextButton } from './copy-text-button';
import DeleteSite from './delete-site';
import EditSite from './edit-site';

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
					<SettingsRow label={ __( 'Local URL' ) }>
						<CopyTextButton
							text={ `http://localhost:${ selectedSite.port }` }
							label={ `localhost:${ selectedSite.port }, ${ __( 'Copy site url to clipboard' ) }` }
							copyConfirmation={ __( 'Copied!' ) }
						>
							{ `localhost:${ selectedSite.port }` }
						</CopyTextButton>
					</SettingsRow>
					<SettingsRow label={ __( 'Local path' ) }>
						<Button
							aria-label={ `${ selectedSite.path }, ${ __( 'Open local path' ) }` }
							className="flex text-wrap items-center gap-1.5 [&.is-link]:text-black [&.is-link]:hover:text-[#2145e6]"
							onClick={ () => getIpcApi().openLocalPath( selectedSite.path ) }
							variant="link"
						>
							<span className="line-clamp-1 break-all">{ selectedSite.path }</span>
							<Icon size={ 13 } icon={ file } className="shrink-0" />
						</Button>
					</SettingsRow>
					<SettingsRow label={ __( 'WP Version' ) }>{ wpVersion }</SettingsRow>

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
			<CliExecuteButton projectPath={ selectedSite.path } />
		</div>
	);
}
