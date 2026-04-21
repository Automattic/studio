import { Button, Tooltip } from '@wordpress/components';
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
	/** Arrow character used for the push button. Defaults to '↑'. */
	pushArrow?: '↑' | '↓';
	/** Arrow character used for the pull button. Defaults to '↓'. */
	pullArrow?: '↑' | '↓';
};

function buttonLabel( direction: 'push' | 'pull', to: Endpoint ): string {
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

function formatTimeAgo( timestamp: string ): string | null {
	const delta = Date.now() - Date.parse( timestamp );
	if ( ! Number.isFinite( delta ) ) return null;
	const rtf = new Intl.RelativeTimeFormat( undefined, { numeric: 'auto' } );
	const hours = Math.round( delta / ( 1000 * 60 * 60 ) );
	return Math.abs( hours ) < 24
		? rtf.format( -hours, 'hour' )
		: rtf.format( -Math.round( hours / 24 ), 'day' );
}

export function SyncGutter( props: Props ) {
	const pushArrow = props.pushArrow ?? '↑';
	const pullArrow = props.pullArrow ?? '↓';

	const pushButton = (
		<Button variant="secondary" onClick={ props.onPush } disabled={ props.disabled }>
			{ pushArrow } { buttonLabel( 'push', props.to ) }
		</Button>
	);
	const pullButton = (
		<Button variant="secondary" onClick={ props.onPull } disabled={ props.disabled }>
			{ pullArrow } { buttonLabel( 'pull', props.to ) }
		</Button>
	);

	const pushTooltip = props.lastPushTimestamp
		? sprintf(
				/* translators: %s: relative time such as "2 hours ago" */
				__( 'Last pushed %s' ),
				formatTimeAgo( props.lastPushTimestamp )
		  )
		: null;
	const pullTooltip = props.lastPullTimestamp
		? sprintf(
				/* translators: %s: relative time such as "2 hours ago" */
				__( 'Last pulled %s' ),
				formatTimeAgo( props.lastPullTimestamp )
		  )
		: null;

	return (
		<div className="flex flex-row items-center justify-center gap-4 py-1">
			{ pushTooltip ? <Tooltip text={ pushTooltip }>{ pushButton }</Tooltip> : pushButton }
			{ pullTooltip ? <Tooltip text={ pullTooltip }>{ pullButton }</Tooltip> : pullButton }
		</div>
	);
}
