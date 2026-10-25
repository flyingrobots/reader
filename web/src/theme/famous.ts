/* Resolve the famous-theme role mappings into standard tokens. Used by the build (CSS)
   and by the controls bundle (labels and ids). */
import data from '../../../src/reader_mcp/web_ui/famous-themes.json';
import {COLOR_TOKENS, autoFix, bestContrastWith, hex, mix, withAlpha, type Theme, type Tokens, type Variant} from './color';

type Role=string|{mix:[string,string,number]}|{alpha:[string,number]};
export type FamousTheme={id:string;name:string;author:string;license:string;source:string;labels:Record<Variant,string>;palette:Record<string,string>;light:Record<string,Role>;dark:Record<string,Role>};
export const FAMOUS:FamousTheme[]=data.themes as unknown as FamousTheme[];
export const famousId=(id:string,variant:Variant)=>variant==='dark'?id+'-dark':id;

export type Adjustment={theme:string;variant:Variant;token:string;from:string;to:string};
export function resolveFamous(theme:FamousTheme):{theme:Theme;adjustments:Adjustment[]}{
  const color=(name:string)=>{if(name.startsWith('#'))return name;const value=theme.palette[name];if(!value)throw new Error(`${theme.id}: unknown palette color ${name}`);return value;};
  const resolve=(role:Role):string=>typeof role==='string'?hex(color(role)):'mix' in role?mix(color(role.mix[0]),color(role.mix[1]),role.mix[2]):withAlpha(color(role.alpha[0]),role.alpha[1]);
  const adjustments:Adjustment[]=[];const out={id:theme.id,name:theme.name,fonts:{serif:null,sans:null,mono:null}} as unknown as Theme;
  for(const variant of ['light','dark'] as Variant[]){
    const roles=theme[variant],tokens:Tokens={};
    for(const t of COLOR_TOKENS){const role=roles[t.name];if(role===undefined)throw new Error(`${theme.id} ${variant}: missing ${t.name}`);if(role!=='auto')tokens[t.name]=resolve(role);}
    const onAccent=(t:Tokens)=>({...t,'accent-ink':bestContrastWith(t.accent,[t.bg,t.ink,'#ffffff','#111111'])});
    Object.assign(tokens,onAccent(tokens));
    const fixed=autoFix(onAccent(autoFix(tokens,variant)),variant);
    for(const t of COLOR_TOKENS)if(t.name!=='accent-ink'&&fixed[t.name]!==tokens[t.name])adjustments.push({theme:theme.id,variant,token:t.name,from:tokens[t.name],to:fixed[t.name]});
    out[variant]=fixed;
  }
  return {theme:out,adjustments};
}
