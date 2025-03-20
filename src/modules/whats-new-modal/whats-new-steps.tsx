import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import Button from 'src/components/button';
import IllustrationSvg from './illustration-svg';
import WhatsNewModal from './whats-new-modal';

export function WhatsNewButton( { className }: { className?: string } ) {
	const { __ } = useI18n();
	const [ isModalOpen, setIsModalOpen ] = useState( false );

	// Example steps for the modal
	const steps = [
		{
			title: 'New Feature Heading',
			description: 'Little paragraph sharing details of the new feature.',
			links: [
				{
					text: 'Learn more',
					url: 'https://example.com',
					icon: 'external',
				},
			],
			illustrationComponent: IllustrationSvg,
		},
		{
			title: 'Another Cool Feature',
			description: 'Description of another awesome feature we just added.',
			links: [
				{
					text: 'Documentation',
					url: 'https://example.com/docs',
					icon: 'book',
				},
			],
			illustrationComponent: IllustrationSvg,
		},
	];

	return (
		<>
			<Button variant="tertiary" className={ className } onClick={ () => setIsModalOpen( true ) }>
				{ __( "What's New" ) }
			</Button>

			<WhatsNewModal
				steps={ steps }
				isOpen={ isModalOpen }
				onClose={ () => setIsModalOpen( false ) }
			/>
		</>
	);
}

export { default as WhatsNewModal } from './whats-new-modal';
