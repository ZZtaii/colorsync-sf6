import {triangleUvFrame} from './compact-frame.js';
import {compactStudioLighting} from './compact-studio-lighting.js';
// CPU fallback for browsers without WebGL2. Real mesh geometry; approximate flat lighting.
import { validatePreviewGeometry, normalizePreviewMaterial } from './material-webgl-preview.js';
const norm=v=>{const n=Math.hypot(...v)||1;return v.map(x=>x/n);};
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const linear=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
function sampleTexture(texture,u,v){
 if(!texture||texture.compressed)return null;
 const x=Math.min(texture.width-1,Math.floor(((u%1+1)%1)*texture.width)),y=Math.min(texture.height-1,Math.floor(((v%1+1)%1)*texture.height));
 const i=(y*texture.width+x)*4;return Array.from(texture.data.slice(i,i+4),x=>x/255);
}
const srgb=x=>Math.round(255*Math.min(1,Math.max(0,x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055)));
export function rasterizePreview(mesh,materials,view={},options={},size=320){
 if(!Number.isInteger(size)||size<16||size>640)throw new Error('Invalid software preview resolution.');
 const framed=options.isolate?{...mesh,parts:mesh.parts.filter(p=>p.materialIndex===options.selectedMaterialIndex)}:mesh;const bounds=validatePreviewGeometry(framed.parts.length?framed:mesh),center=bounds.center,scale=bounds.scale;
 const yaw=(view.yaw??-25)*Math.PI/180,pitch=(view.pitch??0)*Math.PI/180,distance=(view.distance??1.55);
 const eye=[Math.sin(yaw)*Math.cos(pitch)*distance,Math.sin(pitch)*distance,Math.cos(yaw)*Math.cos(pitch)*distance];
 const forward=norm(eye.map(x=>-x)),right=norm(cross(forward,[0,1,0])),up=cross(right,forward);
 const pixels=new Uint8ClampedArray(size*size*4),depth=new Float32Array(size*size).fill(Infinity),ids=new Int32Array(size*size).fill(-1);
 for(let i=0;i<pixels.length;i+=4){pixels[i]=28;pixels[i+1]=30;pixels[i+2]=37;pixels[i+3]=255;}
 const light=norm([-.4,.8,.7]),f=size/(2*Math.tan(Math.PI/8));
 for(const part of mesh.parts){
  if(options.isolate&&part.materialIndex!==options.selectedMaterialIndex)continue;if(materials[part.materialIndex]?.skip)continue;
  const material=normalizePreviewMaterial(materials[part.materialIndex]??{});if(material.color[3]<.05)continue;
  const vertices=[];for(let i=0;i<part.positions.length;i+=3){const world=[0,1,2].map(j=>(part.positions[i+j]-center[j])*scale),v=sub(world,eye),z=dot(v,forward);let shade=null,vertexNormal=null;if(part.normals){let n=norm([part.normals[i],part.normals[i+1],part.normals[i+2]]);if(dot(n,sub(eye,world))<0)n=n.map(x=>-x);vertexNormal=n;shade=.2+.8*Math.max(0,dot(n,light));}vertices.push({world,z,shade,vertexNormal,uv:part.uvs?[part.uvs[i/3*2],part.uvs[i/3*2+1]]:null,x:size/2+dot(v,right)*f/z,y:size/2-dot(v,up)*f/z});}
  for(let i=0;i<part.indices.length;i+=3){
   const a=vertices[part.indices[i]],b=vertices[part.indices[i+1]],c=vertices[part.indices[i+2]];if(a.z<=.05||b.z<=.05||c.z<=.05)continue;
   const area=(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);if(Math.abs(area)<1e-8)continue;
   const minX=Math.max(0,Math.floor(Math.min(a.x,b.x,c.x))),maxX=Math.min(size-1,Math.ceil(Math.max(a.x,b.x,c.x))),minY=Math.max(0,Math.floor(Math.min(a.y,b.y,c.y))),maxY=Math.min(size-1,Math.ceil(Math.max(a.y,b.y,c.y)));
   let normal=norm(cross(sub(b.world,a.world),sub(c.world,a.world)));const directionalFrontFace=dot(normal,sub(eye,a.world))>=0;if(dot(normal,sub(eye,a.world))<0)normal=normal.map(x=>-x);
   const uvFrame=triangleUvFrame(a.world,b.world,c.world,a.uv,b.uv,c.uv);const shade=.2+.8*Math.max(0,dot(normal,light)),rgb=material.color.slice(0,3).map(x=>srgb(x*shade));
   for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
    const px=x+.5,py=y+.5,w1=((b.x-px)*(c.y-py)-(b.y-py)*(c.x-px))/area,w2=((c.x-px)*(a.y-py)-(c.y-py)*(a.x-px))/area,w3=1-w1-w2;
    if(w1<0||w2<0||w3<0)continue;const z=1/(w1/a.z+w2/b.z+w3/c.z),p=y*size+x;if(z>=depth[p])continue;
    let compact=null,sampleUV=null;let base=materials[part.materialIndex]?.maskViewSlot!=null?[0,0,0,1]:material.color.slice();if(a.uv){const u=(w1*a.uv[0]/a.z+w2*b.uv[0]/b.z+w3*c.uv[0]/c.z)*z,v=(w1*a.uv[1]/a.z+w2*b.uv[1]/b.z+w3*c.uv[1]/c.z)*z;
    sampleUV={u,v};const raw=materials[part.materialIndex]??{};if(raw.compactSurface)compact=raw.compactSurface.evaluate({u,v});const tex=sampleTexture(raw.albedoTexture,u,v);if(tex){for(let j=0;j<3;j++)base[j]*=linear(tex[j]);if(raw.albedoAlpha!==false)base[3]*=tex[3];}const opacity=sampleTexture(raw.opacityTexture,u,v);if(opacity)base[3]*=opacity[raw.opacityChannel??0];
    let tint=[1,1,1];for(const layer of raw.maskLayers??[]){const mask=sampleTexture(layer.texture,u,v);if(mask){const weight=Math.max(0,Math.min(1,mask[layer.channel]*(layer.blendRate??1)));if(raw.maskViewSlot!=null&&raw.maskViewSlot===layer.slotIndex){base=[weight,weight,weight,1];break;}for(let j=0;j<3;j++){if(raw.maskMode==='sf6-tint-mix')tint[j]=tint[j]*(1-weight)+2*layer.color[j]*weight;else if(raw.maskMode==='sf6-tint-multiply')tint[j]*=(1-weight)+2*layer.color[j]*weight;else base[j]=base[j]*(1-weight)+layer.color[j]*weight;}}}
    if(raw.maskViewSlot!=null&&raw.maskViewSlot===raw.uniformTintSlot)base=[1,1,1,base[3]];
    if(raw.maskViewSlot==null&&raw.maskMode?.startsWith('sf6-tint-'))for(let j=0;j<3;j++)base[j]*=tint[j];
   }if(base[3]<(materials[part.materialIndex]?.alphaCutoff??.05))continue;
   depth[p]=z;ids[p]=part.materialIndex;const brightness=materials[part.materialIndex]?.maskViewSlot!=null?1:a.shade==null?shade:(w1*a.shade/a.z+w2*b.shade/b.z+w3*c.shade/c.z)*z;let lit=base.slice(0,3).map(v=>srgb(v*brightness));if(compact&&materials[part.materialIndex]?.maskViewSlot==null){if(materials[part.materialIndex].compactSurface.provenance?.material==='esf_ClothA_Suits')base=base.map((v,i)=>i<3?Math.min(1,Math.max(0,v)):v);const mode=materials[part.materialIndex].compactView??'finish';if(mode==='roughness'||mode==='metalness'||mode==='cavity')lit=[0,1,2].map(()=>srgb(compact[mode]));else if(mode==='finish'||mode==='constant'||mode==='directional'){if(mode==='constant')compact={...compact,roughness:.65,metalness:0};const pos=[0,1,2].map(j=>(w1*a.world[j]/a.z+w2*b.world[j]/b.z+w3*c.world[j]/c.z)*z),V=norm(sub(eye,pos)),H=norm(light.map((v,j)=>v+V[j])),N=a.vertexNormal?norm([0,1,2].map(j=>(w1*a.vertexNormal[j]/a.z+w2*b.vertexNormal[j]/b.z+w3*c.vertexNormal[j]/c.z)*z)):normal;if(mode==='directional'&&directionalFrontFace&&uvFrame&&sampleUV&&materials[part.materialIndex].compactSurface.evaluateDirectional){const adjusted=materials[part.materialIndex].compactSurface.evaluateDirectional({...sampleUV,color:base.slice(0,3),roughness:compact.roughness,metalness:compact.metalness,frame:{geometricNormal:N,shadedNormal:N,...uvFrame,sceneRows:[right,up,forward.map(v=>-v)]}});base=[...adjusted.color,base[3]];compact={...compact,roughness:adjusted.roughness,metalness:adjusted.metalness};}lit=compactStudioLighting(base,compact,Math.max(0,dot(N,light)),Math.max(.001,dot(N,V)),Math.max(0,dot(N,H)),Math.max(0,dot(V,H))).map(srgb);}}pixels[p*4]=lit[0];pixels[p*4+1]=lit[1];pixels[p*4+2]=lit[2];
   }
  }
 }
 return {pixels,ids,width:size,height:size};
}
export function createMaterialSoftwarePreview(canvas){
 const context=canvas.getContext('2d');if(!context)throw new Error('Browser canvas rendering is unavailable.');
 let mesh=null,materials=[],view={},frame=null;const size=320,buffer=document.createElement('canvas');buffer.width=buffer.height=size;const target=buffer.getContext('2d');
 return {software:true,setGeometry(value){validatePreviewGeometry(value);const triangles=value.parts.reduce((n,p)=>n+p.indices.length/3,0);if(triangles>500000)throw new Error('Software preview supports at most 500,000 triangles.');mesh=value;},setMaterials(value){for(const m of value){if(m.albedoTexture?.compressed||m.opacityTexture?.compressed||(m.maskLayers??[]).some(l=>l.texture?.compressed))throw new Error('Software preview cannot decode this compressed texture. A WebGL2 browser with the required texture extension is needed.');}materials=value;},setView(value){view=value;},render(options={}){if(!mesh)return;frame=rasterizePreview(mesh,materials,view,options,size);target.putImageData(new ImageData(frame.pixels,size,size),0,0);context.drawImage(buffer,0,0,canvas.width,canvas.height);},pick(x,y){if(!frame)return null;const ix=Math.floor(x/canvas.width*size),iy=Math.floor(y/canvas.height*size);if(ix<0||iy<0||ix>=size||iy>=size)return null;const id=frame.ids[iy*size+ix];return id<0?null:id;},dispose(){mesh=null;frame=null;context.clearRect(0,0,canvas.width,canvas.height);}};
}
