import { __ } from '@wordpress/i18n';
import { FirstUseTip } from '../first-use-tip';
import type { ComponentProps } from 'react';

export function AnnotateHint(
	props: Pick< ComponentProps< typeof FirstUseTip >, 'children' | 'enabled' | 'tooltip' >
) {
	return (
		<FirstUseTip
			{ ...props }
			dismissalKey="annotateHintDismissed"
			badge={ __( 'New' ) }
			title={ __( 'Try Annotate' ) }
			description={ __( 'Point to anything and describe what you want to change.' ) }
		/>
	);
}
