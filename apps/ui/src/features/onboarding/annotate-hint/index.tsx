import { __ } from '@wordpress/i18n';
import { FirstUseTip } from '../first-use-tip';
import type { ComponentProps } from 'react';

export function AnnotateHint(
	props: Pick< ComponentProps< typeof FirstUseTip >, 'children' | 'enabled' | 'active' | 'tooltip' >
) {
	return (
		<FirstUseTip
			{ ...props }
			dismissalKey="annotateHintDismissed"
			title={ __( 'Annotate your site' ) }
			description={ __(
				'Click anything, or drag to select an area, then describe the change. Click Annotate again when you’re done.'
			) }
		/>
	);
}
