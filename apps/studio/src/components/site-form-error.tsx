import { Icon } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { cautionFilled, tip } from '@wordpress/icons';
import { cx } from 'src/lib/cx';

export interface SiteFormErrorProps {
	error?: string;
	tipMessage?: string;
	className?: string;
}

export const SiteFormError = ( { error, tipMessage = '', className = '' }: SiteFormErrorProps ) => {
	return (
		( error || tipMessage ) && (
			<div
				id={ error ? 'error-message' : 'tip-message' }
				role="alert"
				aria-atomic="true"
				className={ cx(
					'flex items-start gap-1 text-xs',
					error ? 'text-red-500' : 'text-a8c-gray-50',
					className
				) }
			>
				<Icon
					className={ cx( 'shrink-0 basis-4', error ? 'fill-red-500' : 'fill-a8c-gray-50' ) }
					icon={ error ? cautionFilled : tip }
					width={ 16 }
					height={ 16 }
				/>
				<p>{ error ? error : __( tipMessage ) }</p>
			</div>
		)
	);
};
