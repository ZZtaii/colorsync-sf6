// Browser-only material inspection renderer. No REasy binary/runtime dependency.
// Controlled studio lighting, NOT a port of the game's shaders.
const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
uniform mat4 uMvp;
uniform vec3 uCenter;
uniform float uScale;
out vec3 vPosition; out vec3 vNormal; out vec2 vUv;
void main(){vPosition=(aPosition-uCenter)*uScale;vNormal=aNormal;vUv=aUv;gl_Position=uMvp*vec4(vPosition,1.0);}`;

// Lights are fixed to the camera so the model stays evenly lit from every orbit angle.
// "Flat" shading skips lighting entirely and shows the tinted base colour as-is.
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vPosition; in vec3 vNormal; in vec2 vUv;
out vec4 outColor;
uniform vec4 uColor;
uniform vec3 uEye,uKeyDir,uFillDir,uRimDir;
uniform float uRoughness, uMetalness;
uniform bool uHasAlbedo,uHasUv,uPick,uHighlight,uAlbedoAlpha,uHasOpacity,uAlbedoLinear,uFlat,uSoftAlpha;
uniform sampler2D uOpacity;
uniform int uOpacityChannel;
uniform float uAlphaCutoff;
uniform int uMaskMode,uMaskViewLayer;
uniform sampler2D uAlbedo;
uniform sampler2D uMask0,uMask1,uMask2,uMask3,uMask4,uMask5,uMask6,uMask7;
uniform int uLayerCount;
uniform vec4 uLayerColors[8];
uniform vec2 uLayerSettings[8];
uniform vec3 uPickColor;
vec3 toLinear(vec3 s){return mix(s/12.92,pow((s+0.055)/1.055,vec3(2.4)),step(vec3(0.04045),s));}
vec3 toSrgb(vec3 l){l=max(l,vec3(0));return mix(l*12.92,1.055*pow(l,vec3(1.0/2.4))-0.055,step(vec3(0.0031308),l));}
vec4 maskAt(int i){if(i==0)return texture(uMask0,vUv);if(i==1)return texture(uMask1,vUv);if(i==2)return texture(uMask2,vUv);if(i==3)return texture(uMask3,vUv);if(i==4)return texture(uMask4,vUv);if(i==5)return texture(uMask5,vUv);if(i==6)return texture(uMask6,vUv);return texture(uMask7,vUv);}
float ggx(vec3 n,vec3 v,vec3 l,float roughness){
 vec3 h=normalize(v+l);
 float nv=max(dot(n,v),0.001),nl=max(dot(n,l),0.0),nh=max(dot(n,h),0.0);
 float a=max(roughness*roughness,0.0025),a2=a*a;
 float d=a2/(3.14159265*pow(nh*nh*(a2-1.0)+1.0,2.0));
 float k=pow(roughness+1.0,2.0)/8.0;
 float g=(nv/(nv*(1.0-k)+k))*(nl/(nl*(1.0-k)+k));
 return d*g/max(4.0*nv*nl,0.001)*nl;
}
void main(){
 vec4 base=uColor;
 if(uHasAlbedo&&uHasUv){vec4 tex=texture(uAlbedo,vUv);base*=vec4(uAlbedoLinear?tex.rgb:toLinear(tex.rgb),uAlbedoAlpha?tex.a:1.0);}
 vec3 tint=vec3(1); float maskView=0.0;
 if(uHasUv){for(int i=0;i<8;i++){if(i>=uLayerCount)break;vec4 m=maskAt(i);int ch=int(uLayerSettings[i].x);float weight=clamp(m[ch]*uLayerSettings[i].y,0.0,1.0);if(i==uMaskViewLayer)maskView=weight;if(uMaskMode==0)base.rgb=mix(base.rgb,uLayerColors[i].rgb,weight);else if(uMaskMode==1)tint=mix(tint,2.0*uLayerColors[i].rgb,weight);else tint*=mix(vec3(1),2.0*uLayerColors[i].rgb,weight);}}
 if(uMaskMode>0)base.rgb*=tint;
 if(uHasOpacity&&uHasUv)base.a*=texture(uOpacity,vUv)[uOpacityChannel];
 if(base.a<uAlphaCutoff)discard;
 if(uPick){outColor=vec4(uPickColor,1);return;}
 // With alpha-to-coverage the edge is anti-aliased across MSAA samples instead of hard-cut.
 float coverage=uSoftAlpha?clamp((base.a-uAlphaCutoff)/max(fwidth(base.a),0.0001)+0.5,0.0,1.0):1.0;
 if(uMaskViewLayer>=0||uMaskViewLayer==-2){outColor=vec4(vec3(uMaskViewLayer==-2?1.0:maskView),coverage);return;}
 vec3 lit=base.rgb;
 if(!uFlat){
  vec3 n=length(vNormal)>0.1?normalize(vNormal):normalize(cross(dFdx(vPosition),dFdy(vPosition)));
  if(!gl_FrontFacing)n=-n;
  vec3 v=normalize(uEye-vPosition);
  float key=max(dot(n,uKeyDir)*0.85+0.15,0.0),fill=max(dot(n,uFillDir)*0.6+0.4,0.0);
  vec3 ambient=mix(vec3(0.20,0.19,0.18),vec3(0.30,0.31,0.33),n.y*0.5+0.5);
  vec3 f0=mix(vec3(0.04),base.rgb,uMetalness);
  vec3 diffuse=base.rgb*(1.0-uMetalness)*(key*0.62+fill*0.16+ambient);
  vec3 spec=f0*(ggx(n,v,uKeyDir,uRoughness)*0.9+ggx(n,v,uFillDir,uRoughness)*0.25);
  float rim=pow(1.0-max(dot(n,v),0.0),3.0)*max(dot(n,uRimDir),0.0);
  lit=diffuse+spec+base.rgb*rim*0.18;
 }
 if(uHighlight)lit=mix(lit,vec3(0.1,0.65,0.9),0.35);
 outColor=vec4(toSrgb(clamp(lit,0.0,1.0)),coverage);
}`;

