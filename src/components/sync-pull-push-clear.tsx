import { useI18n } from '@wordpress/react-i18n';
import { cx } from '../lib/cx';
import Button from './button';
import { CheckIcon } from './check-icon';
import { ErrorIcon } from './error-icon';

export function SyncPullPushClear( {
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
				'flex gap-4 pl-4 ml-auto items-center shrink-0',
				isError ? 'text-a8c-red-50' : 'text-a8c-green-50'
			) }
		>
			<span className="flex items-center gap-2">
				{ isError ? <ErrorIcon /> : <CheckIcon /> }
				{ children }
			</span>
			<Button variant="link" className="ml-3" onClick={ onClick }>
				{ __( 'Clear' ) }
			</Button>
		</div>
	);
}
