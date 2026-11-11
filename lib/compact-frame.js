// Preview-only UV-derived tangent frame. Not validated against the game's skinned frame.
const sub=(a,b)=>a.map((v,i)=>v-b[i]);const norm=a=>{const n=Math.hypot(...a);return n>1e-8?a.map(v=>v/n):null;};
export function triangleUvFrame(a,b,c,uvA,uvB,uvC){if(!uvA||!uvB||!uvC)return null;const p=sub(b,a),q=sub(c,a),u=sub(uvB,uvA),v=sub(uvC,uvA),d=u[0]*v[1]-u[1]*v[0];if(Math.abs(d)<1e-8)return null;const tangent=norm(p.map((x,i)=>(x*v[1]-q[i]*u[1])/d)),bitangent=norm(p.map((x,i)=>(q[i]*u[0]-x*v[0])/d));return tangent&&bitangent?{tangent,bitangent}:null;}
