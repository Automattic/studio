import { nextSteps } from '@/lib/next-steps';
import type { LocalSite } from '@/data/core';

interface NextStepsProps {
	site: LocalSite;
	disabled: boolean;
	onSend: ( prompt: string ) => void;
}

// Each step sends the agent a prompt as the user's message.
export function NextSteps( { site, disabled, onSend }: NextStepsProps ) {
	return (
		<section className="section">
			<h3 className="next-title">Next steps</h3>
			<div className="tiles">
				{ nextSteps( site ).map( ( step ) => (
					<button
						key={ step.title }
						type="button"
						className="tile"
						disabled={ disabled }
						onClick={ () => onSend( step.prompt ) }
					>
						<span className="tile-title">{ step.title }</span>
						<span className="tile-copy">{ step.copy }</span>
					</button>
				) ) }
			</div>
		</section>
	);
}
