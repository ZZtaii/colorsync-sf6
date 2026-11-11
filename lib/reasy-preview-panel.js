import { ReasyPreviewClient } from './reasy-preview-client.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
export function createReasyPreviewPanel(root,{onSelectMaterial,client=new ReasyPreviewClient()}={}) {
    if(!root)return {update(){}};
    let snapshot=null,health=null,frame=null,epoch=0,connectionSerial=0,timer=null,bindings={},selected=null;
    const connection=el('div',null,'preview-toolbar');
    const url=el('input');url.value='http://127.0.0.1:8765';url.setAttribute('aria-label','Local preview host URL');url.type='url';
    const token=el('input');token.type='password';token.autocomplete='off';token.placeholder='Session token from host terminal';token.setAttribute('aria-label','Preview session token');
    const connect=el('button','Connect','secondary-button');connect.type='button';
    const disconnect=el('button','Disconnect','secondary-button');disconnect.type='button';disconnect.disabled=true;
    connection.append(url,token,connect,disconnect);
    const status=el('p','Not connected. Start the Windows REasy host, then enter its URL and session token.');status.setAttribute('role','status');
    const mapping=el('details');mapping.append(el('summary','Explicit material bindings'));
    const mappingRows=el('div',null,'preview-binding-list');mapping.append(mappingRows);
    const controls=el('fieldset',null,'preview-camera');controls.disabled=true;controls.append(el('legend','Camera and selection'));
    const camera={};for(const [key,label,min,max,step,value] of [['yaw','Orbit',-180,180,5,-25],['pitch','Elevation',-89,89,1,0],['distance','Distance',.1,20,.05,1.55]]){
        const wrap=el('label',label+' '),input=el('input');input.type='range';Object.assign(input,{min,max,step,value});input.setAttribute('aria-label',label);wrap.append(input);controls.append(wrap);camera[key]=input;input.addEventListener('input',()=>invalidate(true));
    }
    const select=el('select');select.setAttribute('aria-label','Selected preview material');
    const isolate=el('input');isolate.type='checkbox';const isolateLabel=el('label');isolateLabel.append(isolate,document.createTextNode(' Isolate selected material'));
    const live=el('input');live.type='checkbox';live.checked=true;const liveLabel=el('label');liveLabel.append(live,document.createTextNode(' Live update'));
    const render=el('button','Render preview','secondary-button');render.type='button';
    const reset=el('button','Reset camera','secondary-button');reset.type='button';
    controls.append(select,isolateLabel,liveLabel,render,reset);
    const viewport=el('div',null,'reasy-viewport');const image=el('img');image.alt='REasy material preview';image.hidden=true;
    const caption=el('p','No rendered frame.');viewport.append(image,caption);
    const diagnostics=el('ul',null,'preview-diagnostics');
    root.append(connection,status,mapping,controls,viewport,diagnostics);
    function clearFrame(message='Preview changed. Render to see the current state.') { frame=null;image.hidden=true;image.removeAttribute('src');caption.textContent=message; }
    function setError(error){if(!frame)caption.textContent='No current rendered frame.';status.textContent=error.message||String(error);viewport.setAttribute('aria-busy','false');}
    function invalidate(auto=false){epoch++;clearTimeout(timer);if(client.connected){client.sequence++;client.controller?.abort();}clearFrame();if(auto&&live.checked&&client.connected&&snapshot?.palette)timer=setTimeout(renderFrame,250);}
    function refreshBindings(){
        mappingRows.replaceChildren();const ids=new Set(snapshot?.materials.map(m=>m.id)??[]);
        bindings=Object.fromEntries(Object.entries(bindings).filter(([,id])=>ids.has(id)));
        for(const material of health?.materials??[]){
            const row=el('label',`${material.name??material.key} → `,'preview-binding-row');const options=el('select');options.setAttribute('aria-label',`Bind renderer material ${material.key}`);
            const original=el('option','Original game material (no override)');original.value='';options.append(original);
            for(const target of snapshot?.materials??[]){const option=el('option',`${target.name} · parts ${target.partTypes.join(',')||'?'} · cluster ${target.clusterInstanceId}`);option.value=target.id;options.append(option);}
            options.value=bindings[material.key]??'';options.disabled=!snapshot?.palette;
            options.addEventListener('change',()=>{if(options.value)bindings[material.key]=options.value;else delete bindings[material.key];invalidate(true);});
            row.append(options);mappingRows.append(row);
        }
        select.replaceChildren();const all=el('option','No material selected');all.value='';select.append(all);
        for(const material of snapshot?.materials??[]){const option=el('option',`${material.name} · cluster ${material.clusterInstanceId}`);option.value=material.id;select.append(option);}
        if(!ids.has(selected)){selected=null;isolate.checked=false;}select.value=selected??'';
        controls.disabled=!client.connected||!snapshot?.palette;
    }
    async function renderFrame(){
        clearTimeout(timer);if(!client.connected||!snapshot?.palette)return;
        const requestEpoch=++epoch;clearFrame('Rendering current material state…');viewport.setAttribute('aria-busy','true');status.textContent='Rendering with the local REasy host…';
        try{
            const result=await client.render({snapshot,bindings:{...bindings},selectedMaterialId:selected,isolate:isolate.checked,view:{width:640,height:640,yaw:Number(camera.yaw.value),pitch:Number(camera.pitch.value),distance:Number(camera.distance.value)}});
            if(requestEpoch!==epoch)return;
            frame=result;image.src=result.image;image.hidden=false;
            caption.textContent=`Frame ${result.frameId} · palette revision ${result.revision}. ${health.capabilities?.pick?'Click a surface to identify its material. Picking ignores alpha cutouts and displacement.':'Picking is unavailable.'}`;
            diagnostics.replaceChildren(...(result.diagnostics??[]).map(text=>el('li',String(text))));
            status.textContent='Preview current. Colors are applied only to your explicit material bindings.';
        }catch(error){if(requestEpoch===epoch)setError(error);}finally{if(requestEpoch===epoch)viewport.setAttribute('aria-busy','false');}
    }
    connect.addEventListener('click',async()=>{
        const serial=++connectionSerial;++epoch;clearTimeout(timer);clearFrame('Connecting…');connect.disabled=true;disconnect.disabled=false;status.textContent='Connecting to local preview host…';
        try{const result=await client.connect(url.value,token.value);if(serial!==connectionSerial)return;health=result;token.value='';disconnect.disabled=false;url.disabled=true;mapping.open=true;refreshBindings();clearFrame('No rendered frame. Bind materials and render.');status.textContent=`Connected. Shader resources ${health.resourceVersion}. Bind materials explicitly, then render.`;}
        catch(error){if(serial===connectionSerial){health=null;disconnect.disabled=true;refreshBindings();setError(error);}}
        finally{if(serial===connectionSerial)connect.disabled=client.connected;}
    });
    disconnect.addEventListener('click',()=>{connectionSerial++;epoch++;clearTimeout(timer);client.disconnect();health=null;bindings={};token.value='';url.disabled=false;connect.disabled=false;disconnect.disabled=true;refreshBindings();clearFrame('Disconnected. Session token cleared.');status.textContent='Disconnected.';});
    render.addEventListener('click',renderFrame);
    reset.addEventListener('click',()=>{camera.yaw.value=-25;camera.pitch.value=0;camera.distance.value=1.55;invalidate(true);});
    select.addEventListener('change',()=>{selected=select.value||null;onSelectMaterial?.(selected);invalidate(isolate.checked);});
    isolate.addEventListener('change',()=>invalidate(true));live.addEventListener('change',()=>{if(live.checked)invalidate(true);});
    image.addEventListener('click',async event=>{
        if(!frame||!health?.capabilities?.pick)return;const current=frame,requestEpoch=epoch;
        const box=image.getBoundingClientRect(),x=Math.max(0,Math.min(current.width-1,Math.floor((event.clientX-box.left)/box.width*current.width))),y=Math.max(0,Math.min(current.height-1,Math.floor((event.clientY-box.top)/box.height*current.height)));
        try{const result=await client.pick(current.frameId,x,y);if(requestEpoch!==epoch||frame!==current)return;
            if(!result.materialKey){status.textContent='No visible triangle at this point.';return;}
            const material=snapshot.materials.find(m=>m.id===result.materialId);
            status.textContent=`Picked ${result.materialKey}${material?` → ${material.name}`:' (not bound to a ColorSync material)'}. ${result.reason??''}`;
            if(material){selected=material.id;select.value=selected;onSelectMaterial?.(selected);if(isolate.checked)invalidate(true);}
        }catch(error){if(requestEpoch===epoch)setError(error);}
    });
    return {update(next){const changed=snapshot?.revision!==next.revision;snapshot=next;if(changed){refreshBindings();invalidate(true);}}};
}
