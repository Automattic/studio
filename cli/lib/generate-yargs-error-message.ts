export function generateYargsErrorMessage( argument: string, given: string, mustBe: string ) {
	return `Invalid values: \n - Argument: ${ argument }, Given: "${ given }", Must be: ${ mustBe }.`;
}
