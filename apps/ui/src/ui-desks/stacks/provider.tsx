import { StackAnimationProvider } from './context';
import { useStackInteractions } from './use-stack-interactions';
import type { ReactNode } from 'react';
import type { Editor } from 'tldraw';

interface StackProviderProps {
	editor: Editor | null;
	children: ReactNode;
}

export function StackProvider( { editor, children }: StackProviderProps ) {
	useStackInteractions( editor );

	return <StackAnimationProvider>{ children }</StackAnimationProvider>;
}
