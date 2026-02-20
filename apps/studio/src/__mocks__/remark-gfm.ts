// `remark-gfm` only provides an ESM, so we need to mock it to work with CJS.
export default function remarkGfm() {
	return {
		type: 'remark-gfm',
		plugins: [],
	};
}
