export const walkthroughPromptSenders = new WeakMap<
	HTMLElement,
	( prompt: string ) => Promise< unknown >
>();
