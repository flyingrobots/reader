/* Content visibility, part `glide`: Smooth-scroll jumps while blocks settle (see web_content_visibility.cjs). */
require('./jail_guard.cjs');
process.env.READER_CV_PART='glide';
require('./web_content_visibility.cjs');
