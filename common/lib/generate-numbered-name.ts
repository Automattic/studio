/**
 * Generates a unique numbered name by iterating until an available name is found.
 * Example: "My WordPress site 2" if "My WordPress site" exists
 */
export async function generateNumberedName(
	baseName: string,
	isAvailable: ( name: string ) => Promise< boolean >
): Promise< string > {
	if ( await isAvailable( baseName ) ) {
		return baseName;
	}

	let number = 2;
	let candidateName = `${ baseName } ${ number }`;

	while ( ! ( await isAvailable( candidateName ) ) ) {
		number++;
		candidateName = `${ baseName } ${ number }`;
	}

	return candidateName;
}
