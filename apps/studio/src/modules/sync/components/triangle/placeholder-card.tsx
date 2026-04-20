import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

export function ConnectProductionCard( props: { onClick: () => void } ) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-frame-border p-8 text-center">
			<h3 className="a8c-subtitle text-frame-text">{ __( 'Connect production site' ) }</h3>
			<p className="a8c-body text-frame-text-secondary">
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
		<div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-frame-border p-8 text-center">
			<h3 className="a8c-subtitle text-frame-text">{ __( 'Create staging site' ) }</h3>
			<p className="a8c-body text-frame-text-secondary">
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
