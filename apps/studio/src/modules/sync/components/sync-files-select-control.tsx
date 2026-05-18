import { SelectControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

export type SyncFilesSelectionMode = 'all' | 'specific';

type SyncFilesSelectControlProps = {
	value: SyncFilesSelectionMode;
	onChange: ( value: SyncFilesSelectionMode ) => void;
	disabled?: boolean;
	showSpecificOption?: boolean;
};

export function SyncFilesSelectControl( {
	value,
	onChange,
	disabled,
	showSpecificOption = true,
}: SyncFilesSelectControlProps ) {
	return (
		<SelectControl
			value={ value }
			variant="minimal"
			options={ [
				{
					label: __( 'All files and folders' ),
					value: 'all',
				},
				...( showSpecificOption
					? [
							{
								label: __( 'Specific files and folders' ),
								value: 'specific',
							},
					  ]
					: [] ),
			] }
			onChange={ ( nextValue ) => onChange( nextValue as SyncFilesSelectionMode ) }
			disabled={ disabled }
			__next40pxDefaultSize
			__nextHasNoMarginBottom
			aria-label={ __( 'Select files and folders to sync' ) }
			className="h-9 select-minimal"
		/>
	);
}
