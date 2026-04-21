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
	pushArrow?: '↑' | '↓' | '→' | '←';
	/** Arrow character used for the pull button. Defaults to '↓'. */
	pullArrow?: '↑' | '↓' | '→' | '←';
	/** Override the push button label (e.g., for remote↔remote flows where "Push to X" is ambiguous). */
	pushLabel?: string;
	/** Override the pull button label. */
	pullLabel?: string;
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

	const pushText = props.pushLabel ?? buttonLabel( 'push', props.to );
	const pullText = props.pullLabel ?? buttonLabel( 'pull', props.to );

	// Suppress the leading arrow glyph when a custom label is provided — callers that
	// pass a label typically encode direction inside it (e.g., "Production → Staging"),
	// so the prefix arrow would be redundant.
	const showPushArrow = ! props.pushLabel;
	const showPullArrow = ! props.pullLabel;

	const pushButton = (
		<Button variant="secondary" onClick={ props.onPush } disabled={ props.disabled }>
			{ showPushArrow ? `${ pushArrow } ` : '' }
			{ pushText }
		</Button>
	);
	const pullButton = (
		<Button variant="secondary" onClick={ props.onPull } disabled={ props.disabled }>
			{ showPullArrow ? `${ pullArrow } ` : '' }
			{ pullText }
		</Button>
	);

	const pushRelative = props.lastPushTimestamp ? formatTimeAgo( props.lastPushTimestamp ) : null;
	const pullRelative = props.lastPullTimestamp ? formatTimeAgo( props.lastPullTimestamp ) : null;
	const pushTooltip = pushRelative
		? sprintf(
				/* translators: %s: relative time such as "2 hours ago" */
				__( 'Last pushed %s' ),
				pushRelative
		  )
		: null;
	const pullTooltip = pullRelative
		? sprintf(
				/* translators: %s: relative time such as "2 hours ago" */
				__( 'Last pulled %s' ),
				pullRelative
		  )
		: null;

	return (
		<div className="flex flex-row items-center justify-center gap-4 py-1">
			{ pushTooltip ? <Tooltip text={ pushTooltip }>{ pushButton }</Tooltip> : pushButton }
			{ pullTooltip ? <Tooltip text={ pullTooltip }>{ pullButton }</Tooltip> : pullButton }
		</div>
	);
}
