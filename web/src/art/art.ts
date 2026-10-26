/* Bespoke article art (RW-43): Reader's own interpreter for the declarative scene language.

   A model never writes code that runs here. It writes a scene description (web_ui/art-scene.v1.json),
   which the server validated before storing it and the page validated again (web_ui/art-scene.mjs)
   before handing it to this module. Everything below is a fixed vocabulary: geometry factories,
   materials whose colors are resolved from the reader's theme tokens, lights, fog, a camera, groups,
   instanced layouts, particles, tethers, and procedural animation (spin, oscillate, orbit, wander,
   follow springs, look-at and distance reactions). Time is the only input, so the frame at
   `still.at` is the same on every screen for a given theme; follow springs integrate with a fixed
   step from t = 0 for stills and with the frame clock live.

   Loaded on demand (`controls/art.js`) and sharing its Three.js chunk with the page turn and the
   RW-20 data view. One renderer (one WebGL context) per page: at most one live view; stills are
   rendered to images. A frame-time and memory kill switch turns a live view into a still. */
import {AdditiveBlending, AmbientLight, BackSide, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CapsuleGeometry, CatmullRomCurve3, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DodecahedronGeometry, DoubleSide, ExtrudeGeometry, Float32BufferAttribute, FogExp2, Fog, FrontSide, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, LatheGeometry, Line, LineBasicMaterial, LineLoop, Material, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshPhysicalMaterial, MeshStandardMaterial, MeshToonMaterial, NeutralToneMapping, NormalBlending, Object3D, OctahedronGeometry, Path, PerspectiveCamera, PlaneGeometry, PointLight, Points, PointsMaterial, Quaternion, RingGeometry, Scene, Shape, SphereGeometry, SpotLight, SRGBColorSpace, TetrahedronGeometry, Texture, TorusGeometry, TorusKnotGeometry, TubeGeometry, Vector2, Vector3, WebGLRenderer} from 'three';
import SCHEMA from '../../../src/reader_mcp/web_ui/art-scene.v1.json';

type J=any;
type RGB=[number,number,number];
/** The theme as concrete colors: every token the language names, and whether the page is dark. */
export type ArtPalette={tokens:Record<string,RGB>;dark:boolean};
export type ArtView={view?:View;destroy():void;pause():void;resume():void;readonly frames:number;readonly still:boolean;readonly reason:string|null;frameTimes():number[];intervals():number[]};
type Mounted={onStill?:(url:string,reason:string)=>void;onLost?:()=>void;start?:number;interactive?:boolean};
/** The reader's own view in the focus view (#147): turns around the scene's target and a zoom, on top of the scene's camera motion. */
type View={yaw:number;pitch:number;zoom:number};

