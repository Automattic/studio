import fs from 'fs';
import ejs from 'ejs';

const REACT_DEV_TOOLS =
	process.env.REACT_DEV_TOOLS === 'true' || process.env.REACT_DEV_TOOLS === '1';

const ejsTemplate = fs.readFileSync( './src/index.ejs', 'utf8' );
const data = { REACT_DEV_TOOLS };
const renderedHtml = ejs.render( ejsTemplate, data );
fs.mkdirSync( './dist', { recursive: true } );
fs.writeFileSync( './dist/index.html', renderedHtml );
