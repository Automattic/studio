import { FormToggle } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { useI18n } from '@wordpress/react-i18n';
import { LearnMoreLink } from 'src/components/learn-more';

type StudioCLIToggleProps = {
	value: boolean;
	onChange: ( value: boolean ) => void;
};

export function StudioCliToggle( { value, onChange }: StudioCLIToggleProps ) {
	const { __ } = useI18n();

	return (
		<div className="flex justify-start items-start gap-2">
			<FormToggle
				className="mt-0.5"
				id="studio-cli-toggle"
				checked={ value }
				onChange={ ( event ) => onChange( event.target.checked ) }
			/>
			<div className="flex flex-col gap-1">
				<label htmlFor="studio-cli-toggle" className="font-semibold">
					{ __( 'Studio CLI for terminal' ) }
				</label>
				<div className="a8c-body-small text-frame-text-secondary">
					{ createInterpolateElement(
						__(
							'Use the <code>studio</code> command in any terminal to manage sites, run WP-CLI commands, and control your local environment. <learn_more_link/>'
						),
						{
							code: <code className="bg-black/10 rounded px-1 py-0.5 text-xs" />,
							learn_more_link: (
								<LearnMoreLink
									docsLinksKey="docsCli"
									className="a8c-body-small !text-frame-theme"
								/>
							),
						}
					) }
				</div>
			</div>
		</div>
	);
}