export function validatePreviewGeometry(mesh) {
    if (!mesh || !Array.isArray(mesh.parts) || !mesh.parts.length) throw new Error('Mesh has no renderable parts.');
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const p of mesh.parts){
        if(!(p.positions instanceof Float32Array)||p.positions.length%3||!p.positions.length)throw new Error('Invalid mesh positions.');
        if(!Number.isInteger(p.materialIndex)||p.materialIndex<0||p.materialIndex>0xfffffe)throw new Error('Invalid material index.');
        const count=p.positions.length/3;
        if(!(p.indices instanceof Uint16Array||p.indices instanceof Uint32Array)||p.indices.length%3||!p.indices.length)throw new Error('Invalid triangle indices.');
        for(const x of p.indices)if(x>=count)throw new Error('Triangle references an absent vertex.');
        for(const [data,size,label] of [[p.normals,3,'normals'],[p.uvs,2,'UVs']]){
            if(data!=null&&(!(data instanceof Float32Array)||data.length!==count*size))throw new Error(`Invalid mesh ${label}.`);
            if(data)for(const x of data)if(!Number.isFinite(x))throw new Error(`Non-finite mesh ${label}.`);
        }
        for(let i=0;i<p.positions.length;i++){const x=p.positions[i];if(!Number.isFinite(x))throw new Error('Non-finite vertex.');const j=i%3;min[j]=Math.min(min[j],x);max[j]=Math.max(max[j],x);}
    }
    const extent=Math.max(...max.map((x,i)=>x-min[i]));
    if(!(extent>0))throw new Error('Mesh bounds have zero extent.');
    return {min,max,center:min.map((x,i)=>(x+max[i])/2),scale:1/extent};
}
export function encodeMaterialId(index){
    if(!Number.isInteger(index)||index<0||index>0xfffffe)throw new Error('Invalid material index.');
    const n=index+1;return [n&255,(n>>>8)&255,(n>>>16)&255];
}
export function decodeMaterialId(bytes){const n=bytes[0]+bytes[1]*256+bytes[2]*65536;return n===0?null:n-1;}
function finite(value,fallback,min,max){return Number.isFinite(value)?Math.max(min,Math.min(max,value)):fallback;}
export function normalizePreviewMaterial(value={}){
    const color=value.color??[0.55,0.55,0.55,1];
    if(!Array.isArray(color)||color.length!==4||!color.every(Number.isFinite))throw new Error('Material color must have four finite linear channels.');
    const layers=value.maskLayers??[];
    if(!Array.isArray(layers)||layers.length>8)throw new Error('At most eight explicitly mapped mask layers are supported.');
    for(const layer of layers){
        if(!Number.isInteger(layer.channel)||layer.channel<0||layer.channel>3||!layer.texture)throw new Error('Mask requires an explicit texture and RGBA channel.');
        if(!Array.isArray(layer.color)||layer.color.length!==4||!layer.color.every(Number.isFinite))throw new Error('Mask color must be linear RGBA.');
        if(!Number.isFinite(layer.blendRate)||layer.blendRate<0||layer.blendRate>1)throw new Error('Mask blend rate must be 0..1.');
    }
    if(value.maskMode!=null&&!['sf6-tint-mix','sf6-tint-multiply'].includes(value.maskMode))throw new Error('Unsupported mask mode.');
    return {...value,color:color.slice(),roughness:finite(value.roughness,0.65,0.05,1),metalness:finite(value.metalness,0,0,1),maskLayers:layers};
}

