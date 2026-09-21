import { CheckboxControl } from '@wordpress/components';
import { useI18n } from '@wordpress/react-i18n';

type AnalyticsToggleProps = {
	value: boolean;
	onChange: ( value: boolean ) => void;
};

export function AnalyticsToggle( { value, onChange }: AnalyticsToggleProps ) {
	const { __ } = useI18n();

	return (
		<CheckboxControl
			__nextHasNoMarginBottom
			id="analytics-toggle"
			className="pl-4 [&_.components-checkbox-control__label]:font-semibold [&_.components-checkbox-control__label]:text-frame-text"
			label={ __( 'Help improve Studio by sharing anonymous usage statistics' ) }
			checked={ value }
			onChange={ onChange }
		/>
	);
}
