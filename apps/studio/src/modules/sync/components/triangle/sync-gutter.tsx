import { Button } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

type Endpoint =
	| { kind: 'local'; label: 'Local' }
	| { kind: 'remote'; label: 'Production' | 'Staging' };

type Props = {
	from: Endpoint;
	to: Endpoint;
	lastPushTimestamp: string | null;
	lastPullTimestamp: string | null;
	onPush: () => void;
	onPull: () => void;
	disabled?: boolean;
};

function buttonLabel( direction: 'push' | 'pull', from: Endpoint, to: Endpoint ): string {
	const fromStaging = from.kind === 'remote' && from.label === 'Staging';
	const toProd = to.kind === 'remote' && to.label === 'Production';
	if ( direction === 'push' && fromStaging && toProd ) {
		return __( 'Promote to Production' );
	}
	if ( direction === 'pull' && fromStaging && toProd ) {
		return __( 'Refresh staging from Production' );
	}
	if ( direction === 'push' ) {
		return sprintf(
			/* translators: %s: environment label (e.g., "Production", "Staging") */
			__( 'Push to %s' ),
			to.label
		);
	}
	return sprintf(
		/* translators: %s: environment label (e.g., "Production", "Staging") */
		__( 'Pull from %s' ),
		to.label
	);
}

function TimeAgo( { timestamp, prefix }: { timestamp: string; prefix: string } ) {
	// eslint-disable-next-line react-hooks/purity
	const delta = Date.now() - Date.parse( timestamp );
	if ( ! Number.isFinite( delta ) ) return null;
	const rtf = new Intl.RelativeTimeFormat( undefined, { numeric: 'auto' } );
	const hours = Math.round( delta / ( 1000 * 60 * 60 ) );
	const formatted =
		Math.abs( hours ) < 24
			? rtf.format( -hours, 'hour' )
			: rtf.format( -Math.round( hours / 24 ), 'day' );
	return (
		<span className="text-xs text-gray-500">
			{ prefix } { formatted }
		</span>
	);
}

export function SyncGutter( props: Props ) {
	return (
		<div className="flex flex-row items-center justify-center gap-4 py-1">
			<div className="flex flex-col items-center gap-0.5">
				<Button variant="secondary" onClick={ props.onPush } disabled={ props.disabled }>
					↓ { buttonLabel( 'push', props.from, props.to ) }
				</Button>
				{ props.lastPushTimestamp && (
					<TimeAgo timestamp={ props.lastPushTimestamp } prefix={ __( 'Last pushed' ) } />
				) }
			</div>
			<div className="flex flex-col items-center gap-0.5">
				<Button variant="secondary" onClick={ props.onPull } disabled={ props.disabled }>
					↑ { buttonLabel( 'pull', props.from, props.to ) }
				</Button>
				{ props.lastPullTimestamp && (
					<TimeAgo timestamp={ props.lastPullTimestamp } prefix={ __( 'Last pulled' ) } />
				) }
			</div>
		</div>
	);
}
