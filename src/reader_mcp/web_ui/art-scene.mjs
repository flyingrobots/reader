/** Reader scene descriptions (RW-43): the browser's validator for the declarative art DSL.

    It interprets the same schema file as the server (art-scene.v1.json; src/reader_mcp/art_scene.py)
    and runs the same semantic checks, with the same error paths, so a scene the server stored is
    one the page will draw, and a scene that reached the page some other way is checked again
    before Reader's own interpreter builds anything from it. Shared fixtures: tests/fixtures/art/. */
import SCHEMA from './art-scene.v1.json' with {type:'json'};

export {SCHEMA};
export const LIMITS=SCHEMA.limits,TOKENS=SCHEMA.tokens,DEFAULTS=SCHEMA.geometry_defaults,VERSION=SCHEMA.version;
const POLYHEDRA={icosahedron:20,octahedron:8,dodecahedron:36,tetrahedron:4};

export class SceneError extends Error{
  constructor(errors){const list=errors.slice(0,LIMITS.errors);super(list.slice(0,3).join('; ')+(list.length>3?` (and ${list.length-3} more)`:''));this.name='SceneError';this.errors=list;}
}
const resolve=value=>typeof value==='string'&&value.startsWith('@')?(value==='@tokens'?TOKENS:value.startsWith('@limits.')?LIMITS[value.slice(8)]:value):value;
const isNumber=value=>typeof value==='number'&&Number.isFinite(value);
const kindOf=value=>typeof value==='boolean'?'boolean':isNumber(value)?'number':typeof value==='string'?'string':Array.isArray(value)?'array':value&&typeof value==='object'?'object':'other';
const join=(path,key)=>path?`${path}.${key}`:String(key);
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);

class Checker{
  constructor(){this.errors=[];}
  fail(path,message){if(this.errors.length<LIMITS.errors)this.errors.push(`${path||'scene'}: ${message}`);}
  full(){return this.errors.length>=LIMITS.errors;}
  check(value,spec,path){if(this.full())return;if(typeof spec==='string')spec=SCHEMA.types[spec];this[spec.kind](value,spec,path);}
  number(value,spec,path){const low=resolve(spec.min),high=resolve(spec.max);if(!isNumber(value)||value<low||value>high)this.fail(path,`expected a number from ${low} to ${high}`);}
  integer(value,spec,path){const low=resolve(spec.min),high=resolve(spec.max);if(!isNumber(value)||!Number.isInteger(value)||value<low||value>high)this.fail(path,`expected a whole number from ${low} to ${high}`);}
  string(value,spec,path){
    if(typeof value!=='string'){this.fail(path,'expected text');return;}
    if(spec.pattern&&!new RegExp(spec.pattern).test(value)){this.fail(path,'expected an id: a lowercase letter, then up to 31 lowercase letters, digits or dashes');return;}
    const low=spec.min??0,high=spec.max??10000;if(value.length<low||value.length>high)this.fail(path,`expected text of ${low} to ${high} characters`);
  }
  enum(value,spec,path){const values=resolve(spec.values);if(typeof value==='boolean'||!values.some(v=>kindOf(v)===kindOf(value)&&v===value))this.fail(path,'expected one of: '+values.join(', '));}
  boolean(value,spec,path){if(typeof value!=='boolean')this.fail(path,'expected true or false');}
  tuple(value,spec,path){if(!Array.isArray(value)||value.length!==spec.length){this.fail(path,`expected a list of ${spec.length} values`);return;}value.forEach((item,i)=>this.check(item,spec.item,`${path}[${i}]`));}
  list(value,spec,path){const low=resolve(spec.min??0),high=resolve(spec.max);if(!Array.isArray(value)||value.length<low||value.length>high){this.fail(path,`expected a list of ${low} to ${high} items`);return;}value.forEach((item,i)=>this.check(item,spec.item,`${path}[${i}]`));}
  map(value,spec,path){const high=resolve(spec.max);if(kindOf(value)!=='object'||Object.keys(value).length>high){this.fail(path,`expected an object of at most ${high} entries`);return;}
    for(const [key,item] of Object.entries(value)){this.check(key,spec.key,join(path,key));this.check(item,spec.value,join(path,key));}}
  fields(value,fields,path){
    for(const key of Object.keys(value))if(!own(fields,key))this.fail(join(path,key),'unknown field');
    for(const [key,field] of Object.entries(fields)){if(own(value,key))this.check(value[key],field.type,join(path,key));else if(field.required)this.fail(join(path,key),'required');}
  }
  object(value,spec,path){
    if(kindOf(value)!=='object'){this.fail(path,'expected an object');return;}
    this.fields(value,spec.fields,path);
    if(spec.either&&!spec.either.some(group=>group.every(k=>own(value,k))))this.fail(path,'expected '+spec.either.map(group=>group.join(' and ')).join(' or '));
  }
  tagged(value,spec,path){
    if(kindOf(value)!=='object'){this.fail(path,'expected an object');return;}
    const tag=spec.tag,variants=spec.variants;
    if(typeof value[tag]!=='string'||!own(variants,value[tag])){this.fail(join(path,tag),'expected one of: '+Object.keys(variants).join(', '));return;}
    this.fields(value,{[tag]:{type:{kind:'string'}},...(spec.common||{}),...variants[value[tag]].fields},path);
  }
  alternatives(value,spec,path){
    const option=spec[kindOf(value)];
    if(option===undefined){const names={string:'a name',number:'a number',array:'a list',object:'an object'};this.fail(path,'expected '+['string','number','array','object'].filter(k=>own(spec,k)).map(k=>names[k]).join(' or '));return;}
    this.check(value,option,path);
  }
}

