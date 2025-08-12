import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import { CheckIcon } from 'src/components/check-icon';
import { ErrorIcon } from 'src/components/error-icon';
import { cx } from 'src/lib/cx';

export function ClearAction( {
	onClick,
	children,
	isError,
}: {
	onClick: () => void;
	children: React.ReactNode;
	isError?: boolean;
} ) {
	const { __ } = useI18n();
	return (
		<div
			className={ cx(
				'flex gap-4 items-center',
				isError ? 'text-a8c-red-50' : 'text-a8c-green-50'
			) }
		>
			<span className="flex items-center gap-2">
				{ isError ? <ErrorIcon /> : <CheckIcon /> }
				{ children }
			</span>
			<Button variant="link" className="ms-3" onClick={ onClick }>
				{ __( 'Clear' ) }
			</Button>
		</div>
	);
}
