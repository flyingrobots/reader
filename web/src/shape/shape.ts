/* Article shapes (experiment): a Three.js scene drawn from /api/shape. Loaded on demand
   (`controls/shape.js`), sharing its Three.js chunk with the page turn.

   The ribbon is a tube along a Catmull-Rom curve through the passages in reading order,
   bright at the start and cooler toward the end; beads are instanced spheres (one per
   passage), rings mark headings, key terms are canvas-textured sprites and the nearest
   works are faint points in the direction their ideas lie. Geometry comes only from the
   data; a PRNG seeded by the source digest drives only the slow motion, so the frame at
   t = 0 is the same for the same source and theme. One renderer (one WebGL context) is
   shared by every view on the page: at most one live canvas, and stills rendered to images. */
import {AmbientLight, CanvasTexture, CatmullRomCurve3, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, BufferGeometry, Group, InstancedMesh, LinearFilter, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, Points, PointsMaterial, Quaternion, Scene, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, TorusGeometry, TubeGeometry, Vector3, WebGLRenderer} from 'three';

export type ShapeData={seed:number;form:'full'|'terms';points:number[][];lines:number[];weights:number[];threads:number[];headings:number[];terms:{text:string;i:number}[];neighbours:{path:string;title:string;xyz:number[]}[];variance:number[]|null;count:number};
type RGB=[number,number,number];
export type Palette={series:RGB[];ink:RGB;muted:RGB;accent:RGB;bg:RGB;sans:string};
/** Positions in CSS pixels relative to the view: beads [x, y, radius] and stars [x, y]. */
export type Layout={beads:[number,number,number][];stars:[number,number][]};
export type LiveView={layout():Layout;highlight(index:number|null):void;destroy():void;readonly frames:number;readonly still:boolean};

