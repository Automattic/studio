import { Icon } from '@wordpress/components';
import { cautionFilled, tip } from '@wordpress/icons';
import { cx } from 'src/lib/cx';

export interface SiteFormErrorProps {
	error?: string;
	tipMessage?: string;
	className?: string;
	id?: string;
}

export const SiteFormError = ( {
	error,
	tipMessage = '',
	className = '',
	id = 'site-path-error',
}: SiteFormErrorProps ) => {
	return (
		( error || tipMessage ) && (
			<div
				id={ id }
				role="alert"
				aria-atomic="true"
				className={ cx(
					'flex items-start gap-1 text-xs',
					error ? 'text-red-500' : 'text-frame-text-secondary',
					className
				) }
			>
				<Icon
					className={ cx(
						'shrink-0 basis-4',
						error ? 'fill-red-500' : 'fill-frame-text-secondary'
					) }
					icon={ error ? cautionFilled : tip }
					width={ 16 }
					height={ 16 }
				/>
				<p>{ error ? error : tipMessage }</p>
			</div>
		)
	);
};
