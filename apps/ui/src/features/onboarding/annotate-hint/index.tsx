import { __ } from '@wordpress/i18n';
import { FirstUseTip } from '../first-use-tip';
import { AnnotateIllustration } from './illustration';
import type { ComponentProps } from 'react';

export function AnnotateHint(
	props: Pick< ComponentProps< typeof FirstUseTip >, 'children' | 'enabled' | 'tooltip' >
) {
	return (
		<FirstUseTip
			{ ...props }
			dismissalKey="annotateHintDismissed"
			title={ __( 'Try Annotate' ) }
			description={ __( 'Point to anything and describe what you want to change.' ) }
			illustration={ <AnnotateIllustration /> }
		/>
	);
}