const DEFAULTS:Record<string,J>=(SCHEMA as J).geometry_defaults,LIMITS=(SCHEMA as J).limits;
const FPS=30,TAU=Math.PI*2,STEP=1/30,WARM=3,PROBE=8,BUDGET_MS=34,SUSTAINED_MS=50,SLOW_INTERVAL_MS=125,MAX_GPU_OBJECTS=600;
const TRIANGLE_CEILING=LIMITS.triangles*1.5;
function mulberry(seed:number){let a=seed>>>0;return ()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
const vec=(v:J,fallback:number[])=>new Vector3(...((v||fallback) as [number,number,number]));
const axisOf=(a:J)=>a==='x'?new Vector3(1,0,0):a==='z'?new Vector3(0,0,1):Array.isArray(a)?(new Vector3(a[0],a[1],a[2]).lengthSq()>1e-9?new Vector3(a[0],a[1],a[2]).normalize():new Vector3(0,1,0)):new Vector3(0,1,0);

/** A color spec resolved against the theme: a token, or a token mixed, shifted, or chosen by brightness. */
export function colorOf(spec:J,palette:ArtPalette):Color{
  const token=(name:string)=>{const rgb=palette.tokens[name]||palette.tokens.ink||[128,128,128];return new Color().setRGB(rgb[0]/255,rgb[1]/255,rgb[2]/255,SRGBColorSpace);};
  if(typeof spec==='string')return token(spec);
  if(!spec||typeof spec!=='object')return token('accent');
  const alternative=palette.dark?spec.dark:spec.light;
  const base=alternative!==undefined?colorOf(alternative,palette):spec.token?token(spec.token):colorOf(spec.light??spec.dark,palette);
  if(spec.mix)base.lerp(token(spec.mix),spec.amount??.5);
  if(spec.hue||spec.saturation||spec.lightness)base.offsetHSL((spec.hue||0)/360,spec.saturation||0,spec.lightness||0);
  return base;
}

// Geometry --------------------------------------------------------------------------------------
type Surface=(u:number,v:number,a:number,b:number,c:number,out:Vector3)=>void;
const SURFACES:Record<string,Surface>={
  klein(u,v,_a,_b,_c,out){u*=TAU;v*=TAU;let x,z;
    if(u<Math.PI){x=3*Math.cos(u)*(1+Math.sin(u))+2*(1-Math.cos(u)/2)*Math.cos(u)*Math.cos(v);z=-8*Math.sin(u)-2*(1-Math.cos(u)/2)*Math.sin(u)*Math.cos(v);}
    else{x=3*Math.cos(u)*(1+Math.sin(u))+2*(1-Math.cos(u)/2)*Math.cos(v+Math.PI);z=-8*Math.sin(u);}
    out.set(x/9,-2*(1-Math.cos(u)/2)*Math.sin(v)/9,z/9+.35);},
  mobius(u,v,a,_b,_c,out){u*=TAU;const w=(v-.5)*Math.max(.1,Math.min(2,Math.abs(a)||1)),r=1+w/2*Math.cos(u/2);out.set(r*Math.cos(u),w/2*Math.sin(u/2),r*Math.sin(u));},
  saddle(u,v,a,_b,_c,out){const x=(u-.5)*2,y=(v-.5)*2;out.set(x,.5*(a||1)*(x*x-y*y),y);},
  shell(u,v,a,b,c,out){const turns=Math.max(.5,Math.min(8,Math.abs(b)||2)),U=u*TAU*turns,V=v*TAU,k=.12*(a||1),g=Math.exp(k*U/TAU-k*turns);
    const r=g*(1+Math.cos(V))*.5;out.set(r*Math.cos(U),g*Math.sin(V)*.5+(c||1)*.25*g*(U/TAU-turns/2),r*Math.sin(U));},
  helicoid(u,v,a,b,_c,out){const U=(u-.5)*TAU*Math.max(.5,Math.min(6,Math.abs(a)||2)),V=(v-.5)*2;out.set(V*Math.cos(U),(b||1)*U*.12,V*Math.sin(U));},
  wave(u,v,a,b,c,out){const x=(u-.5)*2,z=(v-.5)*2;out.set(x,.3*(a||1)*Math.sin((b||1)*Math.PI*x)*Math.cos((c||1)*Math.PI*z),z);},
  dupin(u,v,_a,b,c,out){u*=TAU;v*=TAU;const A=1,C=Math.max(.05,Math.min(.9,Math.abs(c||1)*.5)),D=Math.max(.05,Math.min(.95,Math.abs(b||1)*.6)),B=Math.sqrt(A*A-C*C),den=A-C*Math.cos(u)*Math.cos(v);
    out.set((D*(C-A*Math.cos(u)*Math.cos(v))+B*B*Math.cos(u))/den*.7,B*Math.sin(u)*(A-D*Math.cos(v))/den*.7,B*Math.sin(v)*(C*Math.cos(u)-D)/den*.7);},
  'spherical-harmonic'(u,v,a,b,c,out){const t=v*Math.PI,p=u*TAU,m=Math.max(1,Math.round(Math.abs(b)||3)),n=Math.max(1,Math.round(Math.abs(c)||2)),r=1+.3*(a||1)*Math.sin(m*t)*Math.cos(n*p);
    out.set(r*Math.sin(t)*Math.cos(p),r*Math.cos(t),r*Math.sin(t)*Math.sin(p));},
};
function parametric(g:J){
  const fn=SURFACES[g.surface],slices=g.slices,stacks=g.stacks,size=g.size,positions:number[]=[],index:number[]=[],p=new Vector3();
  for(let i=0;i<=stacks;i++)for(let j=0;j<=slices;j++){fn(j/slices,i/stacks,g.a,g.b,g.c,p);positions.push(p.x*size,p.y*size,p.z*size);}
  for(let i=0;i<stacks;i++)for(let j=0;j<slices;j++){const a=i*(slices+1)+j,b=a+slices+1;index.push(a,b,a+1,b,b+1,a+1);}
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setIndex(index);geometry.computeVertexNormals();return geometry;
}
function geometryOf(spec:J):BufferGeometry{
  const g={...(DEFAULTS[spec.type]||{}),...spec};
  switch(g.type){
    case 'box':return new BoxGeometry(g.size[0],g.size[1],g.size[2],g.segments,g.segments,g.segments);
    case 'sphere':return new SphereGeometry(g.radius,g.widthSegments,g.heightSegments);
    case 'icosahedron':return new IcosahedronGeometry(g.radius,g.detail);
    case 'octahedron':return new OctahedronGeometry(g.radius,g.detail);
    case 'dodecahedron':return new DodecahedronGeometry(g.radius,g.detail);
    case 'tetrahedron':return new TetrahedronGeometry(g.radius,g.detail);
    case 'torus':return new TorusGeometry(g.radius,g.tube,g.radialSegments,g.tubularSegments,g.arc);
    case 'torusKnot':return new TorusKnotGeometry(g.radius,g.tube,g.tubularSegments,g.radialSegments,g.p,g.q);
    case 'cylinder':return new CylinderGeometry(g.radiusTop,g.radiusBottom,g.height,g.radialSegments,g.heightSegments,g.openEnded);
    case 'cone':return new ConeGeometry(g.radius,g.height,g.radialSegments,1,g.openEnded);
    case 'capsule':return new CapsuleGeometry(g.radius,g.length,g.capSegments,g.radialSegments);
    case 'plane':return new PlaneGeometry(g.size[0],g.size[1],g.segments[0],g.segments[1]);
    case 'circle':return new CircleGeometry(g.radius,g.segments);
    case 'ring':return new RingGeometry(g.inner,g.outer,g.segments);
    case 'lathe':return new LatheGeometry(g.points.map((p:number[])=>new Vector2(Math.abs(p[0]),p[1])),g.segments);
    case 'extrude':{
      const shape=new Shape(g.shape.map((p:number[])=>new Vector2(p[0],p[1])));
      for(const hole of g.holes)shape.holes.push(new Path(hole.map((p:number[])=>new Vector2(p[0],p[1]))));
      const geometry=new ExtrudeGeometry(shape,{depth:g.depth,bevelEnabled:g.bevel>0,bevelThickness:g.bevel*.2,bevelSize:g.bevel*.1,bevelSegments:3,curveSegments:g.curveSegments});
      geometry.center();return geometry;
    }
    case 'tube':return new TubeGeometry(new CatmullRomCurve3(g.points.map((p:number[])=>new Vector3(p[0],p[1],p[2])),g.closed,'centripetal'),g.tubularSegments,g.radius,g.radialSegments,g.closed);
    case 'parametric':return parametric(g);
    case 'custom':{const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(g.vertices.flat(),3));geometry.setIndex(g.faces.flat());geometry.computeVertexNormals();return geometry;}
  }
  throw new Error('Unknown geometry '+g.type);
}
const trianglesOf=(geometry:BufferGeometry)=>(geometry.index?geometry.index.count:geometry.getAttribute('position').count)/3;

