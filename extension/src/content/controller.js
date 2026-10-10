(() => {
  if(globalThis.__errorTranslator) return;
  const dom=globalThis.ErrorTranslatorDOM;
  let groups=[],observers=[],settings=null,generation=0,busy=false,dirty=false,timer=null,hoverMap=new WeakMap(),activeHover=null;
  const hoverRestores=new Map();
  let state={status:'idle',mode:null,done:0,total:0,error:''};
  const hoverDocuments=new WeakSet();
  function update(patch) {state={...state,...patch};}
  function cancelRequests() {chrome.runtime.sendMessage({type:'ET_CANCEL'}).catch(()=>{});}
  function disconnect() {for(const observer of observers) observer.disconnect();observers=[];clearTimeout(timer);}
  function endHover() {
    if(!activeHover && !hoverRestores.size) return;
    disconnect();
    if(activeHover) dom.restoreNodes(activeHover);
    for(const [group,timeout] of hoverRestores) {clearTimeout(timeout);dom.restoreNodes(group);}
    hoverRestores.clear();activeHover=null;observe();
  }
  function leaveHover() {
    if(!activeHover) return;
    const group=activeHover,run=generation;activeHover=null;
    clearTimeout(hoverRestores.get(group));
    hoverRestores.set(group,setTimeout(()=>{
      hoverRestores.delete(group);
      if(run!==generation) return;
      disconnect();dom.restoreNodes(group);observe();
    },2000));
  }
  function reset() {
    generation++;busy=false;dirty=false;disconnect();cancelRequests();
    for(const timeout of hoverRestores.values()) clearTimeout(timeout);hoverRestores.clear();
    dom.restore(groups);groups=[];hoverMap=new WeakMap();activeHover=null;
    update({status:'idle',mode:null,done:0,total:0,error:''});
  }
  function observe() {
    if(!settings?.dynamic || ['idle','paused','error'].includes(state.status)) return;
    disconnect();
    for(const root of dom.roots(document)) {
      const observer=new MutationObserver(mutations=>{
        const relevant=mutations.some(m=>{
          const element=m.target.nodeType===Node.TEXT_NODE?m.target.parentElement:m.target;
          if(dom.protectedElement(element) && !element?.closest?.('[data-et-original]')) return false;
          if(m.type==='characterData') return true;
          return [...m.addedNodes,...m.removedNodes].some(n=>n.nodeType===Node.TEXT_NODE || (n.nodeType===Node.ELEMENT_NODE && !n.hasAttribute('data-error-translator')));
        });
        if(!relevant) return;
        dirty=true;clearTimeout(timer);timer=setTimeout(()=>{if(!busy) restartDynamic();},800);
      });
      observer.observe(root,{childList:true,subtree:true,characterData:true});observers.push(observer);
    }
  }
  function restartDynamic() {if(dirty && settings && !busy){const current={...settings};start(current);}}
  function apply(group) {
    disconnect();
    if(settings.mode==='full') dom.writeTranslated(group);
    else if(settings.mode==='hover') {
      group.translation=group.nodes.map(item=>item.parts.map(part=>part.translation || part.text).join('')).join('');
      if(!hoverMap.has(group.anchor)) hoverMap.set(group.anchor,group);
      for(const item of group.nodes) {hoverMap.set(item.node,group);if(!hoverMap.has(item.node.parentElement)) hoverMap.set(item.node.parentElement,group);}
    } else if(group.anchor.isConnected && group.nodes.every(item=>item.node.isConnected && item.node.data===item.original)) {
      dom.insertBilingual(group,group.parts.map(part=>part.translation).join(''),settings.target);
    }
    observe();
  }
  async function start(nextSettings) {
    reset();settings={...nextSettings};const run=++generation;busy=true;
    try {
      groups=dom.collect(document);
      for(const root of dom.roots(document)) if(root.nodeType===Node.DOCUMENT_NODE) bindHover(root);
      let index=0;const all=[];
      groups.forEach((group,i)=>{
        const first=all.length;
        const context=[dom.plainText(groups[i-1] || {nodes:[]}),dom.plainText(group),dom.plainText(groups[i+1] || {nodes:[]})].join('\n').slice(0,2800);
        function parts(text) {return dom.splitText(text).map(text=>{const part={id:String(index++),text,context,group};all.push(part);return part;});}
        if(settings.mode!=='bilingual') group.nodes.forEach(item=>{item.parts=/[\p{L}]/u.test(item.original)?parts(item.original):[{text:item.original,translation:item.original}];});
        else group.parts=parts(dom.plainText(group));
        group.pending=all.length-first;
      });
      update({status:'running',mode:settings.mode,done:0,total:all.length,error:''});observe();
      if(!all.length) {update({status:'ready',error:'本页没有可翻译的可见文本。'});return;}
      const batches=[];let batch=[],size=0;
      const max=settings.providerType==='baidu'?1:Math.min(64,Math.max(1,Math.round(Number(settings.batchSize)||16)));
      for(const part of all) {
        if(batch.length>=max || size+part.text.length>7000) {batches.push(batch);batch=[];size=0;}
        batch.push(part);size+=part.text.length;
      }
      if(batch.length) batches.push(batch);
      let nextBatch=0,failed=false;
      const concurrency=settings.providerType==='baidu'?1:Math.min(20,Math.max(1,Math.round(Number(settings.concurrency)||5)));
      async function worker() {
        while(!failed && run===generation) {
          const i=nextBatch++;if(i>=batches.length) return;
          try {
            const response=await chrome.runtime.sendMessage({type:'ET_TRANSLATE',jobId:`${run}-${i}`,settings,context:{title:document.title},segments:batches[i].map(({id,text,context})=>({id,text,context}))});
            if(run!==generation || failed) return;
            if(!response?.ok) throw new Error(response?.error || '扩展连接中断，请刷新网页后重试。');
            update({protocol:response.protocol});
            const results=new Map(response.translations.map(s=>[s.id,s.text]));
            if(batches[i].some(part=>!results.has(part.id))) throw new Error('翻译段落缺失，已保留原文。');
            for(const part of batches[i]) {
              part.translation=results.get(part.id);part.group.pending--;if(part.group.pending===0) apply(part.group);
            }
            update({done:state.done+batches[i].length});
          } catch(error) {
            if(run!==generation || failed) return;
            failed=true;cancelRequests();throw error;
          }
        }
      }
      await Promise.all(Array.from({length:Math.min(concurrency,batches.length)},()=>worker()));
      if(run===generation) update({status:'ready'});
    } catch(error) {
      if(run===generation) {update({status:'error',error:error.message});endHover();disconnect();}
    } finally {
      if(run===generation) {busy=false;if(dirty && state.status!=='error') {clearTimeout(timer);timer=setTimeout(restartDynamic,800);}}
    }
  }
  function activateHover(group) {
    clearTimeout(hoverRestores.get(group));hoverRestores.delete(group);
    if(group===activeHover) return;
    leaveHover();disconnect();
    activeHover=group;dom.writeTranslated(group);observe();
  }
  function bindHover(hoverDocument) {
    if(hoverDocuments.has(hoverDocument)) return;
    hoverDocuments.add(hoverDocument);
    hoverDocument.addEventListener('pointermove',event=>{
      if(settings?.mode!=='hover' || ['idle','paused','error'].includes(state.status)) return;
      const path=event.composedPath(),first=path.find(element=>element.nodeType===Node.ELEMENT_NODE);
      if(dom.protectedElement(first)) {leaveHover();return;}
      const caret=hoverDocument.caretRangeFromPoint?.(event.clientX,event.clientY),pointedGroup=hoverMap.get(caret?.startContainer);
      if(pointedGroup?.translation) {activateHover(pointedGroup);return;}
      for(const element of path) {const group=hoverMap.get(element);if(group?.translation) {activateHover(group);return;}}
      leaveHover();
    },{passive:true});
    hoverDocument.addEventListener('pointerout',event=>{if(activeHover && (!event.relatedTarget || !activeHover.anchor.contains(event.relatedTarget))) leaveHover();});
    hoverDocument.addEventListener('pointerleave',leaveHover);
    hoverDocument.addEventListener('keydown',event=>{if(event.key==='Escape') endHover();});
  }
  bindHover(document);
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(message.type==='ET_STATUS') {respond(state);return;}
    if(message.type==='ET_START') {start(message.settings);respond({ok:true});return;}
    if(message.type==='ET_RESTORE') {reset();respond({ok:true});return;}
    if(message.type==='ET_STOP') {generation++;busy=false;update({status:'paused'});endHover();disconnect();cancelRequests();respond({ok:true});}
  });
  globalThis.__errorTranslator={getState:()=>({...state}),start,restore:reset};
})();
