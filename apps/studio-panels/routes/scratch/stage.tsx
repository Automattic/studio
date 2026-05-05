// Default placeholder. Overwritten by `studio_generate_panel` to mount the
// agent-generated component. The exported name MUST be `stage` — wp-build
// looks for that export to mount the route content.
import { __ } from '@wordpress/i18n';

export const stage = () => (
	<div style={ { padding: '32px', maxWidth: '720px' } }>
		<h2>{ __( 'No scratch panel generated yet' ) }</h2>
		<p>
			{ __(
				'This slot is overwritten by the studio_generate_panel agent tool. Ask the agent to generate a custom panel and reload this page.'
			) }
		</p>
	</div>
);
