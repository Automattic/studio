import { cx } from 'src/lib/cx';
import { ErrorIcon } from './error-icon';

type ErrorInformationProps = {
	children: React.ReactNode;
	className?: string;
};

export function ErrorInformation( { children, className }: ErrorInformationProps ) {
	return (
		<div className={ cx( 'flex items-center gap-1 text-xs text-red-500', className ) }>
			<ErrorIcon />
			{ children }
		</div>
	);
}
