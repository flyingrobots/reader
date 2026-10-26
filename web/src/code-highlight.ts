/* Syntax highlighting for code blocks: Shiki with its JavaScript regex engine (no WebAssembly),
   loaded on demand. Each grammar is its own chunk under controls/highlight/ and loads the first
   time a block in that language is shown. Tokens come back as roles, not colors: the reader
   paints them with CSS custom highlights whose colors derive from the theme (styles.css --code-*),
   so the code text and its DOM never change. Adapted from the shadcn/ui base-nova
   lib/highlighter (MIT); see THIRD_PARTY_NOTICES.md. */
// The primitive tokenizer only: createHighlighterCore would also bundle the HTML (hast) renderer.
import {createShikiPrimitiveAsync,codeToTokensBase,createCssVariablesTheme,type ShikiPrimitive,type LanguageInput} from 'shiki/core';
import {createJavaScriptRegexEngine} from 'shiki/engine/javascript';
import {languageOf, type HighlightLanguage} from './code-languages';
export {languageOf};

// The shadcn set plus the languages a library of notes and reports actually fences.
const LANGUAGES:Record<HighlightLanguage,()=>LanguageInput>={
  bash:()=>import('shiki/langs/shellscript.mjs'),
  c:()=>import('shiki/langs/c.mjs'),
  css:()=>import('shiki/langs/css.mjs'),
  diff:()=>import('shiki/langs/diff.mjs'),
  html:()=>import('shiki/langs/html.mjs'),
  javascript:()=>import('shiki/langs/javascript.mjs'),
  json:()=>import('shiki/langs/json.mjs'),
  jsx:()=>import('shiki/langs/jsx.mjs'),
  markdown:()=>import('shiki/langs/markdown.mjs'),
  mermaid:()=>import('shiki/langs/mermaid.mjs'),
  powershell:()=>import('shiki/langs/powershell.mjs'),
  python:()=>import('shiki/langs/python.mjs'),
  rust:()=>import('shiki/langs/rust.mjs'),
  sql:()=>import('shiki/langs/sql.mjs'),
  toml:()=>import('shiki/langs/toml.mjs'),
  tsx:()=>import('shiki/langs/tsx.mjs'),
  typescript:()=>import('shiki/langs/typescript.mjs'),
  yaml:()=>import('shiki/langs/yaml.mjs'),
};
// Shiki's own grammar names, for languages whose key here is an alias.
const GRAMMAR:Record<string,string>={bash:'shellscript'};

// The CSS-variables theme reports each token's color as var(--shiki-token-<role>); only the role is kept.
const theme=createCssVariablesTheme({name:'reader',variablePrefix:'--shiki-',fontStyle:false});
let core:Promise<ShikiPrimitive>|undefined;
const highlighter=()=>core??=createShikiPrimitiveAsync({themes:[theme],langs:[],engine:createJavaScriptRegexEngine({forgiving:true})});
const loading=new Map<string,Promise<void>>();

export type Token={offset:number;length:number;role:string};
/** Tokens with a role (plain foreground text is left out), with offsets into the code string. */
export async function tokenize(code:string,language:string):Promise<Token[]|null>{
  const lang=languageOf(language);if(!lang)return null;
  const shiki=await highlighter();
  const grammar=GRAMMAR[lang]??lang;
  if(!(lang in LANGUAGES))return null;
  if(!shiki.getLoadedLanguages().includes(grammar)){
    if(!loading.has(grammar))loading.set(grammar,shiki.loadLanguage(LANGUAGES[lang as HighlightLanguage]()));
    await loading.get(grammar);
  }
  const out:Token[]=[];
  for(const line of codeToTokensBase(shiki,code,{lang:grammar,theme:'reader'}))for(const token of line){
    const role=/^var\(--shiki-token-([a-z-]+)\)$/.exec(token.color||'')?.[1];
    if(role&&token.content.trim())out.push({offset:token.offset,length:token.content.length,role});
  }
  return out;
}
