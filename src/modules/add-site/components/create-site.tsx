import {
	__experimentalVStack as VStack,
	__experimentalHeading as Heading,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent } from 'react';
import { CreateSiteForm } from 'src/modules/add-site/components/create-site-form';

interface CreateSiteProps {
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
	blueprintPreferredVersions?: { php?: string; wp?: string };
}

export default function CreateSite( {
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
	blueprintPreferredVersions,
}: CreateSiteProps ) {
	const { __ } = useI18n();

	return (
		<VStack className="w-full max-w-[402px] mx-auto text-black" spacing={ 6 }>
			<Heading className="text-[32px] text-gray-900 text-center" weight={ 500 }>
				{ __( 'Add a site' ) }
			</Heading>

			<CreateSiteForm
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
				blueprintPreferredVersions={ blueprintPreferredVersions }
			/>
		</VStack>
	);
}
