import type * as Prompts from '@inquirer/prompts';

// `@inquirer/prompts` loads every prompt type, each with its own copy of `@inquirer/core`,
// so these load it when a prompt is shown instead of when `studio` starts.

export async function confirm( ...args: Parameters< typeof Prompts.confirm > ) {
	const { confirm: prompt } = await import( '@inquirer/prompts' );
	return prompt( ...args );
}

export async function input( ...args: Parameters< typeof Prompts.input > ) {
	const { input: prompt } = await import( '@inquirer/prompts' );
	return prompt( ...args );
}

export async function password( ...args: Parameters< typeof Prompts.password > ) {
	const { password: prompt } = await import( '@inquirer/prompts' );
	return prompt( ...args );
}

export async function select< const Value >(
	...args: Parameters< typeof Prompts.select< Value > >
): Promise< Value > {
	const { select: prompt } = await import( '@inquirer/prompts' );
	return prompt< Value >( ...args );
}

export async function search< const Value >(
	...args: Parameters< typeof Prompts.search< Value > >
): Promise< Value > {
	const { search: prompt } = await import( '@inquirer/prompts' );
	return prompt< Value >( ...args );
}
