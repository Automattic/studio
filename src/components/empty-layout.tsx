import { ReactNode, PropsWithChildren } from 'react';

interface EmptyLayoutProps {
	footer?: ReactNode;
	children?: ReactNode;
}
export function EmptyLayout( { footer, children }: EmptyLayoutProps ) {
	return (
		<div className="w-full h-full rounded-sm border border-zinc-300 flex-col justify-between items-center inline-flex">
			<div className="self-stretch grow flex-col justify-center items-center flex">
				{ children }
			</div>
			{ footer && (
				<div className="flex-col justify-center items-center gap-2 flex">
					<div className="text-center text-zinc-700 text-xs mb-6">{ footer }</div>
				</div>
			) }
		</div>
	);
}

EmptyLayout.Title = ( { children }: PropsWithChildren ) => (
	<div className="self-stretch text-center text-black text-base font-semibold">{ children }</div>
);
EmptyLayout.Description = ( { children }: PropsWithChildren ) => (
	<div className="pt-2 w-72 text-center text-zinc-700 text-body">{ children }</div>
);
