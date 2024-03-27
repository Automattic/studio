import { Icon, file } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import { useGetWpVersion } from '../hooks/use-get-wp-version';
import { getIpcApi } from '../lib/get-ipc-api';
import { decodePassword } from '../lib/passwords';
import { CopyTextButton } from './copy-text-button';
import DeleteSite from './delete-site';
import EditSite from './edit-site';

interface ContentTabSettingsProps {
	selectedSite: SiteDetails;
}

function SettingsRow( { children, label }: PropsWithChildren< { label: string } > ) {
	return (
		<div className="flex self-stretch justify-start items-center gap-1.5">
			<div className="min-w-28 text-a8c-gray-50">{ label }</div>
			<div className="justify-start items-center flex">{ children }</div>
		</div>
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
		<div className="pb-4">
			<div className="flex flex-col justify-start items-start gap-4 mb-8">
				<h3 className="text-black text-sm font-semibold">{ __( 'Site details' ) }</h3>
				<SettingsRow label={ __( 'Site name' ) }>
					{ selectedSite.name }
					<EditSite />
				</SettingsRow>
				<SettingsRow label={ __( 'Local domain' ) }>
					<CopyTextButton
						text={ `http://localhost:${ selectedSite.port }` }
						label={ `localhost:${ selectedSite.port }, ${ __( 'Copy site url to clipboard' ) }` }
						copyConfirmation={ __( 'Copied!' ) }
					>
						{ `localhost:${ selectedSite.port }` }
					</CopyTextButton>
				</SettingsRow>
				<SettingsRow label={ __( 'Local path' ) }>
					<button
						aria-label={ `${ selectedSite.path }, ${ __( 'Open local path' ) }` }
						className="flex items-center gap-1.5"
						onClick={ () => getIpcApi().openLocalPath( selectedSite.path ) }
					>
						{ selectedSite.path } <Icon size={ 13 } icon={ file } />
					</button>
				</SettingsRow>
				<SettingsRow label={ __( 'WP Version' ) }>{ wpVersion }</SettingsRow>
				<h3 className="text-black text-sm font-semibold mt-4">{ __( 'WP Admin' ) }</h3>
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
			</div>
			<DeleteSite />
		</div>
	);
}
