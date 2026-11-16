/** A quiet, accessible breadcrumb trail with a menu for collapsed ancestors; status-line.tsx draws it. */
// Non-document views use a ':' sentinel instead of a library path.
const VIEWS={':search':'Search'};
export function breadcrumbTrail(path, narrow=false) {
  // Reader Admin has its own header breadcrumb; the status line names the layout.
  if(path===':admin'||path?.startsWith(':admin/'))return {items:[{label:'Reader Admin',current:true,title:'Reader Admin'}],hidden:[]};
  if(path?.startsWith(':section='))return {items:[{label:path.slice(9),current:true}],hidden:[]};
  if(VIEWS[path])return {items:[{label:VIEWS[path],current:true,title:VIEWS[path]}],hidden:[]};
  if(!path)return {items:[],hidden:[]};
  // Inbox previews are not library folders; name the inbox instead of offering folder browsing.
  if(path.startsWith('private/'))return {items:[{label:'Encrypted document',current:true,title:'Encrypted document'}],hidden:[]};
  if(path.startsWith('inbox/'))return {items:[{label:'Inbox · '+path.split('/').at(-1),current:true,title:path}],hidden:[]};
  const parts=path.split('/'), folders=parts.slice(1,-1).map((label,index)=>({label,folder:parts.slice(0,index+2).join('/')+'/'}));
  const hidden=narrow?folders:folders.length>2?folders.slice(0,-1):[];
  return {items:[...(hidden.length?[{collapsed:true}]:[]),...(narrow?[]:hidden.length?folders.slice(-1):folders),{label:parts.at(-1),current:true}],hidden};
}

export function installBreadcrumbs({render}) {
  const narrow=matchMedia('(max-width:700px)');
  let previous, currentPath=null;
  function update(path=currentPath){
    currentPath=path;const key=JSON.stringify([path,narrow.matches]);if(key===previous)return;previous=key;
    render({...breadcrumbTrail(path,narrow.matches),path});
  }
  narrow.addEventListener('change',()=>update());
  return {update};
}
