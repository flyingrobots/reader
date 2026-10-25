/* Three.js page turn for two-page reading. Loaded on demand (`controls/page-turn.js`).

   One sheet is curled around a moving arc of constant curvature, so its arc length
   (the paper) never stretches. Its spine edge rotates by a(t) and its free edge by
   e(t) ≥ a(t); the bottom corner leads, giving the diagonal of a hand-turned page.
   The front carries the outgoing page, the back the incoming one. A static plane
   holds the outgoing facing page until the sheet lands, and a soft shadow follows
   the free edge. At t = 0 and t = 1 every shading term is exactly 1, so the first
   and last frames match the DOM pixel for pixel and the overlay can disappear. */
import {CanvasTexture, DoubleSide, LinearFilter, LinearSRGBColorSpace, Mesh, NoColorSpace, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, Texture, WebGLRenderer} from 'three';
import {rasterize, type Box} from './rasterize';
import {warmSvgImages} from './svg-images';
export {rasterize, warmSvgImages};

const SHEET_VERTEX=`
uniform float uW, uH, uDir, uT, uSpine, uCenterY;
varying vec2 vUv; varying vec3 vN;
const float PI=3.14159265;
void main(){
  float s=uv.x*uW, v=uv.y;
  float ease=uT*uT*(3.0-2.0*uT), lift=sin(PI*uT);
  float a=PI*pow(ease,1.55);
  float e=min(PI, PI*pow(ease,0.62)+0.55*lift*(1.0-v));
  e=max(e,a);
  float b=(e-a)/uW, phi=a+b*s;
  float X=b<1e-5? s*cos(a) : (sin(phi)-sin(a))/b;
  float Z=b<1e-5? s*sin(a) : (cos(a)-cos(phi))/b;
  vec3 p=vec3(uSpine+uDir*X, uCenterY+(v-0.5)*uH, Z+0.6*lift+0.01);
  vN=vec3(-uDir*sin(phi), 0.0, cos(phi));
  vUv=uv;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
}`;
const SHEET_FRAGMENT=`
uniform sampler2D uFront, uBack; uniform float uDir, uT;
varying vec2 vUv; varying vec3 vN;
void main(){
  bool front=vN.z>=0.0;
  vec2 uvFront=uDir>0.0? vUv : vec2(1.0-vUv.x, vUv.y);
  vec2 uvBack =uDir>0.0? vec2(1.0-vUv.x, vUv.y) : vUv;
  vec4 c=front? texture2D(uFront, uvFront) : texture2D(uBack, uvBack);
  float nz=abs(normalize(vN).z);
  float light=1.0-0.42*(1.0-nz)+0.10*pow(1.0-nz,3.0)*nz*4.0;
  // Paper is not a mirror: a faint sheen across the curl, zero when flat.
  float sheen=0.06*sin(3.14159*uT)*pow(nz,24.0)*(1.0-nz*nz)*8.0;
  gl_FragColor=vec4(c.rgb*light+sheen, 1.0);
}`;
const SHADOW_VERTEX=`varying vec2 vP; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vP=w.xy; gl_Position=projectionMatrix*viewMatrix*w;}`;
const SHADOW_FRAGMENT=`
uniform float uT, uEdge, uSpine, uW, uDir; varying vec2 vP;
void main(){
  float lift=sin(3.14159*uT);
  float d=abs(vP.x-uEdge);
  float castShadow=0.30*lift*exp(-d/(uW*0.16));
  float gutter=0.10*lift*exp(-abs(vP.x-uSpine)/24.0);
  gl_FragColor=vec4(0.0,0.0,0.0,min(0.45,castShadow+gutter));
}`;

export type TurnRequest={viewport:HTMLElement;article:HTMLElement;direction:1|-1;stride:number;commit:()=>void;duration?:number};

export class PageTurner{
  private renderer:WebGLRenderer;private scene=new Scene();private camera=new PerspectiveCamera(20,1,1,20000);
  private canvas:HTMLCanvasElement;private running:{finish:()=>void}|null=null;
  static create(){try{const probe=document.createElement('canvas');if(!probe.getContext('webgl2')&&!probe.getContext('webgl'))return null;return new PageTurner();}catch{return null;}}
  private constructor(){
    this.canvas=document.createElement('canvas');this.canvas.className='page-turn-canvas';this.canvas.setAttribute('aria-hidden','true');
    this.renderer=new WebGLRenderer({canvas:this.canvas,alpha:true,antialias:true,premultipliedAlpha:true});
    this.renderer.outputColorSpace=LinearSRGBColorSpace;this.renderer.setClearColor(0x000000,0);
  }
  get busy(){return !!this.running;}
  finish(){this.running?.finish();}
  /** Release the WebGL context (a split pane that loses focus gives its context up). */
  dispose(){this.finish();this.renderer.dispose();this.renderer.forceContextLoss();}
  private texture(canvas:HTMLCanvasElement){const t=new CanvasTexture(canvas);t.colorSpace=NoColorSpace;t.minFilter=LinearFilter;t.generateMipmaps=false;t.anisotropy=this.renderer.capabilities.getMaxAnisotropy();return t;}

