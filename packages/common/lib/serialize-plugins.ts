export function serializePlugins( plugins: string[] ): string {
	const serializedArray = plugins
		.map( ( plugin, index ) => `i:${ index };s:${ plugin.length }:"${ plugin }";` )
		.join( '' );
	return `a:${ plugins.length }:{${ serializedArray }}`;
}
