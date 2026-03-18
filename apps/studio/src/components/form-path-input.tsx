import { __ } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import FolderIcon from 'src/components/folder-icon';
import { cx } from 'src/lib/cx';
import { SiteFormError } from './site-form-error';

export interface FormPathInputComponentProps {
	value: string;
	onClick: () => void;
	error?: string;
	doesPathContainWordPress: boolean;
	id?: string;
}

export function FormPathInputComponent( {
	value,
	onClick,
	error,
	doesPathContainWordPress,
	id,
}: FormPathInputComponentProps ) {
	const { __ } = useI18n();
	return (
		<div className="flex flex-col gap-2">
			<button
				aria-invalid={ !! error }
				/**
				 * The below `aria-describedby` presumes the error message always
				 * relates to the local path input, which is true currently as it is the
				 * only data validation in place. If we ever introduce additional data
				 * validation we need to expand the robustness of this
				 * `aria-describedby` attribute so that it only targets relevant error
				 * messages.
				 */
				aria-describedby={ error ? 'site-path-error' : undefined }
				type="button"
				aria-label={ `${ value }, ${ __( 'Select different local path' ) }` }
				className={ cx(
					'flex flex-row items-stretch rounded-sm border border-[#949494] focus:border-a8c-blue-50 focus:shadow-[0_0_0_0.5px_black] focus:shadow-a8c-blue-50 outline-none transition-shadow transition-linear duration-100 [&_.local-path-icon]:focus:border-l-a8c-blue-50 [&:disabled]:cursor-not-allowed',
					error && 'border-red-500 [&_.local-path-icon]:border-l-red-500'
				) }
				data-testid="select-path-button"
				onClick={ onClick }
				id={ id }
			>
				<div
					aria-hidden="true"
					tabIndex={ -1 }
					className="w-full text-left pl-3 py-3 min-h-10"
					onChange={ () => {} }
				>
					{ value }
				</div>
				<div
					aria-hidden="true"
					className="local-path-icon flex items-center py-[9px] px-2.5 self-center"
				>
					<FolderIcon className="text-[#3C434A]" />
				</div>
			</button>
			<SiteFormError
				error={ error }
				tipMessage={
					doesPathContainWordPress
						? __( 'The existing WordPress site at this path will be added.' )
						: ''
				}
			/>
			<input type="hidden" data-testid="local-path-input" value={ value } />
		</div>
	);
}
