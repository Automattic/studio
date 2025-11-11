import {
	__experimentalVStack as VStack,
	__experimentalHeading as Heading,
	CheckboxControl,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent } from 'react';
import { SiteForm } from 'src/components/site-form';

interface CopySiteProps {
	siteName: string | null;
	handleSiteNameChange: ( name: string ) => Promise< void >;
	phpVersion: string;
	setPhpVersion: ( version: string ) => void;
	wpVersion: string;
	setWpVersion: ( version: string ) => void;
	sitePath: string;
	handlePathSelectorClick: () => void;
	error: string;
	handleSubmit: ( event: FormEvent ) => void;
	doesPathContainWordPress: boolean;
	useCustomDomain: boolean;
	setUseCustomDomain: ( use: boolean ) => void;
	customDomain: string | null;
	setCustomDomain: ( domain: string | null ) => void;
	customDomainError: string;
	enableHttps: boolean;
	setEnableHttps: ( enable: boolean ) => void;
	copyDatabase: boolean;
	setCopyDatabase: ( copy: boolean ) => void;
	copyPlugins: boolean;
	setCopyPlugins: ( copy: boolean ) => void;
	copyThemes: boolean;
	setCopyThemes: ( copy: boolean ) => void;
	copyUploads: boolean;
	setCopyUploads: ( copy: boolean ) => void;
}

export default function CopySite( {
	siteName,
	handleSiteNameChange,
	phpVersion,
	setPhpVersion,
	wpVersion,
	setWpVersion,
	sitePath,
	handlePathSelectorClick,
	error,
	handleSubmit,
	doesPathContainWordPress,
	useCustomDomain,
	setUseCustomDomain,
	customDomain,
	setCustomDomain,
	customDomainError,
	enableHttps,
	setEnableHttps,
	copyDatabase,
	setCopyDatabase,
	copyPlugins,
	setCopyPlugins,
	copyThemes,
	setCopyThemes,
	copyUploads,
	setCopyUploads,
}: CopySiteProps ) {
	const { __ } = useI18n();

	return (
		<VStack className="w-full max-w-[402px] mx-auto text-black" spacing={ 6 }>
			<Heading className="text-[32px] text-gray-900 text-center" weight={ 500 }>
				{ __( 'Copy site' ) }
			</Heading>

			<SiteForm
				siteName={ siteName || '' }
				setSiteName={ ( name ) => void handleSiteNameChange( name ) }
				phpVersion={ phpVersion }
				setPhpVersion={ setPhpVersion }
				wpVersion={ wpVersion }
				setWpVersion={ setWpVersion }
				sitePath={ sitePath }
				onSelectPath={ handlePathSelectorClick }
				error={ error }
				onSubmit={ handleSubmit }
				doesPathContainWordPress={ doesPathContainWordPress }
				useCustomDomain={ useCustomDomain }
				setUseCustomDomain={ setUseCustomDomain }
				customDomain={ customDomain }
				setCustomDomain={ setCustomDomain }
				customDomainError={ customDomainError }
				enableHttps={ enableHttps }
				setEnableHttps={ setEnableHttps }
				beforeAdvancedSettings={
					<VStack spacing={ 1 } className="mb-4">
						<CheckboxControl
							label={ __( 'Database (content, settings, users)' ) }
							checked={ copyDatabase }
							onChange={ setCopyDatabase }
						/>
						<CheckboxControl
							label={ __( 'Plugins' ) }
							checked={ copyPlugins }
							onChange={ setCopyPlugins }
						/>
						<CheckboxControl
							label={ __( 'Themes' ) }
							checked={ copyThemes }
							onChange={ setCopyThemes }
						/>
						<CheckboxControl
							label={ __( 'Uploads (media library)' ) }
							checked={ copyUploads }
							onChange={ setCopyUploads }
						/>
					</VStack>
				}
			/>
		</VStack>
	);
}
