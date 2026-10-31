export type Article={primary:string;title:string;authors?:string[];projects?:string[];types?:string[];date?:string|null;read?:boolean};
export type ReadFilter=''|'read'|'unread';
export type SortOrder='newest'|'oldest'|'title'|'author';
export const PAGE_SIZE=20;
/** Filter the complete grouped library before sorting and slicing a page. No recent-files cap. */
export function filterArticles(articles:Article[],query:string,read:ReadFilter,sort:SortOrder,folder:string|null){
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const title=(a:Article,b:Article)=>a.title.localeCompare(b.title)||a.primary.localeCompare(b.primary);
  return articles.filter(article=>{
    if(folder&&!article.primary.startsWith(folder.endsWith('/')?folder:folder+'/'))return false;
    if(read==='read'&&!article.read||read==='unread'&&article.read)return false;
    const text=[article.title,article.primary,...article.authors||[],...article.projects||[],...article.types||[]].join(' ').toLocaleLowerCase();
    return terms.every(term=>text.includes(term));
  }).sort((a,b)=>{
    if(sort==='title')return title(a,b);
    if(sort==='author')return (a.authors?.join(', ')||'').localeCompare(b.authors?.join(', ')||'')||title(a,b);
    // Missing dates always follow dated works, in either direction.
    if(!a.date||!b.date)return Number(!a.date)-Number(!b.date)||title(a,b);
    return (sort==='oldest'?a.date.localeCompare(b.date):b.date.localeCompare(a.date))||title(a,b);
  });
}
