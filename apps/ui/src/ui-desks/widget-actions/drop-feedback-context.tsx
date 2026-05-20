import { createContext, useContext, type ReactNode } from 'react';
import type { ActiveWidgetDropFeedback } from '@/ui-desks/widgets/types';
import type { TLShapeId } from 'tldraw';

const WidgetDropFeedbackContext = createContext< ActiveWidgetDropFeedback | null >( null );

export function WidgetDropFeedbackProvider( {
	value,
	children,
}: {
	value: ActiveWidgetDropFeedback | null;
	children: ReactNode;
} ) {
	return (
		<WidgetDropFeedbackContext.Provider value={ value }>
			{ children }
		</WidgetDropFeedbackContext.Provider>
	);
}

export function useWidgetDropFeedback( shapeId: TLShapeId | undefined ) {
	const value = useContext( WidgetDropFeedbackContext );
	if ( ! shapeId || value?.targetShapeId !== shapeId ) {
		return null;
	}

	return value.feedback;
}