export const geometryDefaults=geometry=>({...(DEFAULTS[geometry.type]||{}),...geometry});
/** An upper estimate of a geometry's triangles (the interpreter also counts the real ones). */
export function triangles(geometry){
  const g=geometryDefaults(geometry);
  switch(g.type){
    case 'box':return 12*g.segments**2;
    case 'sphere':return 2*g.widthSegments*g.heightSegments;
    case 'icosahedron':case 'octahedron':case 'dodecahedron':case 'tetrahedron':return POLYHEDRA[g.type]*(g.detail+1)**2;
    case 'torus':case 'torusKnot':return 2*g.radialSegments*g.tubularSegments;
    case 'cylinder':return 2*g.radialSegments*g.heightSegments+(g.openEnded?0:2*g.radialSegments);
    case 'cone':return 2*g.radialSegments+(g.openEnded?0:g.radialSegments);
    case 'capsule':return 2*g.radialSegments*(2*g.capSegments+2);
    case 'plane':return 2*g.segments[0]*g.segments[1];
    case 'circle':return g.segments;
    case 'ring':return 2*g.segments;
    case 'lathe':return 2*(g.points.length-1)*g.segments;
    case 'extrude':{const n=g.shape.length+g.holes.reduce((sum,h)=>sum+h.length,0);return 2*n*(g.bevel>0?7:1)+2*n;}
    case 'tube':return 2*g.tubularSegments*g.radialSegments;
    case 'parametric':return 2*g.slices*g.stacks;
    case 'custom':return g.faces.length;
    default:return 0;
  }
}
const TARGETS={orbit:'around',follow:'target',look:'target',react:'source'};