  /** Flip one sheet. Resolves after the overlay is removed and `commit` has run. */
  turn({viewport,article,direction,stride,commit,duration=900}:TurnRequest):Promise<void>{
    this.finish();
    const vp=viewport.getBoundingClientRect(),half=vp.width/2,dpr=Math.min(2,devicePixelRatio||1);
    const left:Box={x:vp.left,y:vp.top,w:half,h:vp.height},right:Box={x:vp.left+half,y:vp.top,w:half,h:vp.height};
    // The page color is the theme's --bg, resolved to a concrete color (the body itself may be transparent).
    const probe=document.createElement('span');probe.style.cssText='position:absolute;visibility:hidden;color:var(--bg)';viewport.append(probe);const background=getComputedStyle(probe).color;probe.remove();
    const [frontBox,backBox,staticBox,backShift]=direction>0?[right,left,left,stride]:[left,right,right,-stride];
    const textures:Texture[]=[rasterize(article,frontBox,0,background,dpr),rasterize(article,backBox,backShift,background,dpr),rasterize(article,staticBox,0,background,dpr)].map(c=>this.texture(c));
    const [front,back,still]=textures;
    // World units are CSS pixels; z = 0 maps 1:1 onto the window.
    const W=innerWidth,H=innerHeight,toX=(x:number)=>x-W/2,toY=(y:number)=>H/2-y;
    this.renderer.setPixelRatio(dpr);this.renderer.setSize(W,H,false);
    this.camera.aspect=W/H;this.camera.position.set(0,0,(H/2)/Math.tan(this.camera.fov*Math.PI/360));this.camera.lookAt(0,0,0);this.camera.updateProjectionMatrix();
    const spine=toX(vp.left+half),centerY=toY(vp.top+vp.height/2);
    const uniforms={uW:{value:half},uH:{value:vp.height},uDir:{value:direction},uT:{value:0},uSpine:{value:spine},uCenterY:{value:centerY},uFront:{value:front},uBack:{value:back}};
    const sheet=new Mesh(new PlaneGeometry(1,1,96,32),new ShaderMaterial({uniforms,vertexShader:SHEET_VERTEX,fragmentShader:SHEET_FRAGMENT,side:DoubleSide}));
    sheet.frustumCulled=false;
    const stillMesh=new Mesh(new PlaneGeometry(half,vp.height),new ShaderMaterial({uniforms:{map:{value:still}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform sampler2D map;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(map,vUv).rgb,1.0);}'}));
    stillMesh.position.set(toX(staticBox.x+half/2),centerY,0);
    const shadowUniforms={uT:{value:0},uEdge:{value:spine},uSpine:{value:spine},uW:{value:half},uDir:{value:direction}};
    const shadow=new Mesh(new PlaneGeometry(vp.width,vp.height),new ShaderMaterial({uniforms:shadowUniforms,vertexShader:SHADOW_VERTEX,fragmentShader:SHADOW_FRAGMENT,transparent:true,depthWrite:false}));
    shadow.position.set(toX(vp.left+half),centerY,0.3);
    this.scene.add(stillMesh,shadow,sheet);
    const edgeAt=(t:number)=>{const ease=t*t*(3-2*t),lift=Math.sin(Math.PI*t),a=Math.PI*ease**1.55,e=Math.max(a,Math.min(Math.PI,Math.PI*ease**.62+.55*lift*.5)),b=(e-a)/half;return spine+direction*(b<1e-5?half*Math.cos(a):(Math.sin(a+b*half)-Math.sin(a))/b);};
    const draw=(t:number)=>{uniforms.uT.value=t;shadowUniforms.uT.value=t;shadowUniforms.uEdge.value=edgeAt(t);this.renderer.render(this.scene,this.camera);};
    document.body.append(this.canvas);document.body.classList.add('page-turning');
    draw(0);commit();
    return new Promise(resolve=>{
      let frame=0,done=false;const start=performance.now();
      const finish=()=>{if(done)return;done=true;cancelAnimationFrame(frame);this.running=null;this.scene.remove(stillMesh,shadow,sheet);
        for(const mesh of [stillMesh,shadow,sheet]){mesh.geometry.dispose();(mesh.material as ShaderMaterial).dispose();}textures.forEach(t=>t.dispose());
        this.canvas.remove();document.body.classList.remove('page-turning');resolve();};
      this.running={finish};
      const tick=()=>{const t=Math.min(1,(performance.now()-start)/duration);draw(t);if(t<1)frame=requestAnimationFrame(tick);else finish();};
      frame=requestAnimationFrame(tick);
    });
  }
}
export function createPageTurner(){return PageTurner.create();}

// Keep SVG images current for the two-page article: after diagrams or formulas render, and after a
// theme change (data-theme, a live Theme Editor style, or custom theme sheets).
let warmTimer=0;
const bookArticle=()=>document.querySelector('.book-viewport > .article');
export function scheduleWarm(delay=120){clearTimeout(warmTimer);warmTimer=window.setTimeout(()=>{const article=bookArticle();if(article)warmSvgImages(article);},delay);}
document.addEventListener('reader:diagram',()=>scheduleWarm());
document.addEventListener('reader:math',()=>scheduleWarm());
window.addEventListener('resize',()=>scheduleWarm(400));
new MutationObserver(()=>scheduleWarm()).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','style']});
new MutationObserver(()=>scheduleWarm()).observe(document.head,{childList:true,subtree:true,characterData:true});