export const DEFAULT_PREVIEW_VIEW = Object.freeze({ yaw: -25, pitch: 0, distance: 1.55, panX: 0, panY: 0 });
const FOV_FACTOR =1 / Math.tan(Math.PI / 8); // 45 degree vertical field of view

function multiply(a,b){const r=new Float32Array(16);for(let c=0;c<4;c++)for(let row=0;row<4;row++)for(let k=0;k<4;k++)r[c*4+row]+=a[k*4+row]*b[c*4+k];return r;}
function normalize(v){const n=Math.hypot(...v)||1;return v.map(x=>x/n);}
function cross(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
/** Orbit camera around the model centre. panX/panY slide the view in screen space. */
export function previewCamera(view,aspect){
    const yaw=view.yaw*Math.PI/180,pitch=view.pitch*Math.PI/180,d=view.distance,panX=view.panX??0,panY=view.panY??0;
    const z=normalize([Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)]);
    const x=normalize(cross([0,1,0],z)),y=cross(z,x);
    const eye=[0,1,2].map(i=>z[i]*d+x[i]*panX+y[i]*panY);
    const vm=new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-panX,-panY,-d,1]);
    const near=.01,far=100,f=FOV_FACTOR;
    const pm=new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]);
    const along=(a,b,c)=>normalize([0,1,2].map(i=>x[i]*a+y[i]*b+z[i]*c));
    return{eye,mvp:multiply(pm,vm),basis:{x,y,z},lights:{key:along(-.45,.55,.7),fill:along(.75,.05,.55),rim:along(.15,.45,-.85)}};
}

