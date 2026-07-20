import type { SelectedBlueprint } from '@/lib/blueprint-selection';

let pendingBlueprint: SelectedBlueprint | null = null;
const listeners = new Set< () => void >();

export const pendingBlueprintSlot = {
	getSnapshot: () => pendingBlueprint,
	set( blueprint: SelectedBlueprint ) {
		pendingBlueprint = blueprint;
		listeners.forEach( ( listener ) => listener() );
	},
	clear( blueprint: SelectedBlueprint ) {
		if ( pendingBlueprint !== blueprint ) return;
		pendingBlueprint = null;
		listeners.forEach( ( listener ) => listener() );
	},
	subscribe( listener: () => void ) {
		listeners.add( listener );
		return () => listeners.delete( listener );
	},
};
