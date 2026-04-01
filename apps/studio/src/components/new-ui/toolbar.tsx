import { cx } from 'src/lib/cx';

interface ToolbarProps {
	start?: React.ReactNode;
	middle?: React.ReactNode;
	end?: React.ReactNode;
	className?: string;
	startInset?: number;
}

export function Toolbar( { start, middle, end, className, startInset }: ToolbarProps ) {
	return (
		<div className={ cx( 'relative flex items-center p-2 flex-shrink-0 min-h-[40px]', className ) }>
			{ /* Start — left-aligned */ }
			<div
				className="flex items-center gap-1 z-10 transition-[padding] duration-200 ease-in-out"
				style={ { paddingLeft: startInset ?? 0 } }
			>
				{ start }
			</div>

			{ /* Middle — absolutely centered */ }
			<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
				<div className="pointer-events-auto">{ middle }</div>
			</div>

			{ /* End — right-aligned */ }
			<div className="flex items-center gap-1 ml-auto z-10">{ end }</div>
		</div>
	);
}