// Materials -------------------------------------------------------------------------------------
function materialOf(spec:J,palette:ArtPalette,white=false):Material{
  const s=spec||{},kind=s.type||'standard',additive=s.blending==='additive'&&palette.dark;  // additive washes out on a light page
  const options:J={color:white?new Color(1,1,1):colorOf(s.color??'accent',palette),side:s.side==='back'?BackSide:s.side==='double'?DoubleSide:FrontSide,wireframe:!!s.wireframe,
    transparent:(s.opacity??1)<1||additive,opacity:s.opacity??1,blending:additive?AdditiveBlending:NormalBlending,depthWrite:!additive};
  if(kind==='basic')return new MeshBasicMaterial(options);
  const lit:J={...options,emissive:s.emissive?colorOf(s.emissive,palette):new Color(0,0,0),emissiveIntensity:s.emissiveIntensity??(s.emissive?1:0)};
  if(kind==='lambert')return new MeshLambertMaterial({...lit,flatShading:!!s.flatShading});
  if(kind==='toon')return new MeshToonMaterial(lit);
  const pbr={...lit,roughness:s.roughness??.55,metalness:s.metalness??0,flatShading:!!s.flatShading};
  if(kind==='physical')return new MeshPhysicalMaterial({...pbr,clearcoat:s.clearcoat??0,transmission:s.transmission??0});
  return new MeshStandardMaterial(pbr);
}

// Layouts ---------------------------------------------------------------------------------------
type Placement={p:Vector3;q:Quaternion;s:number;t:number};
function layout(spec:J,count:number,random:()=>number):Placement[]{
  const out:Placement[]=[],kind=spec.kind,jitter=spec.jitter||0,[lo,hi]=spec.scaleRange||[1,1],up=new Vector3(0,1,0),m=new Matrix4();
  let curve:CatmullRomCurve3|null=null;let reach=1;
  if(kind==='path')curve=new CatmullRomCurve3(spec.points.map((p:number[])=>new Vector3(p[0],p[1],p[2])),false,'centripetal');
  for(let i=0;i<count;i++){
    const t=count>1?i/(count-1):0,p=new Vector3();
    switch(kind){
      case 'ring':{const arc=spec.arc??TAU,full=arc>=TAU-1e-3,a=arc*(full?i/count:t),r=spec.radius??2;p.set(r*Math.cos(a),0,r*Math.sin(a));reach=r;break;}
      case 'spiral':{const r=(spec.radius??2)*t,a=(spec.turns??3)*TAU*t;p.set(r*Math.cos(a),(spec.growth??0)*(t-.5),r*Math.sin(a));reach=spec.radius??2;break;}
      case 'helix':{const r=spec.radius??1,a=(spec.turns??3)*TAU*t;p.set(r*Math.cos(a),(spec.height??3)*(t-.5),r*Math.sin(a));reach=r;break;}
      case 'grid':{const columns=spec.columns??10,layers=spec.layers??1,s=spec.spacing??.4,per=columns*layers,rows=Math.ceil(count/per),row=Math.floor(i/per),rest=i%per,layer=Math.floor(rest/columns),col=rest%columns;
        p.set((col-(columns-1)/2)*s,(layer-(layers-1)/2)*s,(row-(rows-1)/2)*s);reach=s;break;}
      case 'sphere':{const r=spec.radius??2,y=1-2*(i+.5)/count,rr=Math.sqrt(1-y*y),a=i*Math.PI*(3-Math.sqrt(5));p.set(rr*Math.cos(a)*r,y*r,rr*Math.sin(a)*r);reach=r*.3;break;}
      case 'scatter':{const [x,y,z]=spec.size||[4,2,2];p.set((random()-.5)*x,(random()-.5)*y,(random()-.5)*z);reach=Math.min(x,y,z)*.2;break;}
      case 'line':{const a=vec(spec.from,[-2,0,0]),b=vec(spec.to,[2,0,0]);p.copy(a).lerp(b,t);reach=a.distanceTo(b)/Math.max(1,count);break;}
      case 'path':p.copy(curve!.getPointAt(t));reach=curve!.getLength()/Math.max(1,count);break;
    }
    if(jitter)p.add(new Vector3(random()-.5,random()-.5,random()-.5).multiplyScalar(jitter*reach));
    const q=new Quaternion(),facing=spec.facing||'none';
    if(facing==='outward'&&p.lengthSq()>1e-9){m.lookAt(new Vector3(),p,up);q.setFromRotationMatrix(m);}
    else if(facing==='center'&&p.lengthSq()>1e-9){m.lookAt(p,new Vector3(),up);q.setFromRotationMatrix(m);}
    else if(facing==='random')q.setFromAxisAngle(new Vector3(random()-.5,random()-.5,random()-.5).normalize(),random()*TAU);
    out.push({p,q,s:lo+(hi-lo)*random(),t});
  }
  if((spec.facing||'none')==='tangent'&&out.length>1)out.forEach((place,i)=>{const next=out[Math.min(out.length-1,i+1)].p,prev=out[Math.max(0,i-1)].p,dir=next.clone().sub(prev);if(dir.lengthSq()>1e-9)place.q.setFromUnitVectors(new Vector3(0,0,1),dir.normalize());});
  return out;
}

// The scene -------------------------------------------------------------------------------------
type Animated={node:Object3D;p:Vector3;q:Quaternion;s:Vector3;list:J[];materials:Material[];opacity:number[];emissive:number[];spring?:{x:Vector3;v:Vector3}};
type Built={scene:Scene;camera:PerspectiveCamera;update(t:number,dt:number):void;dispose():void;triangles:number;start:number;view:View;aim():void};

