import { PropsWithChildren } from 'react';
import { DotGrid } from 'src/components/dot-grid';

export function IllustrationGrid( { children }: PropsWithChildren ) {
	return (
		<div className="relative shrink-0 flex items-center justify-center">
			<div
				className="absolute overflow-hidden"
				style={ {
					inset: '-120px',
					maskImage: 'radial-gradient(circle, black 20%, transparent 65%)',
					WebkitMaskImage: 'radial-gradient(circle, black 20%, transparent 65%)',
				} }
			>
				<DotGrid className="text-frame-text" />
			</div>
			<div className="relative z-10">{ children }</div>
		</div>
	);
}
