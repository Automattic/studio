import { Button, Notice, Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

type Props = {
	state: 'validating' | 'provisioning' | 'ready' | 'failed';
	error: string | null;
	onRetry: () => void;
};

function labelFor( state: Props[ 'state' ] ): string {
	switch ( state ) {
		case 'validating':
			return __( 'Checking quota…' );
		case 'provisioning':
			return __( 'Provisioning staging site…' );
		case 'ready':
			return __( 'Ready' );
		case 'failed':
			return __( 'Provisioning failed' );
	}
}

export function ProvisioningColumn( { state, error, onRetry }: Props ) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-gray-200 p-8 text-center dark:border-gray-700">
			{ state !== 'failed' && <Spinner /> }
			<h3 className="text-base font-semibold">{ __( 'Staging' ) }</h3>
			<p className="text-sm text-gray-500">{ labelFor( state ) }</p>
			{ state === 'failed' && error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }
			{ state === 'failed' && (
				<Button variant="secondary" onClick={ onRetry }>
					{ __( 'Try again' ) }
				</Button>
			) }
		</div>
	);
}
