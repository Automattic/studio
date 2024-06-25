/**
 * These extra type definitions expand the utility types provided by TypeScript
 */

type RecursivePartial< T > = {
	[ P in keyof T ]?: T[ P ] extends ( infer U )[]
		? RecursivePartial< U >[]
		: T[ P ] extends object | undefined
		? RecursivePartial< T[ P ] >
		: T[ P ];
};
