/** "1 work", "2 works": the React twin of plural() in web_ui/logic.mjs. */
export const plural=(n:unknown,one:string,many=one+'s')=>`${Number(n).toLocaleString('en')} ${Number(n)===1?one:many}`;
