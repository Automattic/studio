import React from 'react';
import ButtonComponent from 'src/components/button';

interface Link {
	url?: string;
	text: string;
	icon?: string;
}

interface WhatsNewContentProps {
	title: string;
	description: React.ReactNode;
	links?: Link[];
	illustration?: string;
	illustrationComponent?: React.ComponentType;
	className?: string;
	width?: string | number;
	height?: string | number;
	onNext?: () => void;
	currentStep?: number;
	totalSteps?: number;
	isLastStep?: boolean;
}

const WhatsNewContent: React.FC< WhatsNewContentProps > = ( {
	title,
	description,
	links,
	illustration,
	illustrationComponent,
	className,
	width,
	height,
	onNext,
	currentStep = 0,
	totalSteps = 1,
} ) => {
	return (
		<div className="p-4">
			<div className="flex flex-col md:flex-row">
				<div className="flex-1 pr-0 md:pr-6">
					<h2 className="text-xl font-bold mb-4">{ title }</h2>
					<p className="text-gray-600 mb-6">{ description }</p>

					<div className="space-y-3">
						{ links &&
							links.map( ( link, index ) => (
								<div key={ index } className="flex items-center">
									{ link.icon && (
										<span className="text-gray-500">
											{ /* Replace with your icon component */ }
											<i className={ `icon ${ link.icon }` }></i>
										</span>
									) }

									{ link.url && (
										<a
											href={ link.url }
											target="_blank"
											rel="noopener noreferrer"
											className="text-blue-600 hover:text-blue-800 hover:underline flex items-center"
										>
											{ link.text }
										</a>
									) }
								</div>
							) ) }
					</div>

					{ /* Navigation dots and Next button */ }
					<div className="flex justify-between items-center mt-8">
						<div className="flex space-x-2">
							{ Array.from( { length: totalSteps } ).map( ( _, index ) => (
								<div
									key={ index }
									className={ `w-2 h-2 rounded-full ${
										index === currentStep ? 'bg-black' : 'bg-gray-300'
									}` }
								/>
							) ) }
						</div>

						{ onNext && (
							<ButtonComponent onClick={ onNext } variant="primary">
								{ currentStep === totalSteps - 1 ? 'Back' : 'Next' }
							</ButtonComponent>
						) }
					</div>
				</div>

				<div className={ `flex-shrink-0 p-2 min-w-[200px] ${ className || '' }` }>
					{ illustration ? (
						<img
							src={ illustration }
							alt=""
							width={ width }
							height={ height }
							className="object-contain"
						/>
					) : (
						illustrationComponent && React.createElement( illustrationComponent )
					) }
				</div>
			</div>
		</div>
	);
};

export default WhatsNewContent;
