import { CheckboxControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';

type AnalyticsToggleProps = {
	value: boolean;
	onChange: ( value: boolean ) => void;
};

export function AnalyticsToggle( { value, onChange }: AnalyticsToggleProps ) {
	const { __ } = useI18n();

	return (
		<div className="flex flex-col gap-1">
			<CheckboxControl
				__nextHasNoMarginBottom
				id="analytics-toggle"
				className="[&_.components-checkbox-control__label]:font-semibold [&_.components-checkbox-control__label]:text-frame-text"
				label={ __( 'Help improve Studio by sharing anonymous usage statistics' ) }
				checked={ value }
				onChange={ onChange }
			/>
			<div className="a8c-body-small text-frame-text-secondary ml-7">
				{ __(
					'Anonymous usage data helps us understand how Studio is used so we can improve it. No personally identifiable information is collected.'
				) }
			</div>
		</div>
	);
}
