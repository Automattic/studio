import interpolateComponents from '@automattic/interpolate-components';
import { FormToggle } from '@wordpress/components';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { isMac } from 'src/lib/app-globals';
import { SettingsFormField } from './settings-form-field';

type StudioCLIToggleProps = {
	value: boolean;
	onChange: ( value: boolean ) => void;
};

export function StudioCliToggle( { value, onChange }: StudioCLIToggleProps ) {
	const { __ } = useI18n();

	return (
		<SettingsFormField label={ __( 'Studio CLI' ) }>
			<div className="flex justify-start items-center gap-3">
				<FormToggle
					id="studio-cli-toggle"
					checked={ value }
					onChange={ ( event ) => onChange( event.target.checked ) }
				/>
				<div className="flex flex-col">
					<label htmlFor="studio-cli-toggle">
						{ interpolateComponents( {
							mixedString: sprintf(
								/* translators: %s is the name of the WordPress Studio CLI command ("studio") */
								__( 'Enable the %s command in the terminal.' ),
								'{{code}}studio{{/code}}'
							),
							components: {
								code: <code />,
							},
						} ) }
					</label>
					{ isMac() && (
						<div className="a8c-body-small text-a8c-gray-700">
							{ __(
								'Toggling this option will prompt you for admin privileges to install or uninstall the Studio CLI for use in the terminal.'
							) }
						</div>
					) }
				</div>
			</div>
		</SettingsFormField>
	);
}
