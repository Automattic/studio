import {
	__experimentalVStack as VStack,
	__experimentalHeading as Heading,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { RefObject } from 'react';
import { AllowedPHPVersion } from 'src/lib/wordpress-server-types';
import { CreateSiteForm } from 'src/modules/add-site/components/create-site-form';
import type { BlueprintPreferredVersions } from 'common/lib/blueprint-validation';
import type { CreateSiteFormValues, PathValidationResult } from 'src/hooks/use-add-site';

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
	blueprintPreferredVersions?: BlueprintPreferredVersions;
	blueprintSuggestedDomain?: string;
	blueprintSuggestedHttps?: boolean;
	originalDefaultVersions?: {
		phpVersion?: AllowedPHPVersion;
		wpVersion?: string;
	};
	onSubmit: ( values: CreateSiteFormValues ) => void;
	onValidityChange?: ( isValid: boolean ) => void;
	formRef?: RefObject< HTMLFormElement >;
}

export default function CreateSite( {
	defaultValues,
	onSelectPath,
	onSiteNameChange,
	existingDomainNames = [],
	blueprintPreferredVersions,
	blueprintSuggestedDomain,
	blueprintSuggestedHttps,
	onSubmit,
	onValidityChange,
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
				blueprintSuggestedDomain={ blueprintSuggestedDomain }
				blueprintSuggestedHttps={ blueprintSuggestedHttps }
				onSubmit={ onSubmit }
				onValidityChange={ onValidityChange }
				formRef={ formRef }
			/>
		</VStack>
	);
}
