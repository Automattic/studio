import { cx } from '../lib/cx';

interface StatusLedProps {
	className?: string;
	on: boolean;
}

export default function StatusLed( { className, on }: StatusLedProps ) {
	const [ centerColor, glowColor ] = on
		? [ 'bg-emerald-500', 'bg-emerald-500/20' ]
		: [ 'bg-red-500', 'transparent' ];

	return (
		<div className={ cx( 'flex-none rounded-full p-1', glowColor, className ) }>
			<div className={ `h-1.5 w-1.5 rounded-full ${ centerColor }` } />
		</div>
	);
}