function softDot(){const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d')!;const r=g.createRadialGradient(32,32,0,32,32,32);r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.45,'rgba(255,255,255,.85)');r.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=r;g.fillRect(0,0,64,64);const t=new CanvasTexture(c);t.colorSpace=SRGBColorSpace;return t;}

function build(data:J,palette:ArtPalette,aspect:number):Built{
  const scene=new Scene(),random=mulberry(data.seed??1),disposables:{dispose():void}[]=[],ids=new Map<string,Object3D>(),animated:Animated[]=[],frameHooks:((t:number)=>void)[]=[];
  let triangles=0,dot:Texture|null=null;
  const background=colorOf(data.background??'bg',palette);scene.background=background;
  if(data.fog){const color=colorOf(data.fog.color??data.background??'bg',palette);scene.fog=data.fog.density!==undefined?new FogExp2(color,data.fog.density):new Fog(color,data.fog.near??5,data.fog.far??20);}
  const cam=data.camera||{},camera=new PerspectiveCamera(cam.fov??40,aspect,.05,400),target=vec(cam.target,[0,0,0]),eye=vec(cam.position,[0,0,6]);
  const named=new Map<string,Material>();
  for(const [id,spec] of Object.entries(data.materials||{})){const material=materialOf(spec,palette);named.set(id,material);disposables.push(material);}
  const materialFor=(ref:J,white=false)=>{if(typeof ref==='string'&&!white)return named.get(ref)!;const spec=typeof ref==='string'?(data.materials||{})[ref]:ref;const material=materialOf(spec,palette,white);disposables.push(material);return material;};
  const track=(node:Object3D,spec:J)=>{
    if(spec.position)node.position.copy(vec(spec.position,[0,0,0]));if(spec.rotation)node.rotation.set(spec.rotation[0],spec.rotation[1],spec.rotation[2]);
    const s=spec.scale;if(typeof s==='number')node.scale.setScalar(s);else if(Array.isArray(s))node.scale.set(s[0],s[1],s[2]);
    if(spec.id)ids.set(spec.id,node);
    if(spec.animate?.length){
      const materials:Material[]=[];
      if(spec.animate.some((a:J)=>a.property==='opacity'||a.property==='emissiveIntensity'))node.traverse(child=>{const holder=child as Mesh;if(holder.material&&!Array.isArray(holder.material)){const own=holder.material.clone();own.transparent=true;holder.material=own;disposables.push(own);materials.push(own);}});
      animated.push({node,p:node.position.clone(),q:node.quaternion.clone(),s:node.scale.clone(),list:spec.animate,materials,opacity:materials.map(m=>m.opacity),emissive:materials.map(m=>(m as MeshStandardMaterial).emissiveIntensity??0)});
    }
  };
  const nodeOf=(spec:J):Object3D=>{
    let node:Object3D;
    if(spec.type==='mesh'){const geometry=geometryOf(spec.geometry);disposables.push(geometry);triangles+=trianglesOf(geometry);
      const mesh=new Mesh(geometry,materialFor(spec.material??{type:'standard',color:'accent'}));node=mesh;
      const wave=spec.geometry.type==='plane'&&spec.geometry.wave;
      if(wave){const position=geometry.getAttribute('position') as BufferAttribute,base=Float32Array.from(position.array as Float32Array),period=wave.period??12,k=TAU/wave.wavelength;
        frameHooks.push(t=>{const a=position.array as Float32Array;for(let i=0;i<a.length;i+=3){const x=base[i],y=base[i+1];a[i+2]=base[i+2]+wave.amplitude*Math.sin(k*x+TAU*t/period)*Math.cos(k*.7*y+TAU*t/(period*1.6));}position.needsUpdate=true;geometry.computeVertexNormals();});}
    }else if(spec.type==='group'){node=new Group();for(const child of spec.children)node.add(nodeOf(child));}
    else if(spec.type==='instances'){
      const geometry=geometryOf(spec.geometry);disposables.push(geometry);triangles+=trianglesOf(geometry)*spec.count;
      const colors=spec.colors?.map((c:J)=>colorOf(c,palette)),mesh=new InstancedMesh(geometry,materialFor(spec.material??{type:'standard',color:'accent'},!!colors),spec.count);
      const places=layout(spec.layout,spec.count,mulberry((spec.layout.seed??data.seed??1)+1)),m=new Matrix4(),one=new Vector3();
      places.forEach((place,i)=>{mesh.setMatrixAt(i,m.compose(place.p,place.q,one.setScalar(place.s)));if(colors)mesh.setColorAt(i,colors[i%colors.length]);});
      const each=spec.each;
      if(each){const q=new Quaternion(),turn=new Quaternion(),y=new Vector3(0,1,0),p=new Vector3(),s=new Vector3(),period=each.period??8,stagger=each.stagger??.5;
        frameHooks.push(t=>{places.forEach((place,i)=>{const phase=TAU*(t/period+stagger*place.t);p.copy(place.p);q.copy(place.q);let size=place.s;
          if(each.kind==='bob')p.y+=(each.amplitude??.2)*Math.sin(phase);
          else if(each.kind==='spin')q.multiply(turn.setFromAxisAngle(y,phase));
          else if(each.kind==='pulse')size*=Math.max(.01,1+(each.amplitude??.2)*Math.sin(phase));
          else if(each.kind==='wave')p.y+=(each.amplitude??.2)*Math.sin(TAU*t/period-TAU*place.p.length()/(each.wavelength??3));
          mesh.setMatrixAt(i,m.compose(p,q,s.setScalar(size)));});mesh.instanceMatrix.needsUpdate=true;});}
      node=mesh;
    }else if(spec.type==='particles'){
      const count=spec.count,base=new Float32Array(count*3),live=new Float32Array(count*3),phase=new Float32Array(count*3),rand=mulberry(spec.seed??(data.seed??1)+7),r=spec.radius??2,[bx,by,bz]=spec.size||[4,2,2],shape=spec.shape||'sphere';
      for(let i=0;i<count;i++){let x=0,y=0,z=0;
        if(shape==='box'){x=(rand()-.5)*bx;y=(rand()-.5)*by;z=(rand()-.5)*bz;}
        else if(shape==='disc'||shape==='ring'){const a=rand()*TAU,d=shape==='ring'?r*(.82+.18*rand()):r*Math.sqrt(rand());x=d*Math.cos(a);z=d*Math.sin(a);y=(rand()-.5)*r*.06;}
        else{const u=rand()*2-1,a=rand()*TAU,d=shape==='shell'?r*(.92+.08*rand()):r*Math.cbrt(rand()),s=Math.sqrt(1-u*u);x=d*s*Math.cos(a);y=d*u;z=d*s*Math.sin(a);}
        base.set([x,y,z],i*3);phase.set([rand()*TAU,rand()*TAU,.25+rand()*.5],i*3);}
      live.set(base);
      const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(live,3));disposables.push(geometry);
      const colors=spec.colors?.map((c:J)=>colorOf(c,palette));
      if(colors){const array=new Float32Array(count*3);for(let i=0;i<count;i++){const c=colors[i%colors.length];array.set([c.r,c.g,c.b],i*3);}geometry.setAttribute('color',new BufferAttribute(array,3));}
      dot??=softDot();if(!disposables.includes(dot))disposables.push(dot);
      const additive=spec.blending==='additive'&&palette.dark;
      const material=new PointsMaterial({size:spec.pointSize??.03,sizeAttenuation:true,map:dot,color:colors?new Color(1,1,1):colorOf(spec.color??'muted',palette),vertexColors:!!colors,transparent:true,opacity:spec.opacity??.8,depthWrite:false,alphaTest:.01,blending:additive?AdditiveBlending:NormalBlending});
      disposables.push(material);
      const points=new Points(geometry,material),motion=spec.motion||{kind:'drift',speed:.2},axis=axisOf(motion.axis),q=new Quaternion(),p=new Vector3();
      let low=Infinity,high=-Infinity;for(let i=1;i<base.length;i+=3){low=Math.min(low,base[i]);high=Math.max(high,base[i]);}const span=Math.max(.01,high-low);
      if(motion.kind!=='still')frameHooks.push(t=>{const speed=motion.speed??.2;
        for(let i=0;i<count;i++){const k=i*3;p.set(base[k],base[k+1],base[k+2]);
          if(motion.kind==='drift'){const w=phase[k+2];p.x+=speed*.3*Math.sin(t*w+phase[k]);p.y+=speed*.3*Math.sin(t*w*.8+phase[k+1]);p.z+=speed*.3*Math.sin(t*w*1.2+phase[k]+phase[k+1]);}
          else if(motion.kind==='swirl'){const along=axis.dot(p),d=Math.sqrt(Math.max(0,p.lengthSq()-along*along));p.applyQuaternion(q.setFromAxisAngle(axis,speed*t/(.4+d)));}
          else if(motion.kind==='rise'||motion.kind==='fall'){const shift=(motion.kind==='rise'?1:-1)*speed*.3*t;p.y=low+(((p.y-low+shift)%span)+span)%span;}
          else if(motion.kind==='breathe')p.multiplyScalar(1+(motion.amplitude??.1)*Math.sin(TAU*t/(motion.period??10)+phase[k]*.3));
          live[k]=p.x;live[k+1]=p.y;live[k+2]=p.z;}
        (geometry.getAttribute('position') as BufferAttribute).needsUpdate=true;});
      node=points;
    }else{
      const points=spec.points.map((p:number[])=>new Vector3(p[0],p[1],p[2])),sampled=spec.smooth?new CatmullRomCurve3(points,!!spec.closed,'centripetal').getPoints(Math.min(2048,points.length*8)):points;
      const geometry=new BufferGeometry().setFromPoints(sampled),material=new LineBasicMaterial({color:colorOf(spec.color??'muted',palette),transparent:(spec.opacity??1)<1,opacity:spec.opacity??1});
      disposables.push(geometry,material);node=spec.closed&&!spec.smooth?new LineLoop(geometry,material):new Line(geometry,material);
    }
    track(node,spec);return node;
  };
  for(const spec of data.objects)scene.add(nodeOf(spec));
  if(triangles>TRIANGLE_CEILING)throw new Error(`The scene builds ${Math.round(triangles)} triangles, over Reader’s ceiling`);
  // Lights: the scene's own, else a soft sky and one key light from the upper left.
  const lights=data.lights?.length?data.lights:[{type:'hemisphere',color:'bright',ground:'bg',intensity:.9},{type:'directional',color:'bright',intensity:1.4,position:[3,4,5]}];
  for(const spec of lights){
    const color=colorOf(spec.color??'bright',palette);let light:Object3D;
    if(spec.type==='ambient')light=new AmbientLight(color,spec.intensity??.6);
    else if(spec.type==='hemisphere')light=new HemisphereLight(color,colorOf(spec.ground??'bg',palette),spec.intensity??.9);
    else if(spec.type==='directional'){const d=new DirectionalLight(color,spec.intensity??1.4);d.position.copy(vec(spec.position,[3,4,5]));d.target.position.copy(vec(spec.target,[0,0,0]));scene.add(d.target);light=d;}
    else if(spec.type==='point'){const p=new PointLight(color,spec.intensity??8,spec.distance??0,spec.decay??2);p.position.copy(vec(spec.position,[0,2,2]));light=p;}
    else{const s=new SpotLight(color,spec.intensity??10,spec.distance??0,spec.angle??.6,spec.penumbra??.4);s.position.copy(vec(spec.position,[0,4,3]));s.target.position.copy(vec(spec.target,[0,0,0]));scene.add(s.target);light=s;}
    scene.add(light);
    if(spec.type==='point'&&(spec.id||spec.animate?.length))track(light,spec);
  }
  // Tethers between objects, redrawn every frame.
  const links=(data.links||[]).map((spec:J)=>{const geometry=new BufferGeometry(),buffer=new Float32Array(17*3);geometry.setAttribute('position',new BufferAttribute(buffer,3));
    const material=new LineBasicMaterial({color:colorOf(spec.color??'faint',palette),transparent:true,opacity:spec.opacity??.7});disposables.push(geometry,material);const line=new Line(geometry,material);line.frustumCulled=false;scene.add(line);
    return {spec,buffer,geometry};});
  // Dependent animations run after the independent ones, each after its target (follow and orbit chains are acyclic).
  const DEPENDENT={orbit:'around',follow:'target',look:'target',react:'source'} as Record<string,string>;
  const order:Animated[]=[];{const seen=new Set<Animated>(),byNode=new Map(animated.map(a=>[a.node,a]));
    const visit=(a:Animated)=>{if(seen.has(a))return;seen.add(a);for(const item of a.list){const key=DEPENDENT[item.kind];const target=key&&item[key]?ids.get(item[key]):null;const other=target&&byNode.get(target);if(other)visit(other);}order.push(a);};
    animated.forEach(visit);}
  const w=new Vector3(),goal=new Vector3(),turn=new Quaternion();
  const worldOf=(id:string)=>{const node=ids.get(id);return node?node.getWorldPosition(new Vector3()):new Vector3();};
  const toLocal=(node:Object3D,world:Vector3)=>node.parent?node.parent.worldToLocal(world.clone()):world.clone();
  const wanderSeeds=new Map<J,number[]>();
  const update=(t:number,dt:number)=>{
    for(const a of animated){a.node.position.copy(a.p);a.node.quaternion.copy(a.q);a.node.scale.copy(a.s);a.materials.forEach((m,i)=>{m.opacity=a.opacity[i];(m as MeshStandardMaterial).emissiveIntensity=a.emissive[i];});}
    for(const a of animated)for(const item of a.list){
      if(item.kind==='spin')a.node.quaternion.multiply(turn.setFromAxisAngle(axisOf(item.axis),(item.direction??1)*TAU*t/item.period));
      else if(item.kind==='oscillate'){const v=item.amplitude*Math.sin(TAU*(t/item.period+(item.phase??0))),[group,axis]=item.property.split('.');
        if(group==='position')(a.node.position as J)[axis]+=v;else if(group==='rotation'){a.node.quaternion.multiply(turn.setFromAxisAngle(axisOf(axis),v));}
        else if(group==='scale')a.node.scale.multiplyScalar(Math.max(.001,1+v));
        else if(group==='opacity')a.materials.forEach((m,i)=>{m.opacity=Math.max(0,Math.min(1,a.opacity[i]+v));});
        else a.materials.forEach((m,i)=>{(m as MeshStandardMaterial).emissiveIntensity=Math.max(0,a.emissive[i]+v);});}
      else if(item.kind==='orbit'&&!item.around){const center=item.center?vec(item.center,[0,0,0]):a.p.clone();a.node.position.copy(center.add(orbitOffset(item,t)));}
      else if(item.kind==='wander'){let seeds=wanderSeeds.get(item);if(!seeds){const r=mulberry(item.seed??(data.seed??1)+animated.indexOf(a));seeds=Array.from({length:9},()=>r());wanderSeeds.set(item,seeds);}
        const s=(item.speed??.1)*TAU,amp=item.amplitude;a.node.position.x+=amp*(.6*Math.sin(t*s*(.6+seeds[0])+seeds[1]*TAU)+.4*Math.sin(t*s*(1.3+seeds[2])+seeds[3]*TAU));
        a.node.position.y+=amp*(.6*Math.sin(t*s*(.5+seeds[4])+seeds[5]*TAU)+.4*Math.sin(t*s*(1.1+seeds[6])));a.node.position.z+=amp*.6*Math.sin(t*s*(.7+seeds[7])+seeds[8]*TAU);}
    }
    scene.updateMatrixWorld(true);
    for(const a of order){let moved=false;
      for(const item of a.list){
        if(item.kind==='orbit'&&item.around){a.node.position.copy(toLocal(a.node,worldOf(item.around).add(orbitOffset(item,t))));moved=true;}
        else if(item.kind==='follow'){goal.copy(worldOf(item.target)).add(vec(item.offset,[0,0,0]));
          if(!a.spring)a.spring={x:a.node.getWorldPosition(new Vector3()),v:new Vector3()};
          const k=item.stiffness??2,c=item.damping??1.2;let left=Math.min(dt,.25);
          while(left>1e-6){const h=Math.min(left,1/60);w.copy(goal).sub(a.spring.x).multiplyScalar(k).addScaledVector(a.spring.v,-c);a.spring.v.addScaledVector(w,h);a.spring.x.addScaledVector(a.spring.v,h);left-=h;}
          a.node.position.copy(toLocal(a.node,a.spring.x));moved=true;}
        else if(item.kind==='look'){a.node.updateMatrixWorld(true);a.node.lookAt(worldOf(item.target));moved=true;}
        else if(item.kind==='react'){const d=a.node.getWorldPosition(w).distanceTo(worldOf(item.source)),f=Math.max(0,Math.min(1,(d-item.near)/Math.max(1e-6,item.far-item.near))),v=item.from+(item.to-item.from)*f;
          if(item.property==='scale')a.node.scale.multiplyScalar(Math.max(.001,v));else if(item.property==='position.y')a.node.position.y+=v;
          else if(item.property==='opacity')a.materials.forEach(m=>{m.opacity=Math.max(0,Math.min(1,v));});else a.materials.forEach(m=>{(m as MeshStandardMaterial).emissiveIntensity=Math.max(0,v);});moved=true;}
      }
      if(moved)a.node.updateMatrixWorld(true);
    }
    for(const hook of frameHooks)hook(t);
    for(const link of links){const a=worldOf(link.spec.from),b=worldOf(link.spec.to),sag=link.spec.sag??0;
      for(let i=0;i<=16;i++){const u=i/16;goal.copy(a).lerp(b,u);goal.y-=sag*4*u*(1-u);link.buffer.set([goal.x,goal.y,goal.z],i*3);}
      (link.geometry.getAttribute('position') as BufferAttribute).needsUpdate=true;}
    // The camera: still, an orbit around its target, a sway, or a slow dolly.
    const motion=cam.motion||{kind:'sway',amplitude:.25,period:80},offset=eye.clone().sub(target);
    if(motion.kind==='orbit')offset.applyQuaternion(turn.setFromAxisAngle(axisOf(motion.axis),(motion.direction??1)*TAU*t/(motion.period??90)));
    else if(motion.kind==='sway')offset.applyQuaternion(turn.setFromAxisAngle(new Vector3(0,1,0),(motion.amplitude??.25)*Math.sin(TAU*t/(motion.period??80))));
    else if(motion.kind==='dolly')offset.multiplyScalar(1+(motion.amplitude??.1)*Math.sin(TAU*t/(motion.period??60)));
    last.copy(offset);aim();
  };
  // The reader's view (focus view): yaw about the vertical, pitch about the camera's side, then the zoom.
  const view:View={yaw:0,pitch:0,zoom:1},last=eye.clone().sub(target),side=new Vector3();
  function aim(){const offset=last.clone();
    if(view.yaw)offset.applyAxisAngle(new Vector3(0,1,0),view.yaw);
    if(view.pitch){side.crossVectors(new Vector3(0,1,0),offset).normalize();if(side.lengthSq()>1e-9)offset.applyAxisAngle(side,view.pitch);}
    camera.position.copy(target).add(offset.multiplyScalar(view.zoom));camera.lookAt(target);}
  return {scene,camera,update,triangles,view,aim,start:data.still?.at??0,dispose:()=>{for(const d of new Set(disposables))d.dispose();}};
}
function orbitOffset(item:J,t:number){const a=TAU*(t/item.period+(item.phase??0)),axis=axisOf(item.axis),offset=new Vector3(Math.cos(a),0,Math.sin(a)).multiplyScalar(item.radius);return offset.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),axis));}
/** Advance a built scene to `at` seconds with a fixed step, so stills are the same everywhere. */
function settle(built:Built,at:number){let t=0;built.update(0,0);while(t<at-1e-9){const h=Math.min(STEP,at-t);t+=h;built.update(t,h);}}

