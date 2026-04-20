import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

export function ConnectProductionCard( props: { onClick: () => void } ) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-gray-300 p-8 text-center dark:border-gray-600">
			<h3 className="text-base font-semibold">{ __( 'Connect production site' ) }</h3>
			<p className="text-sm text-gray-500">
				{ __(
					'Link a WordPress.com site so you can pull its content to Studio and push changes back.'
				) }
			</p>
			<Button variant="primary" onClick={ props.onClick }>
				{ __( 'Connect site' ) }
			</Button>
		</div>
	);
}

export function CreateStagingCard( props: { onClick: () => void; disabledReason?: string } ) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-gray-300 p-8 text-center dark:border-gray-600">
			<h3 className="text-base font-semibold">{ __( 'Create staging site' ) }</h3>
			<p className="text-sm text-gray-500">
				{ props.disabledReason ??
					__( 'Provision a staging copy of your production site in one click.' ) }
			</p>
			<Button
				variant="primary"
				onClick={ props.onClick }
				disabled={ Boolean( props.disabledReason ) }
			>
				{ __( 'Create staging' ) }
			</Button>
		</div>
	);
}
