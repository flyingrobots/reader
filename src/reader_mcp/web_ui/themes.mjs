import {famousThemeIds} from './controls/reader-controls.js';
export const THEMES=['ink','paper','orchid','orchid-dark','harvest','harvest-dark',...famousThemeIds];
// User themes are `user-<id>` (light) and `user-<id>-dark`; ids never end in -dark.
export const isCustomTheme=theme=>/^user-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(theme);
export const isDarkTheme=theme=>theme==='ink'||theme.endsWith('-dark');
// Every pair except Ink/Paper is `<family>` and `<family>-dark`.
export const oppositeTheme=theme=>({ink:'paper',paper:'ink'})[theme] || (THEMES.includes(theme)||isCustomTheme(theme)?(theme.endsWith('-dark')?theme.slice(0,-5):theme+'-dark'):'ink');
