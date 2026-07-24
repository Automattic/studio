import { decodePassword } from '@studio/common/lib/passwords';
import { getSiteFileAccess, SITE_FILE_ACCESS_ALL_FILES } from '@studio/common/lib/site-file-access';
import { getSiteRuntime, SITE_RUNTIME_NATIVE_PHP } from '@studio/common/lib/site-runtime';
import {
	getWpEnvironmentType,
	WP_ENVIRONMENT_TYPE_DEVELOPMENT,
	WP_ENVIRONMENT_TYPE_LOCAL,
	WP_ENVIRONMENT_TYPE_PRODUCTION,
	WP_ENVIRONMENT_TYPE_STAGING,
	type WpEnvironmentType,
} from '@studio/common/lib/wp-environment-type';
import { getClosestSupportedPhpVersion } from '@studio/common/types/php-versions';
import {
	DropdownMenu,
	MenuGroup,
	Button,
	Icon,
	__experimentalHeading as Heading,
} from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { cautionFilled, info, moreVertical } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { PropsWithChildren, useCallback, useEffect, useState } from 'react';
import StudioButton from 'src/components/button';
import { CopyTextButton } from 'src/components/copy-text-button';
import { LearnHowLink } from 'src/components/learn-more';
import { SettingsMenuItem } from 'src/components/settings-site-menu';
import { Tooltip } from 'src/components/tooltip';
import { useDeleteSite } from 'src/hooks/use-delete-site';
import { useGetWpVersion } from 'src/hooks/use-get-wp-version';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { FileAccessDescription, RuntimeDescription } from 'src/lib/site-runtime-copy';
import EditSiteDetails from 'src/modules/site-settings/edit-site-details';
import { useAppDispatch } from 'src/stores';
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
			<th className="text-nowrap text-frame-text-secondary pb-4 pe-10 ltr:text-left rtl:text-right font-normal">
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
	const isNativePhpRuntime = getSiteRuntime( selectedSite ) === SITE_RUNTIME_NATIVE_PHP;
	const username = selectedSite.adminUsername || 'admin';
	// Empty strings account for legacy sites lacking a stored password.
	const storedPassword = decodePassword( selectedSite.adminPassword ?? '' );
	const password = storedPassword === '' ? 'password' : storedPassword;
	const email = selectedSite.adminEmail || 'admin@localhost.com';
	const [ wpVersion, refreshWpVersion ] = useGetWpVersion( selectedSite );
	const domain = selectedSite.customDomain
		? `${ selectedSite.customDomain }`
		: `localhost:${ selectedSite.port }`;
	const protocol = selectedSite.customDomain && selectedSite.enableHttps ? 'https' : 'http';
	const resolvedNativePhpVersion = isNativePhpRuntime
		? getClosestSupportedPhpVersion( selectedSite.phpVersion )
		: undefined;
	const showNativePhpVersionWarning =
		isNativePhpRuntime &&
		resolvedNativePhpVersion !== undefined &&
		resolvedNativePhpVersion !== selectedSite.phpVersion;
	const nativePhpVersionWarning =
		showNativePhpVersionWarning && resolvedNativePhpVersion
			? sprintf(
					__( 'Native PHP does not support PHP %1$s. This site will run with PHP %2$s instead.' ),
					selectedSite.phpVersion,
					resolvedNativePhpVersion
			  )
			: undefined;

	const handleTrustCertificate = async () => {
		await getIpcApi().trustCertificate();

		// Invalidate the query to refresh the data
		await dispatch( certificateTrustApi.util.invalidateTags( [ 'CertificateTrust' ] ) );
	};
	const { handleDeleteSite } = useDeleteSite();
	const { copySite, setIsEditModalOpen, setEditModalInitialTab } = useSiteDetails();
	const [ debugLogPath, setDebugLogPath ] = useState< string | null >( null );

	const openEditModal = ( tab: string ) => {
		setEditModalInitialTab( tab );
		setIsEditModalOpen( true );
	};

	const checkDebugLogExists = useCallback( async () => {
		if ( ! selectedSite.enableDebugLog ) {
			setDebugLogPath( null );
			return;
		}
		const path = await getIpcApi().getAbsolutePathFromSite(
			selectedSite.id,
			'wp-content/debug.log'
		);
		setDebugLogPath( path );
	}, [ selectedSite.id, selectedSite.enableDebugLog ] );

	useEffect( () => {
		void checkDebugLogExists();
	}, [ checkDebugLogExists ] );

	/* translators: PHP runtime option, paired with "Sandbox". The compiled PHP binary that Studio bundles and runs natively on the machine. */
	const nativeLabel = __( 'Native' );
	/* translators: PHP runtime option, paired with "Native". Runs the site in an isolated WordPress Playground sandbox. */
	const sandboxLabel = __( 'Sandbox' );
	const runtimeLabel = isNativePhpRuntime ? nativeLabel : sandboxLabel;

	const environmentTypeLabels: Record< WpEnvironmentType, string > = {
		[ WP_ENVIRONMENT_TYPE_LOCAL ]: __( 'Local' ),
		[ WP_ENVIRONMENT_TYPE_DEVELOPMENT ]: __( 'Development' ),
		[ WP_ENVIRONMENT_TYPE_STAGING ]: __( 'Staging' ),
		[ WP_ENVIRONMENT_TYPE_PRODUCTION ]: __( 'Production' ),
	};
	const environmentTypeLabel = environmentTypeLabels[ getWpEnvironmentType( selectedSite ) ];

	return (
		<div className="p-8 ltr:pr-4 rtl:pl-4">
			<div className="flex justify-between items-center mb-4">
				<Heading level={ 3 } className="text-frame-text text-sm font-semibold">
					{ __( 'Site details' ) }
				</Heading>
				<div className="flex items-center gap-1">
					<EditSiteDetails currentWpVersion={ wpVersion } onSave={ refreshWpVersion } />
					<DropdownMenu
						icon={ moreVertical }
						label={ __( 'More options' ) }
						className="flex items-center"
					>
						{ ( { onClose }: { onClose: () => void } ) => (
							<MenuGroup>
								<SettingsMenuItem onClick={ () => void copySite( selectedSite.id ) }>
									{ __( 'Duplicate site' ) }
								</SettingsMenuItem>
								<SettingsMenuItem
									onClick={ () => {
										void handleDeleteSite( selectedSite.id, selectedSite.name );
										onClose();
									} }
									isDestructive
								>
									{ __( 'Delete site' ) }
								</SettingsMenuItem>
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
							{ /* translators: status value for the HTTPS setting on the site settings screen */ }
							<span>{ selectedSite.enableHttps ? __( 'Enabled' ) : __( 'Disabled' ) }</span>{ ' ' }
							{ ! isCertificateTrusted && selectedSite.enableHttps && (
								<Button variant="link" onClick={ handleTrustCertificate }>
									{ __( 'Trust Certificate' ) }
								</Button>
							) }
						</div>
						{ ! isCertificateTrusted && selectedSite.enableHttps && (
							<div className="mt-1 max-w-96">
								<span className="text-frame-text-secondary mt-1">
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
						<div className="inline-flex items-center gap-2">
							<span className="line-clamp-1 break-all">{ selectedSite.phpVersion }</span>
							{ nativePhpVersionWarning && (
								<Tooltip text={ nativePhpVersionWarning } placement="top-start">
									<span
										role="img"
										aria-label={ __( 'PHP version warning' ) }
										tabIndex={ 0 }
										className="inline-flex cursor-help items-center"
									>
										<Icon icon={ cautionFilled } size={ 18 } className="fill-[#f59e0b]" />
									</span>
								</Tooltip>
							) }
						</div>
					</SettingsRow>
					<SettingsRow label={ __( 'PHP runtime' ) }>
						<div className="inline-flex items-center gap-2">
							<span>{ runtimeLabel }</span>
							<Tooltip
								text={ <RuntimeDescription runtime={ getSiteRuntime( selectedSite ) } /> }
								placement="top-start"
							>
								<span
									role="img"
									aria-label={ __( 'About the PHP runtime setting' ) }
									tabIndex={ 0 }
									className="text-frame-text-secondary inline-flex cursor-help items-center"
								>
									<Icon icon={ info } size={ 18 } className="fill-current" />
								</span>
							</Tooltip>
						</div>
					</SettingsRow>
					<SettingsRow label={ __( 'File access' ) }>
						<div className="inline-flex items-center gap-2">
							{ /* translators: value for the File access setting on the site settings screen */ }
							<span>
								{ getSiteFileAccess( selectedSite ) === SITE_FILE_ACCESS_ALL_FILES
									? __( 'All files' )
									: __( 'Site directory' ) }
							</span>
							<Tooltip
								text={
									<FileAccessDescription
										runtime={ getSiteRuntime( selectedSite ) }
										fileAccess={ getSiteFileAccess( selectedSite ) }
									/>
								}
								placement="top-start"
							>
								<span
									role="img"
									aria-label={ __( 'About the file access setting' ) }
									tabIndex={ 0 }
									className="text-frame-text-secondary inline-flex cursor-help items-center"
								>
									<Icon icon={ info } size={ 18 } className="fill-current" />
								</span>
							</Tooltip>
						</div>
					</SettingsRow>
					<tr>
						<th colSpan={ 2 } className="pb-4 ltr:text-left rtl:text-right">
							<h3 className="text-frame-text text-sm font-semibold mt-4">{ __( 'Debugging' ) }</h3>
						</th>
					</tr>
					<SettingsRow label={ __( 'Xdebug' ) }>
						{ /* translators: status value for the Xdebug setting on the site settings screen */ }
						<span>{ selectedSite.enableXdebug ? __( 'Enabled' ) : __( 'Disabled' ) }</span>
					</SettingsRow>
					<SettingsRow label={ __( 'Debug log' ) }>
						<span className="flex items-center gap-2">
							{ /* translators: status value for the Debug log setting on the site settings screen */ }
							{ selectedSite.enableDebugLog ? __( 'Enabled' ) : __( 'Disabled' ) }
							{ debugLogPath && (
								<Button variant="link" onClick={ () => getIpcApi().openLocalPath( debugLogPath ) }>
									{ __( 'Open log file' ) }
								</Button>
							) }
						</span>
					</SettingsRow>
					<SettingsRow label={ __( 'Debug display' ) }>
						{ /* translators: status value for the Debug display setting on the site settings screen */ }
						<span>{ selectedSite.enableDebugDisplay ? __( 'Enabled' ) : __( 'Disabled' ) }</span>
					</SettingsRow>
					<SettingsRow label={ __( 'Script debug' ) }>
						{ /* translators: status value for the Script debug setting on the site settings screen */ }
						<span>{ selectedSite.enableScriptDebug ? __( 'Enabled' ) : __( 'Disabled' ) }</span>
					</SettingsRow>
					<SettingsRow label={ __( 'Environment type' ) }>
						<span>{ environmentTypeLabel }</span>
					</SettingsRow>
					<tr>
						<th colSpan={ 2 } className="pb-4 ltr:text-left rtl:text-right">
							<h3 className="text-frame-text text-sm font-semibold mt-4">{ __( 'WP Admin' ) }</h3>
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
					<SettingsRow label={ __( 'Email' ) }>
						<CopyTextButton
							copyConfirmation={ __( 'Copied!' ) }
							label={ `${ email }, ${ __( 'Copy admin email to clipboard' ) }` }
							text={ email }
						>
							{ email }
						</CopyTextButton>
					</SettingsRow>
					<SettingsRow label={ __( 'Admin URL' ) }>
						<CopyTextButton
							text={ `${ protocol }://${ domain }/wp-admin/` }
							label={ `${ domain }/wp-admin/, ${ __( 'Copy wp-admin url to clipboard' ) }` }
							copyConfirmation={ __( 'Copied!' ) }
							data-testid="copy-wp-admin-url"
						>
							{ `${ domain }/wp-admin/` }
						</CopyTextButton>
					</SettingsRow>
				</tbody>
			</table>
			<div className="mt-4">
				<h3 className="text-frame-text text-sm font-semibold mb-2">{ __( 'AI Skills' ) }</h3>
				<p className="text-sm text-frame-text-secondary mb-3 max-w-96">
					{ __( "Your task agents make use of skills you've installed in" ) }{ ' ' }
					<Button variant="link" onClick={ () => getIpcApi().showUserSettings( 'skills' ) }>
						{ __( 'Studio Settings' ) }
					</Button>
					{ '. ' }
					{ __( 'You can override global skills for this site.' ) }
				</p>
				<StudioButton variant="secondary" onClick={ () => openEditModal( 'skills' ) }>
					{ __( 'Manage site skills' ) }
				</StudioButton>
			</div>
			<div className="mt-4">
				<h3 className="text-frame-text text-sm font-semibold mb-2">
					{ __( 'Agent Instructions' ) }
				</h3>
				<p className="text-sm text-frame-text-secondary mb-3 max-w-96">
					{ __(
						'Install instruction files like AGENTS.md so AI agents know how to work with this site.'
					) }
				</p>
				<StudioButton variant="secondary" onClick={ () => openEditModal( 'instructions' ) }>
					{ __( 'Manage instructions' ) }
				</StudioButton>
			</div>
		</div>
	);
}
