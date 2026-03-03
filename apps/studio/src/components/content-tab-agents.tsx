import { useI18n } from '@wordpress/react-i18n';
import { useState } from 'react';
import { AiSettingsModal } from 'src/components/ai-settings-modal';
import Button from 'src/components/button';

interface ContentTabAgentsProps {
	selectedSite: SiteDetails;
}

export function ContentTabAgents( { selectedSite }: ContentTabAgentsProps ) {
	const { __ } = useI18n();
	const [ isModalOpen, setIsModalOpen ] = useState( false );

	return (
		<div className="p-8 flex flex-col gap-4">
			<div>
				<h2 className="text-base font-medium text-gray-900">{ __( 'AI agents' ) }</h2>
				<p className="text-sm text-gray-500 mt-1">
					{ __(
						'Install instruction files so AI coding agents know how to work with this Studio site.'
					) }
				</p>
			</div>
			<div>
				<Button variant="primary" onClick={ () => setIsModalOpen( true ) }>
					{ __( 'Manage instructions' ) }
				</Button>
			</div>
			<AiSettingsModal
				isOpen={ isModalOpen }
				onClose={ () => setIsModalOpen( false ) }
				siteId={ selectedSite.id }
			/>
		</div>
	);
}
