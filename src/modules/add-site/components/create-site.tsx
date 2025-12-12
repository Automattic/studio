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

			<CreateSiteForm addSiteProps={ addSiteProps } onSubmit={ handleSubmit } />
		</VStack>
	);
}