function semantics(scene,checker){
  const ids=new Map(),refs=[],counts={nodes:0,animations:0,instances:0,particles:0,triangles:0},materials=scene.materials||{};
  const animations=(owner,items,path)=>{counts.animations+=items.length;items.forEach((item,i)=>{const field=TARGETS[item.kind];if(field&&own(item,field))refs.push([owner,item[field],`${path}[${i}].${field}`,item.kind==='follow'||item.kind==='orbit']);});};
  const material=(ref,path)=>{if(typeof ref==='string'&&!own(materials,ref))checker.fail(path,`no material named "${ref}"`);};
  const geometry=(g,path,copies=1)=>{
    if(g.type==='custom'){const size=g.vertices.length;const bad=g.faces.findIndex(face=>face.some(i=>i>=size));if(bad>=0)checker.fail(`${path}.faces[${bad}]`,'vertex index out of range');}
    if(g.type==='ring'&&own(g,'inner')&&g.inner>=(g.outer??DEFAULTS.ring.outer))checker.fail(`${path}.inner`,'must be smaller than outer');
    counts.triangles+=copies*triangles(g);
  };
  const visit=(node,path,depth)=>{
    counts.nodes++;
    if(depth>LIMITS.depth){checker.fail(path,`groups nest deeper than ${LIMITS.depth}`);return;}
    if(own(node,'id')){if(ids.has(node.id))checker.fail(`${path}.id`,`duplicate id "${node.id}"`);ids.set(node.id,path);}
    animations(node.id??null,node.animate||[],`${path}.animate`);
    if(node.type==='mesh'||node.type==='instances'){material(node.material,`${path}.material`);geometry(node.geometry,`${path}.geometry`,node.count??1);}
    if(node.type==='instances')counts.instances+=node.count;
    if(node.type==='particles')counts.particles+=node.count;
    (node.children||[]).forEach((child,i)=>visit(child,`${path}.children[${i}]`,depth+1));
  };
  (scene.lights||[]).forEach((light,i)=>{if(own(light,'id')){if(ids.has(light.id))checker.fail(`lights[${i}].id`,`duplicate id "${light.id}"`);ids.set(light.id,`lights[${i}]`);}animations(light.id??null,light.animate||[],`lights[${i}].animate`);});
  scene.objects.forEach((node,i)=>visit(node,`objects[${i}]`,1));
  const edges=new Map();
  for(const [owner,target,path,chained] of refs){
    if(!ids.has(target))checker.fail(path,`no object with id "${target}"`);
    else if(owner!==null&&target===owner)checker.fail(path,'an object cannot target itself');
    else if(chained&&owner!==null){if(!edges.has(owner))edges.set(owner,[]);edges.get(owner).push(target);}
  }
  (scene.links||[]).forEach((link,i)=>{for(const end of ['from','to'])if(!ids.has(link[end]))checker.fail(`links[${i}].${end}`,`no object with id "${link[end]}"`);});
  const state=new Map();
  const cycle=node=>{state.set(node,1);for(const target of edges.get(node)||[]){if(state.get(target)===1||(state.get(target)===undefined&&cycle(target)))return true;}state.set(node,2);return false;};
  for(const owner of [...edges.keys()].sort())if(state.get(owner)===undefined&&cycle(owner)){checker.fail('objects',`follow and orbit targets form a cycle through "${owner}"`);break;}
  const fog=scene.fog;if(fog&&own(fog,'near')&&own(fog,'far')&&fog.far<=fog.near)checker.fail('fog.far','must be greater than near');
  for(const name of ['nodes','animations','instances','particles','triangles'])if(counts[name]>LIMITS[name])checker.fail('scene',`${counts[name]} ${name} exceed the budget of ${LIMITS[name]}`);
  return counts;
}

/** {scene, counts} for a valid scene; throws SceneError listing what is wrong. */
export function validate(scene){
  const checker=new Checker();checker.check(scene,SCHEMA.root,'');
  if(checker.errors.length)throw new SceneError(checker.errors);
  const counts=semantics(scene,checker);
  if(checker.errors.length)throw new SceneError(checker.errors);
  return {scene,counts};
}
/** A scene from JSON text (at most LIMITS.bytes bytes), validated. */
export function parse(text){
  const size=new TextEncoder().encode(text).length;
  if(size>LIMITS.bytes)throw new SceneError([`scene: ${size} bytes exceed ${LIMITS.bytes}`]);
  let value;try{value=JSON.parse(text);}catch(error){throw new SceneError([`scene: not valid JSON (${String(error.message).slice(0,200)})`]);}
  return validate(value);
}
/** Errors for a scene, or [] when it is valid (tests and the artist's note). */
export function problems(scene){try{validate(scene);return [];}catch(error){if(error instanceof SceneError)return error.errors;throw error;}}
