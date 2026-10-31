/* Content visibility, part `sees` in native scrolling: what the reader sees, with the rule and with every block laid out
   (see web_content_visibility.cjs). */
process.env.READER_CV_PART='sees';process.env.READER_CV_SMOOTH='false';
require('./web_content_visibility.cjs');
