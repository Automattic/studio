import { FormToggle } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';

type AnalyticsToggleProps = {
	value: boolean;
	onChange: ( value: boolean ) => void;
};

export function AnalyticsToggle( { value, onChange }: AnalyticsToggleProps ) {
	const { __ } = useI18n();

	return (
		<div className="flex justify-start items-start gap-2">
			<FormToggle
				className="mt-0.5"
				id="analytics-toggle"
				checked={ value }
				onChange={ ( event ) => onChange( event.target.checked ) }
			/>
			<div className="flex flex-col gap-1">
				<label htmlFor="analytics-toggle" className="font-semibold">
					{ __( 'Help improve Studio by sharing anonymous usage statistics' ) }
				</label>
				<div className="a8c-body-small text-frame-text-secondary">
					{ __(
						'Anonymous usage data helps us understand how Studio is used so we can improve it. No personally identifiable information is collected.'
					) }
				</div>
			</div>
		</div>
	);
}
