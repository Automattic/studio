import {
	__experimentalHStack as HStack,
	Icon,
	__experimentalText as Text,
} from '@wordpress/components';
import { published, border } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useStepper } from '../hooks/use-stepper';

export default function Stepper() {
	const { __ } = useI18n();
	const { steps, isVisible } = useStepper();

	if ( ! isVisible ) {
		return;
	}

	return (
		<HStack spacing={ 6 } alignment="left">
			{ steps.map( ( step ) => {
				const isCompleted = step.status === 'completed';
				const isCurrent = step.status === 'current';

				return (
					<HStack key={ step.id } spacing={ 2 } alignment="left" className="w-fit">
						<Icon
							icon={ isCompleted || isCurrent ? published : border }
							size={ 30 }
							className="fill-gray-500"
						/>
						<Text className={ 'text-base text-gray-500' }>{ step.label }</Text>
					</HStack>
				);
			} ) }
		</HStack>
	);
}
