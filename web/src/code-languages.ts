/* The fence languages Reader highlights (each a lazy Shiki grammar in code-highlight.ts) and their
   aliases. Shared by the main bundle, which decides which blocks to watch, and the highlighter. */
export const HIGHLIGHT_LANGUAGES=['bash','c','css','diff','html','javascript','json','jsx','markdown','mermaid','powershell','python','rust','sql','toml','tsx','typescript','yaml'] as const;
export type HighlightLanguage=typeof HIGHLIGHT_LANGUAGES[number];
const ALIASES:Record<string,HighlightLanguage>={js:'javascript',mjs:'javascript',cjs:'javascript',ts:'typescript',mts:'typescript',md:'markdown',py:'python',python3:'python',
  sh:'bash',shell:'bash',shellscript:'bash',zsh:'bash',console:'bash',yml:'yaml',rs:'rust',h:'c',ps1:'powershell',pwsh:'powershell',ps:'powershell',htm:'html',xhtml:'html',jsonc:'json',json5:'json',patch:'diff'};
/** The grammar used for a fence's info word, or null when Reader does not highlight it. */
export function languageOf(name:string):HighlightLanguage|null{const key=name.toLowerCase();return (HIGHLIGHT_LANGUAGES as readonly string[]).includes(key)?key as HighlightLanguage:ALIASES[key]??null;}
