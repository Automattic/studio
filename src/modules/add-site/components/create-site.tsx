import {
	__experimentalVStack as VStack,
	__experimentalHeading as Heading,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { FormEvent } from 'react';
import { useAddSite } from 'src/hooks/use-add-site';
import { CreateSiteForm } from 'src/modules/add-site/components/create-site-form';

interface CreateSiteProps {
	addSiteProps: ReturnType< typeof useAddSite >;
	handleSubmit: ( event: FormEvent ) => void;
}

export default function CreateSite( { addSiteProps, handleSubmit }: CreateSiteProps ) {
	const { __ } = useI18n();

	return (
		<VStack className="w-full max-w-[402px] mx-auto text-black" spacing={ 6 }>
			<Heading className="text-[32px] text-gray-900 text-center" weight={ 500 }>
				{ __( 'Add a site' ) }
			</Heading>

			<CreateSiteForm
				siteName={ addSiteProps.siteName || '' }
				setSiteName={ addSiteProps.setSiteName }
				phpVersion={ addSiteProps.phpVersion }
				setPhpVersion={ addSiteProps.setPhpVersion }
				wpVersion={ addSiteProps.wpVersion }
				setWpVersion={ addSiteProps.setWpVersion }
				sitePath={ addSiteProps.sitePath }
				onSelectPath={ addSiteProps.handlePathSelectorClick }
				error={ addSiteProps.error }
				doesPathContainWordPress={ addSiteProps.doesPathContainWordPress }
				useCustomDomain={ addSiteProps.useCustomDomain }
				setUseCustomDomain={ addSiteProps.setUseCustomDomain }
				customDomain={ addSiteProps.customDomain }
				setCustomDomain={ addSiteProps.setCustomDomain }
				customDomainError={ addSiteProps.customDomainError }
				enableHttps={ addSiteProps.enableHttps }
				setEnableHttps={ addSiteProps.setEnableHttps }
				blueprintPreferredVersions={ addSiteProps.blueprintPreferredVersions }
				onSubmit={ handleSubmit }
			/>
		</VStack>
	);
}
