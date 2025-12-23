import {
	__experimentalVStack as VStack,
	__experimentalHeading as Heading,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { RefObject } from 'react';
import { AllowedPHPVersion } from 'src/lib/wordpress-provider/constants';
import {
	CreateSiteForm,
	CreateSiteFormValues,
	PathValidationResult,
} from 'src/modules/add-site/components/create-site-form';

export interface CreateSiteProps {
	defaultValues?: {
		siteName?: string;
		sitePath?: string;
		phpVersion?: AllowedPHPVersion;
		wpVersion?: string;
	};
	onSelectPath: ( currentPath: string ) => Promise< PathValidationResult | null >;
	onSiteNameChange: ( name: string ) => Promise< PathValidationResult >;
	existingDomainNames?: string[];
	blueprintPreferredVersions?: { php?: string; wp?: string };
	onSubmit: ( values: CreateSiteFormValues ) => void;
	formRef?: RefObject< HTMLFormElement >;
}

export default function CreateSite( {
	defaultValues,
	onSelectPath,
	onSiteNameChange,
	existingDomainNames = [],
	blueprintPreferredVersions,
	onSubmit,
	formRef,
}: CreateSiteProps ) {
	const { __ } = useI18n();

	return (
		<VStack className="w-full max-w-[402px] mx-auto text-black" spacing={ 6 }>
			<Heading className="text-[32px] text-gray-900 text-center" weight={ 500 }>
				{ __( 'Add a site' ) }
			</Heading>

			<CreateSiteForm
				defaultValues={ defaultValues }
				onSelectPath={ onSelectPath }
				onSiteNameChange={ onSiteNameChange }
				existingDomainNames={ existingDomainNames }
				blueprintPreferredVersions={ blueprintPreferredVersions }
				onSubmit={ onSubmit }
				formRef={ formRef }
			/>
		</VStack>
	);
}
