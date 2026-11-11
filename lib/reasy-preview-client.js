// Explicit, ephemeral connection to a user-launched local REasy host.
export function localPreviewOrigin(value) {
    let url; try { url = new URL(value); } catch { throw new Error('Enter a local host URL such as http://127.0.0.1:8767.'); }
    if (url.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)
        || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) {
        throw new Error('Preview connections are restricted to HTTP loopback hosts, without credentials or a URL path.');
    }
    return url.origin;
}
export function previewView(view = {}) {
    const defaults = { width:640,height:640,yaw:-25,pitch:0,distance:1.55 };
    const ranges = { width:[64,1536],height:[64,1536],yaw:[-3600,3600],pitch:[-89,89],distance:[.1,20] };
    return Object.fromEntries(Object.entries(defaults).map(([key,fallback]) => {
        const value = view[key] ?? fallback;
        if (!Number.isFinite(value) || value < ranges[key][0] || value > ranges[key][1]
            || ['width','height'].includes(key) && !Number.isInteger(value)) throw new Error(`Invalid camera ${key}.`);
        return [key,value];
    }));
}
export class ReasyPreviewClient {
    constructor(fetcher = (...args) => fetch(...args)) { this.fetcher=fetcher; this.generation=0; this.sequence=0; this.connected=false; }
    disconnect() {
        this.generation++; this.sequence++; this.controller?.abort(); this.controller=null;
        this.origin=null; this.token=null; this.health=null; this.connected=false;
    }
    async request(path, payload, timeout=60000) {
        const controller=new AbortController();this.controller?.abort();this.controller=controller;
        const timer=setTimeout(()=>controller.abort(),timeout);
        try {
            const response=await this.fetcher(this.origin+path,{method:payload===undefined?'GET':'POST',
                headers:{'X-ColorSync-Token':this.token,...(payload===undefined?{}:{'Content-Type':'application/json'})},
                ...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:controller.signal,credentials:'omit',redirect:'error',cache:'no-store'});
            if (!response.ok) {
                let detail='';try{detail=(await response.json()).error??'';}catch{}
                throw new Error(`Preview host ${response.status}${detail?`: ${String(detail).slice(0,500)}`:''}`);
            }
            const data=await response.json();return data;
        } catch(error) {
            if(error.name==='AbortError') throw new Error('Preview request canceled or timed out.');
            if(error instanceof TypeError) throw new Error('Could not reach the local preview host. Check its URL, token, allowed origin and terminal output.');
            throw error;
        } finally {clearTimeout(timer);if(this.controller===controller)this.controller=null;}
    }
    async connect(origin,token) {
        this.disconnect();this.origin=localPreviewOrigin(origin);
        if(typeof token!=='string'||!token.trim()||token.length>512)throw new Error('Enter the session token shown by the local host.');
        this.token=token.trim();const generation=this.generation;
        try {
            const health=await this.request('/health',undefined,10000);
            if(generation!==this.generation)throw new Error('Connection was superseded.');
            if(health.protocol!=='colorsync.reasy-preview'||health.version!==1||!Array.isArray(health.materials))throw new Error('Incompatible preview host protocol.');
            const keys=new Set();for(const m of health.materials){if(typeof m.key!=='string'||!m.key||keys.has(m.key))throw new Error('Invalid renderer material identities.');keys.add(m.key);}
            if(!health.rendererReady)throw new Error(health.reason||'The native renderer is not ready.');
            this.health=health;this.connected=true;return health;
        } catch(error){if(generation===this.generation)this.disconnect();throw error;}
    }
    async render({snapshot,bindings={},view,selectedMaterialId=null,isolate=false}) {
        if(!this.connected)throw new Error('Connect the local preview host first.');
        const ids=new Set(snapshot.materials.map(m=>m.id)),keys=new Set(this.health.materials.map(m=>m.key));
        for(const [key,ident] of Object.entries(bindings))if(!keys.has(key)||!ids.has(ident))throw new Error('A material binding is no longer valid.');
        if(isolate&&(!selectedMaterialId||!Object.values(bindings).includes(selectedMaterialId)))throw new Error('Choose a bound material before isolating.');
        const generation=this.generation,sequence=++this.sequence;
        const result=await this.request('/render',{snapshot,bindings,view:previewView(view),selectedMaterialId,isolate,mode:'lit'});
        if(generation!==this.generation||sequence!==this.sequence)throw new Error('Rendered frame was superseded.');
        if(result.rendered!==true||typeof result.image!=='string'||result.image.length>32*1024*1024
            ||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(result.image)
            ||!Number.isInteger(result.frameId)||result.revision!==snapshot.revision)throw new Error('Invalid or stale rendered frame.');
        if(!Number.isInteger(result.width)||!Number.isInteger(result.height)||result.width<64||result.height<64||result.width>1536||result.height>1536)throw new Error('Invalid rendered image dimensions.');
        return result;
    }
    async pick(frameId,x,y) {
        if(!this.connected||!this.health.capabilities?.pick)throw new Error('Picking is unavailable.');
        const generation=this.generation,sequence=++this.sequence;
        const result=await this.request('/pick',{frameId,x,y},10000);
        if(generation!==this.generation||sequence!==this.sequence)throw new Error('Pick was superseded.');
        if(result.frameId!==frameId)throw new Error('Pick belongs to an older frame.');
        return result;
    }
}