export function createMaterialWebGLPreview(canvas){
    const gl=canvas.getContext('webgl2',{alpha:false,antialias:true,preserveDrawingBuffer:true});
    if(!gl)throw new Error('WebGL 2 is unavailable in this browser.');
    let disposed=false,lost=false,parts=[],materials=[],bounds=null,lastOptions={},view={...DEFAULT_PREVIEW_VIEW};
    let framebuffer=null,pickTexture=null,pickDepth=null,pickSize='';
    // GPU textures are cached per decoded image and encoding, and survive material updates:
    // a colour edit or camera move never re-uploads pixels.
    let textureCache=new Map();
    const anisotropy=gl.getExtension('EXT_texture_filter_anisotropic');
    const uniforms=new Map();
    function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const log=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error('Preview shader compilation failed: '+log);}return s;}
    const vs=shader(gl.VERTEX_SHADER,VERTEX),fs=shader(gl.FRAGMENT_SHADER,FRAGMENT),program=gl.createProgram();
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS)){const log=gl.getProgramInfoLog(program);gl.deleteProgram(program);throw new Error('Preview shader linking failed: '+log);}
    const u=name=>{if(!uniforms.has(name))uniforms.set(name,gl.getUniformLocation(program,name));return uniforms.get(name);};
    function check(){if(disposed)throw new Error('Preview is closed.');if(lost||gl.isContextLost())throw new Error('WebGL context lost. Reload the model to reconnect.');}
    function clearParts(){for(const p of parts){gl.deleteVertexArray(p.vao);for(const b of p.buffers)gl.deleteBuffer(b);}parts=[];}
    function clearTextures(){for(const byEncoding of textureCache.values())for(const t of byEncoding.values())gl.deleteTexture(t);textureCache=new Map();}
    function texture(image,{srgb=false}={}){
        const cached=textureCache.get(image)?.get(srgb);if(cached)return cached;
        const max=gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width>max||image.height>max||!(image.data instanceof Uint8Array||image.data instanceof Uint8ClampedArray))throw new Error('Texture must contain valid dimensions and pixel bytes.');
        const compressed=image.compressed===true;
        let compressedFormat=null;
        if(compressed){const ext=gl.getExtension('EXT_texture_compression_bptc');if(!ext||![98,99].includes(image.format))throw new Error('BC7 texture preview requires this browser GPU to support EXT_texture_compression_bptc.');if(image.data.length!==Math.ceil(image.width/4)*Math.ceil(image.height/4)*16)throw new Error('Invalid BC7 block payload.');compressedFormat=srgb?ext.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:ext.COMPRESSED_RGBA_BPTC_UNORM_EXT;}else if(image.data.length!==image.width*image.height*4)throw new Error('Texture must be correctly sized RGBA8 pixels.');
        const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
        if(compressed){
            gl.compressedTexImage2D(gl.TEXTURE_2D,0,compressedFormat,image.width,image.height,0,image.data);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        }else{
            // sRGB storage lets the GPU filter and mip in linear light.
            gl.texImage2D(gl.TEXTURE_2D,0,srgb?gl.SRGB8_ALPHA8:gl.RGBA8,image.width,image.height,0,gl.RGBA,gl.UNSIGNED_BYTE,image.data);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
            if(anisotropy)gl.texParameterf(gl.TEXTURE_2D,anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(8,gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        }
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
        if(!textureCache.has(image))textureCache.set(image,new Map());
        textureCache.get(image).set(srgb,t);return t;
    }
    function setGeometry(mesh){check();const next=validatePreviewGeometry(mesh);clearParts();clearTextures();materials=[];bounds=next;
        try{for(const p of mesh.parts){const vao=gl.createVertexArray(),buffers=[];gl.bindVertexArray(vao);
            const buffer=(target,data)=>{const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(target,b);gl.bufferData(target,data,gl.STATIC_DRAW);};
            const n=p.positions.length/3;
            for(const [location,data,size]of[[0,p.positions,3],[1,p.normals??new Float32Array(n*3),3],[2,p.uvs??new Float32Array(n*2),2]]){buffer(gl.ARRAY_BUFFER,data);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);}
            buffer(gl.ELEMENT_ARRAY_BUFFER,p.indices);parts.push({vao,buffers,count:p.indices.length,type:p.indices instanceof Uint32Array?gl.UNSIGNED_INT:gl.UNSIGNED_SHORT,materialIndex:p.materialIndex,hasUv:!!p.uvs});
        }}catch(error){clearParts();bounds=null;throw error;}finally{gl.bindVertexArray(null);}
    }
    function setMaterials(values){check();if(!Array.isArray(values))throw new Error('Materials must be an indexed array.');const normalized=values.map(m=>normalizePreviewMaterial(m));
        materials=normalized.map(m=>{
            // The 8-bit base texture is sRGB unless its source format says otherwise.
            const albedoSrgb=m.albedoSrgb!==false;
            return{...m,albedo:m.albedoTexture?texture(m.albedoTexture,{srgb:albedoSrgb&&!m.albedoTexture.compressed}):null,albedoLinear:!m.albedoTexture?.compressed||!albedoSrgb,
                opacity:m.opacityTexture?texture(m.opacityTexture):null,cutout:!!m.opacityTexture||m.albedoAlpha===true,
                layers:m.maskLayers.map(layer=>({...layer,gpu:texture(layer.texture)}))};
        });
    }
    function setView(next){check();view={yaw:finite(next.yaw,view.yaw,-3600,3600),pitch:finite(next.pitch,view.pitch,-89,89),distance:finite(next.distance,view.distance,0.1,20),panX:finite(next.panX,view.panX,-5,5),panY:finite(next.panY,view.panY,-5,5)};}
    function pickTarget(){const size=canvas.width+'x'+canvas.height;if(size===pickSize)return;
        if(framebuffer)gl.deleteFramebuffer(framebuffer);if(pickTexture)gl.deleteTexture(pickTexture);if(pickDepth)gl.deleteRenderbuffer(pickDepth);
        framebuffer=gl.createFramebuffer();pickTexture=gl.createTexture();pickDepth=gl.createRenderbuffer();pickSize=size;
        gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.bindTexture(gl.TEXTURE_2D,pickTexture);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,canvas.width,canvas.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,pickTexture,0);
        gl.bindRenderbuffer(gl.RENDERBUFFER,pickDepth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,canvas.width,canvas.height);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,pickDepth);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Material picking target is unavailable.');
    }
    function draw(options,picking){
        check();if(!bounds)throw new Error('Load a supported real mesh first.');
        if(!canvas.width||!canvas.height||canvas.width>4096||canvas.height>4096)throw new Error('Preview dimensions must be 1..4096 pixels.');
        if(options.isolate&&!parts.some(p=>p.materialIndex===options.selectedMaterialIndex))throw new Error('Choose a loaded material to isolate.');
        if(picking)pickTarget();gl.bindFramebuffer(gl.FRAMEBUFFER,picking?framebuffer:null);gl.viewport(0,0,canvas.width,canvas.height);
        gl.disable(gl.DITHER);gl.disable(gl.BLEND);gl.disable(gl.CULL_FACE);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);gl.depthMask(true);
        const background=picking?[0,0,0]:(Array.isArray(options.background)&&options.background.length===3?options.background:[.055,.055,.065]);
        gl.clearColor(background[0],background[1],background[2],1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(program);
        const cam=previewCamera(view,canvas.width/canvas.height);gl.uniformMatrix4fv(u('uMvp'),false,cam.mvp);gl.uniform3fv(u('uCenter'),bounds.center);gl.uniform1f(u('uScale'),bounds.scale);gl.uniform3fv(u('uEye'),cam.eye);gl.uniform1i(u('uPick'),picking?1:0);
        gl.uniform3fv(u('uKeyDir'),cam.lights.key);gl.uniform3fv(u('uFillDir'),cam.lights.fill);gl.uniform3fv(u('uRimDir'),cam.lights.rim);gl.uniform1i(u('uFlat'),options.shading==='flat'?1:0);
        const softAlpha=!picking&&gl.getParameter(gl.SAMPLES)>1;
        // Solid surfaces first, then cutouts (hair cards, lashes, torn cloth) with soft MSAA edges.
        for(const cutoutPass of [false,true]){
            if(cutoutPass&&softAlpha)gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
            for(const p of parts){if(options.isolate&&p.materialIndex!==options.selectedMaterialIndex)continue;
                const m=materials[p.materialIndex]??{...normalizePreviewMaterial(),albedo:null,layers:[],cutout:false,albedoLinear:true};if(m.skip||!!m.cutout!==cutoutPass)continue;
                gl.uniform4fv(u('uColor'),m.color);gl.uniform1f(u('uRoughness'),m.roughness);gl.uniform1f(u('uMetalness'),m.metalness);gl.uniform1i(u('uHasUv'),p.hasUv?1:0);gl.uniform1i(u('uHasAlbedo'),m.albedo?1:0);gl.uniform1i(u('uAlbedoLinear'),m.albedoLinear?1:0);
                gl.uniform1i(u('uHighlight'),!picking&&options.highlightMaterialIndex===p.materialIndex?1:0);gl.uniform1i(u('uSoftAlpha'),cutoutPass&&softAlpha?1:0);
                gl.uniform3fv(u('uPickColor'),encodeMaterialId(p.materialIndex).map(n=>n/255));
                gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,m.albedo);gl.uniform1i(u('uAlbedo'),0);
                gl.uniform1i(u('uLayerCount'),m.layers.length);
                gl.uniform1i(u('uMaskMode'),m.maskMode==='sf6-tint-mix'?1:m.maskMode==='sf6-tint-multiply'?2:0);
                gl.uniform1i(u('uAlbedoAlpha'),m.albedoAlpha===false?0:1);
                gl.uniform1i(u('uMaskViewLayer'),Number.isInteger(m.maskViewSlot)?(m.uniformTintSlot===m.maskViewSlot?-2:m.layers.findIndex(layer=>layer.slotIndex===m.maskViewSlot)):-1);
                gl.uniform1i(u('uHasOpacity'),m.opacity?1:0);gl.uniform1i(u('uOpacityChannel'),Number.isInteger(m.opacityChannel)?Math.max(0,Math.min(3,m.opacityChannel)):0);gl.uniform1f(u('uAlphaCutoff'),finite(m.alphaCutoff,.05,0,1));gl.activeTexture(gl.TEXTURE0+9);gl.bindTexture(gl.TEXTURE_2D,m.opacity??null);gl.uniform1i(u('uOpacity'),9);
                for(let i=0;i<8;i++){const layer=m.layers[i];gl.activeTexture(gl.TEXTURE0+i+1);gl.bindTexture(gl.TEXTURE_2D,layer?.gpu??null);gl.uniform1i(u('uMask'+i),i+1);if(layer){gl.uniform4fv(u(`uLayerColors[${i}]`),layer.color);gl.uniform2f(u(`uLayerSettings[${i}]`),layer.channel,layer.blendRate);}}
                gl.bindVertexArray(p.vao);gl.drawElements(gl.TRIANGLES,p.count,p.type,0);
            }
        }
        gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
        gl.bindVertexArray(null);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error('WebGL rendering failed (code '+error+').');
    }
    function render(options={}){lastOptions={...options};draw(lastOptions,false);return{rendered:true,parts:parts.length,approximate:true};}
    function pick(x,y){check();if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>=canvas.width||y>=canvas.height)return null;
        draw(lastOptions,true);const pixel=new Uint8Array(4);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.readPixels(Math.floor(x),canvas.height-1-Math.floor(y),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);gl.bindFramebuffer(gl.FRAMEBUFFER,null);return decodeMaterialId(pixel);}
    const onLost=event=>{event.preventDefault();lost=true;};canvas.addEventListener('webglcontextlost',onLost);
    function dispose(){if(disposed)return;clearParts();clearTextures();if(framebuffer)gl.deleteFramebuffer(framebuffer);if(pickTexture)gl.deleteTexture(pickTexture);if(pickDepth)gl.deleteRenderbuffer(pickDepth);gl.deleteProgram(program);canvas.removeEventListener('webglcontextlost',onLost);disposed=true;}
    return{setGeometry,setMaterials,setView,render,pick,dispose};
}
