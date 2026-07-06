import { SupportedPHPVersion } from '@studio/common/types/php-versions';
import {
	__experimentalVStack as VStack,
	__experimentalHeading as Heading,
} from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';
import { RefObject } from 'react';
import { CreateSiteForm } from 'src/modules/add-site/components/create-site-form';
import type { BlueprintPreferredVersions } from '@studio/common/lib/blueprint-validation';
import type { CreateSiteFormValues, PathValidationResult } from 'src/hooks/use-add-site';

interface CreateSiteProps {
	defaultValues?: {
		siteName?: string;
		sitePath?: string;
		phpVersion?: SupportedPHPVersion;
		wpVersion?: string;
	};
	onSelectPath: ( currentPath: string ) => Promise< PathValidationResult | null >;
	onSiteNameChange: ( name: string ) => Promise< PathValidationResult >;
	existingDomainNames?: string[];
	blueprintPreferredVersions?: BlueprintPreferredVersions;
	blueprintSuggestedDomain?: string;
	blueprintSuggestedHttps?: boolean;
	blueprintRequiresCustomDomain?: boolean;
	blueprintCredentials?: { adminUsername?: string; adminPassword?: string };
	originalDefaultVersions?: {
		phpVersion?: SupportedPHPVersion;
		wpVersion?: string;
	};
	onSubmit: ( values: CreateSiteFormValues ) => void;
	onValidityChange?: ( isValid: boolean ) => void;
	formRef?: RefObject< HTMLFormElement | null >;
}

export default function CreateSite( {
	defaultValues,
	onSelectPath,
	onSiteNameChange,
	existingDomainNames,
	blueprintPreferredVersions,
	blueprintSuggestedDomain,
	blueprintSuggestedHttps,
	blueprintRequiresCustomDomain,
	blueprintCredentials,
	onSubmit,
	onValidityChange,
	formRef,
}: CreateSiteProps ) {
	const { __ } = useI18n();

	return (
		<VStack className="w-full max-w-[402px] mx-auto text-frame-text" spacing={ 6 }>
			<Heading className="text-center text-[32px] text-frame-text" weight={ 500 }>
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
				blueprintRequiresCustomDomain={ blueprintRequiresCustomDomain }
				blueprintCredentials={ blueprintCredentials }
				onSubmit={ onSubmit }
				onValidityChange={ onValidityChange }
				formRef={ formRef }
			/>
		</VStack>
	);
}
