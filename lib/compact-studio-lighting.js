// Controlled approximate studio BRDF, NOT the game's lighting pipeline.
const clamp=x=>Math.max(0,Math.min(1,x));
export function compactStudioLighting(base,{roughness,metalness},ndotl,ndotv=1,ndoth=1,vdoth=1){
 if(!Array.isArray(base)||base.length<3||![...base.slice(0,3),roughness,metalness,ndotl,ndotv,ndoth,vdoth].every(Number.isFinite))throw Error('Invalid studio surface');
 const r=Math.max(.045,clamp(roughness)),m=clamp(metalness),nl=clamp(ndotl),nv=Math.max(.001,clamp(ndotv)),nh=clamp(ndoth),vh=clamp(vdoth),a=r*r,a2=a*a;
 const D=a2/(Math.PI*Math.pow(nh*nh*(a2-1)+1,2));
 const k=(r+1)**2/8,G=x=>x/(x*(1-k)+k),visibility=G(nl)*G(nv)/(4*Math.max(.001,nl*nv));
 return base.slice(0,3).map(c=>{const f0=.04*(1-m)+c*m,F=f0+(1-f0)*(1-vh)**5;return .2*c+nl*((1-F)*(1-m)*c+Math.PI*D*visibility*F)*.8;});
}
