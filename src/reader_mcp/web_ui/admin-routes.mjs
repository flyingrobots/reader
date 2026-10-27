/** Reader Admin routes: `#admin` (Overview) and `#admin/<section>[/<param>…]`, kept in the URL hash for static hosts.
 *
 * The app routes by sentinel paths, as it does for Search: `:admin` is Overview and `:admin/<section>/…` a section.
 * This module only knows the URL syntax. Which sections exist, and what a section does with its parameters, is the
 * Admin shell's section registry (web/src/admin/sections.tsx); an unregistered section renders an honest
 * "not found" page there. Legacy `#backstage` (and `#admin/overview`) open Overview. */
export const ADMIN=':admin';
export const ADMIN_HASH='#admin';
export const LEGACY_HASH='#backstage';
/** The parameter that is not a section: unparseable segments land here, so nothing untrusted is echoed back. */
export const NOT_FOUND='not-found';
export const SETTINGS='settings';
// A section id is lowercase words; later parameters (a job UUID, a run id) allow a little more.
const SECTION=/^[a-z][a-z0-9-]{0,39}$/;
const PARAM=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_PARAMS=3;

export const isAdminPath=path=>typeof path==='string'&&(path===ADMIN||path.startsWith(ADMIN+'/'));
export const isAdminHash=hash=>typeof hash==='string'&&(hash===ADMIN_HASH||hash.startsWith(ADMIN_HASH+'/')||hash===LEGACY_HASH);

/** The sentinel path for a section and its parameters: adminPath() is Overview, adminPath('settings') Settings. */
export function adminPath(section='',...params){
  if(!section||section==='overview')return ADMIN;
  if(!SECTION.test(section)||params.length>MAX_PARAMS||params.some(p=>!PARAM.test(String(p))))return ADMIN+'/'+NOT_FOUND;
  return [ADMIN,section,...params].join('/');
}

/** `{section, params}` for an admin sentinel path; null for any other path. Overview's section is 'overview'. */
export function adminRoute(path){
  if(!isAdminPath(path))return null;
  const [section='overview',...params]=path.slice(ADMIN.length+1).split('/').filter(Boolean);
  return {section,params};
}

/** The admin sentinel path a hash names, or null when the hash is not an admin route. Never throws. */
export function adminPathFromHash(hash){
  if(!isAdminHash(hash))return null;
  if(hash===LEGACY_HASH||hash===ADMIN_HASH)return ADMIN;
  let segments;
  try{segments=hash.slice(ADMIN_HASH.length+1).split('/').map(decodeURIComponent);}catch{return ADMIN+'/'+NOT_FOUND;}
  if(segments.at(-1)==='')segments.pop();   // A trailing slash is the same page.
  if(!segments.length)return ADMIN;
  return adminPath(...segments);
}

/** The hash for an admin sentinel path: `:admin` → `#admin`, `:admin/inbox` → `#admin/inbox`. */
export function adminHash(path){
  const route=adminRoute(path);if(!route)return ADMIN_HASH;
  return route.section==='overview'?ADMIN_HASH:ADMIN_HASH+'/'+[route.section,...route.params].map(encodeURIComponent).join('/');
}

/** Where "Back to Library" returns: the route the reader left, without passage or search terms, so a document
 *  reopens at its saved reading position (not at a heading or passage it was once opened at). A split layout is kept
 *  whole. Admin routes, and anything unrecognized, return to the homepage (''). */
export function libraryReturn(hash){
  hash=String(hash||'');
  if(isAdminHash(hash))return '';
  if(hash.startsWith('#split=')&&hash.length<=8192)return hash;
  if(hash.startsWith('#read=')){
    let path;try{path=decodeURIComponent(hash.slice(6).split('&')[0]);}catch{return '';}
    path=path.split('#')[0];return path?'#read='+encodeURIComponent(path):'';
  }
  if(hash.startsWith('#search'))return '#search';
  if(/^#scratch(=[0-9a-f-]{36})?$/.test(hash))return hash;
  if(/^#issue=[0-9]{4}-W[0-9]{2}$/.test(hash))return hash;
  return '';
}