export class Stage{
  private renderer:WebGLRenderer|null=null;private live:LiveView|null=null;
  static create(){try{const probe=document.createElement('canvas');if(!probe.getContext('webgl2')&&!probe.getContext('webgl'))return null;return new Stage();}catch{return null;}}
  /** @internal */ context(){
    if(!this.renderer){const r=new WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:false,powerPreference:'low-power'});r.outputColorSpace=SRGBColorSpace;r.toneMapping=NeutralToneMapping;r.domElement.className='art-canvas';r.domElement.setAttribute('aria-hidden','true');this.renderer=r;}
    return this.renderer;
  }
  /** The frame at `still.at` as an image data URL (PNG unless asked for WebP). */
  still(data:J,palette:ArtPalette,width:number,height:number,{type='image/png',quality=.9}:{type?:string;quality?:number}={}):string{
    const renderer=this.context(),dpr=Math.min(2,devicePixelRatio||1),built=build(data,palette,width/height);
    const live=this.live;live?.pause();
    try{settle(built,built.start);renderer.setPixelRatio(dpr);renderer.setSize(width,height,false);renderer.render(built.scene,built.camera);return renderer.domElement.toDataURL(type,quality);}
    finally{built.dispose();if(live)live.resume();else this.release();}
  }
  /** The live view: one canvas, gentle motion capped at 30 fps, paused off-screen and in hidden tabs. */
  mount(host:HTMLElement,data:J,palette:ArtPalette,options:Mounted={}):ArtView{
    this.live?.destroy();const view=new LiveView(this,this.context(),host,data,palette,options);this.live=view;return view;
  }
  /** @internal */ ended(view:LiveView){if(this.live===view){this.live=null;this.release();}}
  /** Give the WebGL context back while nothing is live (the page turn has its own). */
  release(){if(this.live||!this.renderer)return;const r=this.renderer;this.renderer=null;r.domElement.remove();r.dispose();r.forceContextLoss();}
}

