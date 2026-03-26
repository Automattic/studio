// `rehype-raw` only provides an ESM, so we need to mock it to work with CJS.
const rehypeRaw = () => {
	return ( tree: unknown ) => tree;
};

export default rehypeRaw;
