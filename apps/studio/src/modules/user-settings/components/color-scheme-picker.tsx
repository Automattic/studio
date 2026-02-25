import { useI18n } from '@wordpress/react-i18n';
import { cx } from 'src/lib/cx';
import darkAppearanceIllustration from '../../../../assets/appearance-dark.svg';
import lightAppearanceIllustration from '../../../../assets/appearance-light.svg';
import systemAppearanceIllustration from '../../../../assets/appearance-system.svg';
import { SettingsFormField } from './settings-form-field';

interface ColorSchemePickerProps {
	value: 'system' | 'light' | 'dark';
	onChange: ( value: 'system' | 'light' | 'dark' ) => void;
}

export const ColorSchemePicker = ( { value, onChange }: ColorSchemePickerProps ) => {
	const { __ } = useI18n();
	const colorSchemeOptions: Array< {
		value: 'system' | 'light' | 'dark';
		label: string;
		illustration: string;
	} > = [
		{ value: 'system', label: __( 'System' ), illustration: systemAppearanceIllustration },
		{ value: 'light', label: __( 'Light' ), illustration: lightAppearanceIllustration },
		{ value: 'dark', label: __( 'Dark' ), illustration: darkAppearanceIllustration },
	];

	return (
		<SettingsFormField label={ __( 'Appearance' ) }>
			<div role="radiogroup" aria-label={ __( 'Appearance' ) } className="grid grid-cols-3 gap-3">
				{ colorSchemeOptions.map( ( option ) => {
					const isSelected = value === option.value;

					return (
						<button
							key={ option.value }
							type="button"
							role="radio"
							aria-checked={ isSelected }
							aria-label={ option.label }
							onClick={ () => onChange( option.value ) }
							className={ cx(
								'group flex flex-col items-center p-0 bg-transparent rounded-[4px] focus-visible:outline-none focus-visible:outline focus-visible:outline-[2px] focus-visible:outline-frame-theme focus-visible:outline-offset-[4px]'
							) }
						>
							<img
								src={ option.illustration }
								alt=""
								aria-hidden="true"
								className={ cx(
									'block h-auto w-auto rounded-[4px] dark:shadow-[0_0_0_1px_var(--color-frame-border)]',
									isSelected &&
										'outline outline-[2px] outline-frame-theme outline-offset-[1.5px]'
								) }
							/>
							<span
								className={ cx(
									'text-sm mt-1.5',
									isSelected ? 'text-frame-theme' : 'text-frame-text'
								) }
							>
								{ option.label }
							</span>
						</button>
					);
				} ) }
			</div>
		</SettingsFormField>
	);
};