const TURN=90, BREATH=7, DRIFT=120, FPS=30, BUDGET_MS=40, STAR_RADIUS=2.1, FOV=32, DISTANCE=3.75;
const color=(rgb:RGB)=>new Color().setRGB(rgb[0]/255,rgb[1]/255,rgb[2]/255,SRGBColorSpace);
function mulberry(seed:number){let a=seed>>>0;return ()=>{a=(a+0x6d2b79f5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}

type Built={scene:Scene;group:Group;camera:PerspectiveCamera;update(t:number):void;highlight(i:number|null):void;layout(w:number,h:number):Layout;dispose():void};

function build(data:ShapeData,palette:Palette,aspect:number,{labels=true,dpr=1}:{labels?:boolean;dpr?:number}):Built{
  const scene=new Scene(),group=new Group();scene.add(group);
  scene.add(new AmbientLight(0xffffff,2.1));const sun=new DirectionalLight(0xffffff,1.1);sun.position.set(-2,3,4);scene.add(sun);
  const camera=new PerspectiveCamera(FOV,aspect,.1,50);camera.position.set(0,0,DISTANCE);camera.lookAt(0,0,0);
  const disposables:{dispose():void}[]=[];
  const points=data.points.map(p=>new Vector3(p[0],p[1],p[2]));
  const n=points.length,start=color(palette.series[0]),end=color(palette.series[1]),bg=color(palette.bg),accent=color(palette.accent);
  // Bright where the argument starts, cooler (toward the page colour) as it goes.
  const along=(u:number)=>start.clone().lerp(end,u).lerp(bg,.38*u);
  const random=mulberry(data.seed);
  if(n>1){
    const curve=new CatmullRomCurve3(points,false,'centripetal');
    const segments=Math.min(1200,Math.max(32,n*6)),radial=6;
    const tube=new TubeGeometry(curve,segments,.0105,radial,false);
    const count=tube.getAttribute('position').count,colors=new Float32Array(count*3);
    for(let v=0;v<count;v++){const c=along(Math.min(1,Math.floor(v/(radial+1))/segments));colors[v*3]=c.r;colors[v*3+1]=c.g;colors[v*3+2]=c.b;}
    tube.setAttribute('color',new Float32BufferAttribute(colors,3));
    const material=new MeshBasicMaterial({vertexColors:true,transparent:true,opacity:.88});
    group.add(new Mesh(tube,material));
    disposables.push(tube,material);
    // Rings at headings, facing along the ribbon.
    if(data.headings.length){
      const torus=new TorusGeometry(1,.06,6,40),ringMaterial=new MeshBasicMaterial({color:color(palette.muted),transparent:true,opacity:.75,side:DoubleSide});
      const rings=new InstancedMesh(torus,ringMaterial,data.headings.length),q=new Quaternion(),m=new Matrix4(),z=new Vector3(0,0,1);
      data.headings.forEach((i,k)=>{const u=n>1?i/(n-1):0,tangent=curve.getTangentAt(Math.min(1,Math.max(0,u)));q.setFromUnitVectors(z,tangent.normalize());const s=.045+.035*(data.weights[i]||0);m.compose(points[Math.min(i,n-1)],q,new Vector3(s,s,s));rings.setMatrixAt(k,m);});
      group.add(rings);disposables.push(torus,ringMaterial);
    }
  }
  // Beads: one per passage; length (and margin threads) swell them, threads glow in the accent.
  const sphere=new SphereGeometry(1,18,12),beadMaterial=new MeshLambertMaterial({color:0xffffff});
  const beads=new InstancedMesh(sphere,beadMaterial,Math.max(1,n)),base=new Float32Array(n),phase=new Float32Array(n);
  for(let i=0;i<n;i++){base[i]=.018+.032*(data.weights[i]||0);phase[i]=random()*Math.PI*2;const c=along(n>1?i/(n-1):0);if(data.threads[i])c.lerp(accent,.75);beads.setColorAt(i,c);}
  group.add(beads);disposables.push(sphere,beadMaterial);
  const marker=new InstancedMesh(new SphereGeometry(1,18,12),new MeshBasicMaterial({color:color(palette.ink),transparent:true,opacity:.28,depthWrite:false}),1);marker.visible=false;group.add(marker);
  disposables.push(marker.geometry,marker.material as MeshBasicMaterial);
  // Neighbours: faint stars far out, in the direction of their projection.
  const stars=data.neighbours.map(s=>new Vector3(s.xyz[0],s.xyz[1],s.xyz[2]).normalize().multiplyScalar(STAR_RADIUS));
  if(stars.length){
    const dot=document.createElement('canvas');dot.width=dot.height=32;const g=dot.getContext('2d')!;g.fillStyle='#fff';g.beginPath();g.arc(16,16,15,0,Math.PI*2);g.fill();const sprite=new CanvasTexture(dot);
    const geometry=new BufferGeometry().setFromPoints(stars),material=new PointsMaterial({color:color(palette.muted),map:sprite,alphaTest:.3,size:5*dpr,sizeAttenuation:false,transparent:true,opacity:.65,depthWrite:false});disposables.push(sprite);
    group.add(new Points(geometry,material));disposables.push(geometry,material);
  }
  // Terms as text: crisp canvas sprites at the device pixel ratio, near where each matters most.
  const placed:Vector3[]=[];
  if(labels)data.terms.forEach((term,k)=>{
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!,size=Math.round(30*dpr),font=`${k<3?600:500} ${size}px ${palette.sans}`;
    ctx.font=font;const width=Math.ceil(ctx.measureText(term.text).width)+size;canvas.width=width;canvas.height=Math.round(size*1.5);
    ctx.font=font;ctx.textBaseline='middle';ctx.fillStyle=`rgb(${(k<3?palette.ink:palette.muted).join(',')})`;ctx.fillText(term.text,size/2,canvas.height/2);
    const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;texture.minFilter=LinearFilter;texture.generateMipmaps=false;
    const material=new SpriteMaterial({map:texture,transparent:true,depthWrite:false,depthTest:false}),sprite=new Sprite(material);
    const height=.12;sprite.scale.set(height*canvas.width/canvas.height,height,1);sprite.center.set(0,.5);
    const at=points[Math.min(term.i,n-1)]||new Vector3();sprite.position.copy(at).add(at.clone().normalize().multiplyScalar(.09)).add(new Vector3(.04,.03,0));
    // Terms whose passages lie close together on screen (an essay returning to its start) stack instead of overprinting.
    while(placed.some(p=>Math.abs(p.y-sprite.position.y)<height*1.05&&Math.abs(p.x-sprite.position.x)<.5))sprite.position.y-=height*1.15;placed.push(sprite.position.clone());
    sprite.renderOrder=10;group.add(sprite);disposables.push(texture,material);
  });
  const variance=data.variance||[.5,.3,.2],drift=Math.min(.42,.12+.6*((variance[1]||0)+(variance[2]||0)));
  const matrix=new Matrix4(),q=new Quaternion(),v=new Vector3();let marked:number|null=null;
  const update=(t:number)=>{
    group.rotation.set(.32+drift*Math.sin(2*Math.PI*t/DRIFT),2*Math.PI*t/TURN,0);
    for(let i=0;i<n;i++){const s=base[i]*(1+.07*Math.sin(2*Math.PI*t/BREATH+phase[i]));matrix.compose(points[i],q,v.set(s,s,s));beads.setMatrixAt(i,matrix);}
    beads.instanceMatrix.needsUpdate=true;if(beads.instanceColor)beads.instanceColor.needsUpdate=true;
    if(marked!==null&&points[marked]){const s=base[marked]*2.6+.02;matrix.compose(points[marked],q,v.set(s,s,s));marker.setMatrixAt(0,matrix);marker.instanceMatrix.needsUpdate=true;}
    group.updateMatrixWorld(true);
  };
  const highlight=(i:number|null)=>{marked=i!==null&&i>=0&&i<n?i:null;marker.visible=marked!==null;};
  const layout=(w:number,h:number):Layout=>{
    const project=(local:Vector3)=>{const p=local.clone().applyMatrix4(group.matrixWorld);const depth=camera.position.distanceTo(p);p.project(camera);return {x:(p.x+1)/2*w,y:(1-p.y)/2*h,scale:h/(2*Math.tan(FOV*Math.PI/360)*depth)};};
    return {beads:points.map((p,i)=>{const s=project(p);return [s.x,s.y,Math.max(5,base[i]*s.scale*1.4)] as [number,number,number];}),stars:stars.map(p=>{const s=project(p);return [s.x,s.y] as [number,number];})};
  };
  update(0);
  return {scene,group,camera,update,highlight,layout,dispose:()=>{disposables.forEach(d=>d.dispose());beads.dispose();marker.dispose();}};
}

export class Stage{
  private renderer:WebGLRenderer|null=null;private live:LiveViewImpl|null=null;
  static create(){try{const probe=document.createElement('canvas');if(!probe.getContext('webgl2')&&!probe.getContext('webgl'))return null;return new Stage();}catch{return null;}}
  private context(){
    if(!this.renderer){this.renderer=new WebGLRenderer({antialias:true,alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:false});this.renderer.setClearColor(0x000000,0);this.renderer.outputColorSpace=SRGBColorSpace;this.renderer.domElement.className='shape-canvas';this.renderer.domElement.setAttribute('aria-hidden','true');}
    return this.renderer;
  }
  /** One still frame (t = 0) as a PNG data URL, with where its beads and stars landed. */
  still(data:ShapeData,palette:Palette,width:number,height:number,{labels=true}:{labels?:boolean}={}):{url:string;layout:Layout}{
    const renderer=this.context(),dpr=Math.min(2,devicePixelRatio||1),built=build(data,palette,width/height,{labels,dpr});
    const live=this.live;live?.pause();
    renderer.setPixelRatio(dpr);renderer.setSize(width,height,false);renderer.render(built.scene,built.camera);
    const url=renderer.domElement.toDataURL('image/png'),layout=built.layout(width,height);built.dispose();
    if(live)live.resume();else this.release();
    return {url,layout};
  }
  /** The live view: one canvas, a slow orbit capped at 30 fps, paused off-screen and in hidden tabs. */
  mount(host:HTMLElement,data:ShapeData,palette:Palette,{onStill}:{onStill?:(url:string,layout:Layout)=>void}={}):LiveView{
    this.live?.destroy();
    const view=new LiveViewImpl(this,this.context(),host,data,palette,onStill);this.live=view;return view;
  }
  /** @internal */ ended(view:LiveViewImpl){if(this.live===view){this.live=null;this.release();}}
  /** Give the WebGL context back while nothing is live (the page turn has its own). */
  release(){if(this.live||!this.renderer)return;const r=this.renderer;this.renderer=null;r.domElement.remove();r.dispose();r.forceContextLoss();}
}

class LiveViewImpl implements LiveView{
  frames=0;still=false;private built:Built;private frame=0;private last=-Infinity;private clock=0;private started=0;private visible=true;private paused=false;private dead=false;
  private observer:IntersectionObserver;private resize:ResizeObserver;private timings:number[]=[];private width=0;private height=0;
  private readonly onVisibility=()=>this.schedule();
  constructor(private stage:Stage,private renderer:WebGLRenderer,private host:HTMLElement,private data:ShapeData,private palette:Palette,private onStill?:(url:string,layout:Layout)=>void){
    const dpr=Math.min(2,devicePixelRatio||1);this.measure();
    this.built=build(data,palette,this.width/this.height,{dpr});
    renderer.setPixelRatio(dpr);renderer.setSize(this.width,this.height,false);host.append(renderer.domElement);
    this.observer=new IntersectionObserver(entries=>{this.visible=entries.some(e=>e.isIntersecting);this.schedule();});this.observer.observe(host);
    this.resize=new ResizeObserver(()=>{const w=this.width,h=this.height;this.measure();if(w!==this.width||h!==this.height){this.renderer.setSize(this.width,this.height,false);this.built.camera.aspect=this.width/this.height;this.built.camera.updateProjectionMatrix();this.draw();}});this.resize.observe(host);
    document.addEventListener('visibilitychange',this.onVisibility);
    this.renderer.compile(this.built.scene,this.built.camera);
    this.draw();this.started=performance.now();this.schedule();
  }
  private measure(){this.width=Math.max(1,Math.round(this.host.clientWidth));this.height=Math.max(1,Math.round(this.host.clientHeight));}
  private draw(){if(this.dead)return;const begin=performance.now();this.built.update(this.clock);this.renderer.render(this.built.scene,this.built.camera);this.frames++;(this.host.closest("figure")||this.host).dataset.frames=String(this.frames);return performance.now()-begin;}
  private schedule(){cancelAnimationFrame(this.frame);if(this.dead||this.paused||!this.visible||document.hidden||!this.host.isConnected){if(!this.host.isConnected)this.destroy();return;}this.frame=requestAnimationFrame(now=>this.tick(now));}
  private tick(now:number){
    if(!this.host.isConnected){this.destroy();return;}
    if(now-this.last>=1000/FPS-1){
      const step=this.last===-Infinity?0:Math.min(now-this.last,250);this.last=now;this.clock+=step/1000;
      const spent=this.draw()||0;
      // The GPU budget: three slow frames in a row (after the shaders compiled) make it a still image.
      if(this.timings.length<3){this.timings.push(spent);if(this.timings.length===3&&Math.min(...this.timings)>BUDGET_MS){this.toStill();return;}}
    }
    this.schedule();
  }
  private toStill(){
    this.clock=0;this.built.update(0);this.renderer.render(this.built.scene,this.built.camera);
    const url=this.renderer.domElement.toDataURL('image/png'),layout=this.built.layout(this.width,this.height);
    this.still=true;this.destroy();this.onStill?.(url,layout);
  }
  pause(){this.paused=true;cancelAnimationFrame(this.frame);}
  resume(){if(this.dead)return;this.paused=false;const dpr=Math.min(2,devicePixelRatio||1);this.renderer.setPixelRatio(dpr);this.renderer.setSize(this.width,this.height,false);this.last=-Infinity;this.draw();this.schedule();}
  layout(){return this.built.layout(this.width,this.height);}
  highlight(index:number|null){this.built.highlight(index);if(!this.dead){this.built.update(this.clock);this.renderer.render(this.built.scene,this.built.camera);}}
  destroy(){
    if(this.dead)return;this.dead=true;cancelAnimationFrame(this.frame);this.observer.disconnect();this.resize.disconnect();document.removeEventListener('visibilitychange',this.onVisibility);
    this.built.dispose();if(this.renderer.domElement.parentElement===this.host)this.renderer.domElement.remove();this.stage.ended(this);
  }
}

let stage:Stage|null|undefined;
/** The page's one stage, or null without WebGL. */
export function shapeStage(){if(stage===undefined)stage=Stage.create();return stage;}
