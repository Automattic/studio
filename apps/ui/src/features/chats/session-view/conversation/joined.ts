export interface Joined {
	joinedAbove?: boolean;
	joinedBelow?: boolean;
}

export function joinedAttributes( { joinedAbove, joinedBelow }: Joined ) {
	return {
		'data-joined-above': joinedAbove || undefined,
		'data-joined-below': joinedBelow || undefined,
	};
}
