/** Recover only a write rejected by Reader's token preflight, before any action ran. */
export function createTokenFetch({getToken,setToken,fetcher=(...args)=>fetch(...args)}) {
  let refreshing=null;
  async function freshToken() {
    if(!refreshing)refreshing=(async()=>{
      const response=await fetcher('/api/token',{cache:'no-store'});
      const data=await response.json().catch(()=>null);
      if(!response.ok||typeof data?.token!=='string'||!data.token)return null;
      setToken(data.token);return data.token;
    })().finally(()=>{refreshing=null;});
    return refreshing;
  }
  return async function request(path,options={}) {
    const response=await fetcher(path,options);
    if(options.method!=='POST'||response.status!==403)return response;
    const failure=await response.clone().json().catch(()=>null);
    if(failure?.code!=='reader_token_expired')return response;
    const sent=new Headers(options.headers).get('X-Reader-Token');
    const current=getToken(),token=current&&current!==sent?current:await freshToken();
    if(!token)return response;
    options.signal?.throwIfAborted();
    const headers=new Headers(options.headers);headers.set('X-Reader-Token',token);
    // One retry only. Other 403s, network failures and ambiguous outcomes never replay writes.
    return fetcher(path,{...options,headers});
  };
}
