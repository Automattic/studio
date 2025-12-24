import { FormToggle } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { LearnMoreLink } from 'src/components/learn-more';
import { isMac } from 'src/lib/app-globals';
import { SettingsFormField } from 'src/modules/user-settings/components/settings-form-field';

type StudioCLIToggleProps = {
	value: boolean;
	onChange: ( value: boolean ) => void;
};

export function StudioCliToggle( { value, onChange }: StudioCLIToggleProps ) {
	const { __ } = useI18n();

	return (
		<SettingsFormField label={ __( 'Studio CLI' ) }>
			<div className="flex justify-start items-center gap-2">
				<FormToggle
					id="studio-cli-toggle"
					checked={ value }
					onChange={ ( event ) => onChange( event.target.checked ) }
				/>
				<div className="flex flex-col">
					<label htmlFor="studio-cli-toggle">
						{ createInterpolateElement(
							sprintf(
								/* translators: %s is the name of the WordPress Studio CLI command ("studio") */
								__( 'Enable the %s command in the terminal.' ),
								'<code>studio</code>'
							),
							{ code: <code /> }
						) }
						{ ! isMac() && (
							<>
								{ ' ' }
								<LearnMoreLink docsLinksKey="docsCli" />
							</>
						) }
					</label>
					{ isMac() && (
						<div className="a8c-body-small text-a8c-gray-700">
							{ __(
								'Toggling this option will prompt you for admin privileges to install or uninstall the Studio CLI for use in the terminal.'
							) }{ ' ' }
							<LearnMoreLink docsLinksKey="docsCli" className="a8c-body-small" />
						</div>
					) }
				</div>
			</div>
		</SettingsFormField>
	);
}