class LiveView implements ArtView{
  frames=0;still=false;reason:string|null=null;private built:Built;private gaps:number[]=[];private began=performance.now();private frame=0;private last=-Infinity;private clock:number;private visible=true;private paused=false;private dead=false;
  private observer:IntersectionObserver;private resize:ResizeObserver;private timings:number[]=[];private width=0;private height=0;private slow=0;
  private readonly onVisibility=()=>this.schedule();private readonly onLost=(event:Event)=>{event.preventDefault();this.destroy();this.options.onLost?.();};
  constructor(private stage:Stage,private renderer:WebGLRenderer,private host:HTMLElement,data:J,palette:ArtPalette,private options:Mounted){
    const dpr=Math.min(2,devicePixelRatio||1);this.measure();
    const begin=performance.now();this.built=build(data,palette,this.width/this.height);settle(this.built,this.built.start);this.clock=this.built.start;
    renderer.setPixelRatio(dpr);renderer.setSize(this.width,this.height,false);host.append(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost',this.onLost);
    this.observer=new IntersectionObserver(entries=>{this.visible=entries.some(e=>e.isIntersecting);this.schedule();});this.observer.observe(host);
    this.resize=new ResizeObserver(()=>{const w=this.width,h=this.height;this.measure();if(w!==this.width||h!==this.height){this.renderer.setSize(this.width,this.height,false);this.built.camera.aspect=this.width/this.height;this.built.camera.updateProjectionMatrix();this.draw(0);}});this.resize.observe(host);
    document.addEventListener('visibilitychange',this.onVisibility);
    if(options.interactive)this.interact();
    this.renderer.compile(this.built.scene,this.built.camera);this.draw(0);
    const info=this.renderer.info.memory;
    if(performance.now()-begin>2500||info.geometries+info.textures>MAX_GPU_OBJECTS){this.toStill('budget');return;}
    this.schedule();
  }
  get view(){return this.built.view;}
  /** Drag to turn around the scene, wheel or pinch-free +/− to zoom, arrows to turn, 0 to reset (the focus view). */
  private interact(){
    const el=this.renderer.domElement,view=this.built.view,clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
    const apply=()=>{view.pitch=clamp(view.pitch,-1.2,1.2);view.zoom=clamp(view.zoom,.35,3);this.built.aim();if(!this.frame)this.draw(0);};
    let drag:{x:number;y:number}|null=null;el.style.touchAction='none';el.style.cursor='grab';
    el.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};el.setPointerCapture(e.pointerId);el.style.cursor='grabbing';});
    el.addEventListener('pointermove',e=>{if(!drag)return;view.yaw-=(e.clientX-drag.x)*.006;view.pitch+=(e.clientY-drag.y)*.006;drag={x:e.clientX,y:e.clientY};apply();});
    const end=()=>{drag=null;el.style.cursor='grab';};el.addEventListener('pointerup',end);el.addEventListener('pointercancel',end);
    el.addEventListener('wheel',e=>{e.preventDefault();view.zoom*=Math.exp(e.deltaY*.0015);apply();},{passive:false});
    this.host.addEventListener('keydown',e=>{const k=e.key,step=.12;
      if(k==='ArrowLeft')view.yaw+=step;else if(k==='ArrowRight')view.yaw-=step;else if(k==='ArrowUp')view.pitch-=step;else if(k==='ArrowDown')view.pitch+=step;
      else if(k==='+'||k==='=')view.zoom/=1.15;else if(k==='-'||k==='_')view.zoom*=1.15;else if(k==='0'){view.yaw=view.pitch=0;view.zoom=1;}else return;
      e.preventDefault();e.stopPropagation();apply();});
  }
  frameTimes(){return [...this.timings];}
  intervals(){return [...this.gaps];}
  private measure(){this.width=Math.max(1,Math.round(this.host.clientWidth));this.height=Math.max(1,Math.round(this.host.clientHeight));}
  private draw(dt:number){if(this.dead)return 0;const begin=performance.now();if(dt)this.built.update(this.clock,dt);this.renderer.render(this.built.scene,this.built.camera);this.frames++;
    const owner=(this.host.closest('figure')||this.host) as HTMLElement;owner.dataset.frames=String(this.frames);return performance.now()-begin;}
  private schedule(){cancelAnimationFrame(this.frame);if(this.dead||this.paused||!this.visible||document.hidden||!this.host.isConnected){if(!this.host.isConnected)this.destroy();return;}this.frame=requestAnimationFrame(now=>this.tick(now));}
  private tick(now:number){
    if(!this.host.isConnected){this.destroy();return;}
    if(now-this.last>=1000/FPS-1){
      if(this.last!==-Infinity){this.gaps.push(now-this.last);if(this.gaps.length>120)this.gaps.shift();}
      const step=this.last===-Infinity?1/FPS:Math.min(now-this.last,250)/1000;this.last=now;this.clock+=step;
      const spent=this.draw(step);this.timings.push(spent);if(this.timings.length>120)this.timings.shift();
      // The kill switch: after the first frames (shader compilation), a slow median or a sustained slow average makes it a still.
      if(this.frames===WARM+PROBE+1){const probe=this.timings.slice(-PROBE).sort((a,b)=>a-b);if(probe[PROBE>>1]>BUDGET_MS){this.toStill('slow');return;}}
      this.slow=spent>SUSTAINED_MS?this.slow+1:Math.max(0,this.slow-2);if(this.slow>90){this.toStill('slow');return;}
      // Submitting a frame can be cheap while the GPU falls behind: a page that cannot keep 8 fps also becomes a still.
      if(this.gaps.length>=8&&now-this.began>2000){const recent=this.gaps.slice(-45).sort((a,b)=>a-b);if(recent[recent.length>>1]>SLOW_INTERVAL_MS){this.toStill('slow');return;}}
    }
    this.schedule();
  }
  private toStill(reason:string){
    settle(this.built,this.built.start);this.renderer.render(this.built.scene,this.built.camera);
    const url=this.renderer.domElement.toDataURL('image/png');this.still=true;this.reason=reason;this.destroy();this.options.onStill?.(url,reason);
  }
  pause(){this.paused=true;cancelAnimationFrame(this.frame);}
  resume(){if(this.dead)return;this.paused=false;const dpr=Math.min(2,devicePixelRatio||1);this.renderer.setPixelRatio(dpr);this.renderer.setSize(this.width,this.height,false);this.last=-Infinity;this.draw(0);this.schedule();}
  destroy(){
    if(this.dead)return;this.dead=true;cancelAnimationFrame(this.frame);this.observer.disconnect();this.resize.disconnect();document.removeEventListener('visibilitychange',this.onVisibility);
    this.renderer.domElement.removeEventListener('webglcontextlost',this.onLost);
    this.built.dispose();if(this.renderer.domElement.parentElement===this.host)this.renderer.domElement.remove();this.stage.ended(this);
  }
}

let stage:Stage|null|undefined;
/** The page's one art stage, or null without WebGL. */
export function artStage(){if(stage===undefined)stage=Stage.create();return stage;}
