import { DropdownMenu, MenuGroup, Button } from '@wordpress/components';
import { moreVertical } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren } from 'react';
import { decodePassword } from 'common/lib/passwords';
import { CopyTextButton } from 'src/components/copy-text-button';
import DeleteSite from 'src/components/delete-site';
import { LearnHowLink } from 'src/components/learn-more';
import { useGetWpVersion } from 'src/hooks/use-get-wp-version';
import { getIpcApi } from 'src/lib/get-ipc-api';
import EditSiteDetails from 'src/modules/site-settings/edit-site-details';
import { useAppDispatch, useRootSelector } from 'src/stores';
import { betaFeaturesSelectors } from 'src/stores/beta-features-slice';
import {
	certificateTrustApi,
	useCheckCertificateTrustQuery,
} from 'src/stores/certificate-trust-api';

interface ContentTabSettingsProps {
	selectedSite: SiteDetails;
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

export function ContentTabSettings( { selectedSite }: ContentTabSettingsProps ) {
	const dispatch = useAppDispatch();
	const { __ } = useI18n();
	const { data: isCertificateTrusted } = useCheckCertificateTrustQuery();
	const betaFeatures = useRootSelector( betaFeaturesSelectors.selectBetaFeatures );
	const username = 'admin';
	// Empty strings account for legacy sites lacking a stored password.
	const storedPassword = decodePassword( selectedSite.adminPassword ?? '' );
	const password = storedPassword === '' ? 'password' : storedPassword;
	const [ wpVersion, refreshWpVersion ] = useGetWpVersion( selectedSite );
	const domain = selectedSite.customDomain
		? `${ selectedSite.customDomain }`
		: `localhost:${ selectedSite.port }`;
	const protocol = selectedSite.customDomain && selectedSite.enableHttps ? 'https' : 'http';

	const handleTrustCertificate = async () => {
		await getIpcApi().trustCertificate();

		// Invalidate the query to refresh the data
		await dispatch( certificateTrustApi.util.invalidateTags( [ 'CertificateTrust' ] ) );
	};

	return (
		<div className="p-8 ltr:pr-4 rtl:pl-4">
			<div className="flex justify-between items-center mb-4">
				<h3 role="heading" className="text-black text-sm font-semibold">
					{ __( 'Site details' ) }
				</h3>
				<div className="flex items-center gap-1">
					<EditSiteDetails currentWpVersion={ wpVersion } onSave={ refreshWpVersion } />
					<DropdownMenu
						icon={ moreVertical }
						label={ __( 'More options' ) }
						className="flex items-center"
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
					<SettingsRow label={ __( 'Site URL' ) }>
						<CopyTextButton
							text={ `${ protocol }://${ domain }` }
							label={ `${ domain }, ${ __( 'Copy site url to clipboard' ) }` }
							copyConfirmation={ __( 'Copied!' ) }
						>
							{ domain }
						</CopyTextButton>
					</SettingsRow>
					<SettingsRow label={ __( 'HTTPS' ) }>
						<div>
							<span>{ selectedSite.enableHttps ? __( 'Enabled' ) : __( 'Disabled' ) }</span>{ ' ' }
							{ ! isCertificateTrusted && selectedSite.enableHttps && (
								<Button variant="link" onClick={ handleTrustCertificate }>
									{ __( 'Trust Certificate' ) }
								</Button>
							) }
						</div>
						{ ! isCertificateTrusted && selectedSite.enableHttps && (
							<div className="mt-1 max-w-96">
								<span className="text-a8c-gray-50 mt-1">
									{ __(
										'You need to trust this certificate to prevent your browser from showing a secure connection warning.'
									) }
								</span>{ ' ' }
								<LearnHowLink docsLinksKey="docsSslInStudio" />
							</div>
						) }
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
					<SettingsRow label={ __( 'WordPress version' ) }>{ wpVersion }</SettingsRow>
					<SettingsRow label={ __( 'PHP version' ) }>
						<div className="flex">
							<span className="line-clamp-1 break-all">{ selectedSite.phpVersion }</span>
						</div>
					</SettingsRow>
					{ betaFeatures.xdebugSupport && (
						<SettingsRow label={ __( 'Xdebug' ) }>
							<span>{ selectedSite.enableXdebug ? __( 'Enabled' ) : __( 'Disabled' ) }</span>
						</SettingsRow>
					) }
					<SettingsRow label={ __( 'Hot Reload' ) }>
						<div>
							<span>{ selectedSite.enableHotReload ? __( 'Enabled' ) : __( 'Disabled' ) }</span>
							<span className="text-a8c-gray-50 ml-2">{ __( '(Experimental)' ) }</span>
						</div>
						<div className="mt-1 max-w-96">
							<span className="text-a8c-gray-50 text-xs">
								{ __(
									'Automatically reload the site when files change. Instantly see updates to CSS/JS, and smart reload for PHP changes.'
								) }
							</span>
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
