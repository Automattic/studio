import { Icon, file } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import { useGetWpVersion } from '../hooks/use-get-wp-version';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';
import { CopyTextButton } from './copy-text-button';
import DeleteSite from './delete-site';

interface ContentTabSettingsProps {
	selectedSite: SiteDetails;
}

function SettingsRow( { children, label }: PropsWithChildren< { label: string } > ) {
	return (
		<div className="flex self-stretch justify-start items-center gap-1.5">
			<div className="min-w-28 text-zinc-700">{ label }</div>
			<div className="justify-start items-center flex">{ children }</div>
		</div>
	);
}

export function ContentTabSettings( { selectedSite }: ContentTabSettingsProps ) {
	const { __ } = useI18n();
	const username = 'admin';
	const password = 'password';
	const wpVersion = useGetWpVersion( selectedSite );
	return (
		<div className="pb-4">
			<div className="flex flex-col justify-start items-start gap-4 mb-8">
				<div className="text-black text-sm font-semibold">Site details</div>
				<SettingsRow label={ __( 'Site name' ) }>
					{ selectedSite.name }
					<Button className="h-4 text-blue-600" onClick={ () => alert( 'Open Modal' ) }>
						{ __( 'Edit' ) }
					</Button>
				</SettingsRow>
				<SettingsRow label={ __( 'Local domain' ) }>
					<CopyTextButton
						text={ `http://localhost:${ selectedSite.port }` }
						label={ __( 'Copy site url to clipboard' ) }
						copyConfirmation={ __( 'Copied!' ) }
					>
						{ `localhost:${ selectedSite.port }` }
					</CopyTextButton>
				</SettingsRow>
				<SettingsRow label={ __( 'Local path' ) }>
					<button
						className="flex items-center gap-1.5"
						onClick={ () => getIpcApi().openLocalPath( selectedSite.path ) }
					>
						{ selectedSite.path } <Icon size={ 13 } icon={ file } />
					</button>
				</SettingsRow>
				<SettingsRow label={ __( 'WP Version' ) }>{ wpVersion }</SettingsRow>
				<div className="text-black text-sm font-semibold mt-4">{ __( 'WP Admin' ) }</div>
				<SettingsRow label={ __( 'Username' ) }>
					<CopyTextButton text={ username } copyConfirmation={ __( 'Copied!' ) }>
						{ username }
					</CopyTextButton>
				</SettingsRow>
				<SettingsRow label={ __( 'Password' ) }>
					<CopyTextButton text={ password } copyConfirmation={ __( 'Copied!' ) }>
						************
					</CopyTextButton>
				</SettingsRow>
				<SettingsRow label={ __( 'Admin URL' ) }>
					<CopyTextButton
						text={ `http://localhost:${ selectedSite.port }/wp-admin` }
						label={ __( 'Copy wp-admin url to clipboard' ) }
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
