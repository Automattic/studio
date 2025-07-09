import { cx } from 'src/lib/cx';

export function Badge( {
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
} ) {
	return (
		<div
			className={ cx(
				'badge rounded-sm justify-center items-center a8c-body-small flex h-4 px-2 whitespace-nowrap',
				className
			) }
		>
			{ children }
		</div>
	);
}
