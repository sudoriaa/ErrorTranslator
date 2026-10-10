(() => {
  if(globalThis.ErrorTranslatorDOM) return;
  const EXCLUDED='script,style,noscript,template,pre,code,kbd,samp,textarea,input,select,option,svg,math,canvas,iframe,[translate="no"],.notranslate,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[aria-hidden="true"],[hidden],[data-error-translator],.hljs,.highlight,.prism-code,.monaco-editor,.cm-editor,.CodeMirror';
  const PROSE='p,h1,h2,h3,h4,h5,h6,figcaption,blockquote,dt,dd';
  const INTERACTIVE='button,a,label,summary,[role="button"],[role="tab"],[role="menuitem"],[role="option"]';
  const getStyle=element=>element.ownerDocument.defaultView.getComputedStyle(element);
  const ISOLATED='all:initial!important;box-sizing:border-box!important;font:inherit!important;color:inherit!important;color-scheme:inherit!important;direction:inherit!important;writing-mode:inherit!important;letter-spacing:inherit!important;text-align:inherit!important;';
  function isolatedStyle(element,css) {element.setAttribute('style',ISOLATED+css);}
  function protectedElement(element) {
    for(let current=element;current;) {
      if(current.closest?.(EXCLUDED)) return true;
      current=current.getRootNode?.().host;
    }
    return false;
  }
  function visible(element) {
    if(!element?.isConnected || protectedElement(element)) return false;
    const style=getStyle(element);
    return style.display!=='none' && style.visibility!=='hidden' && style.visibility!=='collapse' && element.getClientRects().length>0;
  }
  function roots(document) {
    const out=[];
    function visit(root) {
      out.push(root);
      for(const element of root.querySelectorAll('*')) {
        if(element.tagName==='IFRAME') {
          try {if(element.contentDocument?.body && visible(element.parentElement)) visit(element.contentDocument);} catch {}
          continue;
        }
        if(protectedElement(element)) continue;
        if(element.shadowRoot) visit(element.shadowRoot);
      }
    }
    visit(document);return out;
  }
  function blockFor(node) {
    const parent=node.parentElement;
    const prose=parent.closest(PROSE),interactive=parent.closest(INTERACTIVE);
    if(interactive && !(interactive.tagName==='A' && prose?.contains(interactive))) return parent;
    // Metadata spans are independent labels, including labels separated only by
    // indentation/newlines in the page's HTML. Keep ordinary prose aggregated.
    if(!prose && labelElement(parent)) return parent;
    let child=parent;
    for(let element=parent;element;element=element.parentElement) {
      const style=getStyle(element);
      if(/(?:flex|grid)$/.test(style.display)) return element===parent?parent:child;
      if(!['inline','contents'].includes(style.display)) return element;
      child=element;
    }
    return parent;
  }
  function collect(document) {
    const groups=[];
    for(const root of roots(document)) {
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      let node,currentGroup=null;
      while((node=walker.nextNode())) {
        if(!node.data || !visible(node.parentElement)) {if(node.data.trim()) currentGroup=null;continue;}
        const anchor=blockFor(node);
        if(currentGroup?.anchor!==anchor) currentGroup=null;
        if(!anchor) continue;
        if(currentGroup && (compact(currentGroup) || /(?:flex|grid)$/.test(getStyle(anchor).display))) {
          const last=currentGroup.nodes.at(-1).node;
          if(last.parentNode===node.parentNode) {
            for(let sibling=last.nextSibling;sibling && sibling!==node;sibling=sibling.nextSibling) {
              if(sibling.nodeType===Node.ELEMENT_NODE) {currentGroup=null;break;}
            }
          }
        }
        if(!currentGroup) {currentGroup={anchor,nodes:[],translation:null};groups.push(currentGroup);}
        currentGroup.nodes.push({node,original:node.data,translated:null});
      }
    }
    return groups.filter(group=>group.nodes.some(item=>/[\p{L}]/u.test(item.original)));
  }
  function splitText(text,max=1400) {
    if(text.length<=max) return [text];
    const sentences=typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'sentence'}).segment(text)].map(s=>s.segment):[text];
    const chunks=[];let chunk='';
    for(let sentence of sentences) {
      if(chunk.length+sentence.length>max && chunk) {chunks.push(chunk);chunk='';}
      while(sentence.length>max) {
        let end=max;
        if(/[\uD800-\uDBFF]/.test(sentence[end-1])) end--;
        chunks.push(sentence.slice(0,end));sentence=sentence.slice(end);
      }
      chunk+=sentence;
    }
    if(chunk) chunks.push(chunk);return chunks;
  }
  function plainText(group) {return group.nodes.map(item=>item.original).join('').trim();}
  function sameText(a,b) {return a.normalize('NFKC').replace(/\s+/g,' ').trim()===b.normalize('NFKC').replace(/\s+/g,' ').trim();}
  function restoreNodes(group) {
    for(const item of group.nodes) {
      if(item.translated!==null && item.node.isConnected && item.node.data===item.translated) item.node.data=item.original;
      item.translated=null;
    }
  }
  function restore(groups) {
    for(const group of groups) {
      group.output?.remove();group.output=null;restoreNodes(group);
      if(group.slot?.isConnected) {
        if(group.source?.parentNode) group.source.replaceWith(...group.source.childNodes);
        group.slot.replaceWith(...group.slot.childNodes);
      }
      group.slot=null;group.source=null;
    }
  }
  function groupRect(group) {
    const range=group.anchor.ownerDocument.createRange();
    range.setStartBefore(group.nodes[0].node);range.setEndAfter(group.nodes.at(-1).node);
    return range.getBoundingClientRect();
  }
  function labelElement(element) {
    if(!['SPAN','TIME','RELATIVE-TIME'].includes(element.tagName) || element.textContent.trim().length>160 || element.querySelector('p,div,section')) return false;
    const style=getStyle(element),parent=element.parentElement;
    if(element.tagName!=='SPAN' || ['inline-block','inline-flex'].includes(style.display) || style.whiteSpace==='nowrap') return true;
    return parent && parent.textContent.trim().length<300 && [...parent.children].filter(child=>child.textContent.trim()).length>=2;
  }
  function compact(group) {
    const prose=group.anchor.closest(PROSE),interactive=group.anchor.closest(INTERACTIVE);
    if(interactive && !(interactive.tagName==='A' && prose?.contains(interactive))) return true;
    if(plainText(group).length>100 || prose) return false;
    const style=getStyle(group.anchor);
    const parentStyle=group.anchor.parentElement && getStyle(group.anchor.parentElement);
    const shortLabel=plainText(group).length<=60 && groupRect(group).height<=(parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.5)*1.35;
    return style.display==='inline-flex' || style.whiteSpace==='nowrap' || Boolean(group.anchor.closest('nav,header,[role="navigation"],[role="toolbar"],.Truncate,.ActionList,.ActionListItem')) || shortLabel && (['inline-block','contents'].includes(style.display) || labelElement(group.anchor) || /(?:flex|grid)$/.test(parentStyle?.display || '') || Boolean(group.anchor.closest('td,th')));
  }
  function translationWidth(group,text,font) {
    const style=getStyle(group.anchor),canvas=group.anchor.ownerDocument.createElement('canvas');
    const context=canvas.getContext('2d');
    context.font=`${style.fontStyle} ${style.fontWeight} ${font*.92}px ${style.fontFamily}`;
    // Include the highlight's padding, margin and a rounding allowance.
    return Math.ceil(context.measureText(text).width+(parseFloat(style.letterSpacing)||0)*text.length+font*.5+10);
  }
  function createOutput(group,text,language,layout) {
    const document=group.anchor.ownerDocument,host=document.createElement('et-translation');
    host.dataset.errorTranslator='translation';host.dataset.layout=layout;host.setAttribute('aria-label',text);host.title=text;
    const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');
    const inline=layout==='inline',small=layout==='compact';
    const whitespace=/pre|break-spaces/.test(getStyle(group.anchor).whiteSpace)?'pre-wrap':'normal';
    style.textContent=`:host{font:inherit;color:inherit;box-sizing:border-box}.text{box-sizing:border-box;${small?'display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;':inline?'display:inline;white-space:nowrap;':`display:block;white-space:${whitespace};overflow-wrap:break-word;`}color:light-dark(#994a36,#ffb49e);background:light-dark(#cc654c0d,#ffb49e15);${small?'font-size:inherit;line-height:inherit;':'font-size:.92em;line-height:1.5;'}${inline?'border-radius:3px;padding:0 .25em;':'border-left:2px solid #cc654c85;padding-left:7px;'}}`;
    const content=document.createElement('span');content.className='text';content.lang=language;content.dir='auto';content.textContent=text;
    shadow.append(style,content);group.output=host;return host;
  }
  function sourceSlot(group) {
    const parent=group.nodes[0].node.parentNode;
    if(!group.nodes.every(item=>item.node.parentNode===parent)) return null;
    if(group.nodes.length>1) {
      for(let sibling=group.nodes[0].node.nextSibling;sibling && sibling!==group.nodes.at(-1).node;sibling=sibling.nextSibling) {
        if(sibling.nodeType===Node.ELEMENT_NODE) return null;
      }
    }
    const slot=group.anchor.ownerDocument.createElement('et-source-slot');slot.dataset.errorTranslator='slot';
    const source=group.anchor.ownerDocument.createElement('et-source');source.dataset.etOriginal='';
    isolatedStyle(source,'display:inline!important;');
    isolatedStyle(slot,'display:inline!important;');
    group.nodes[0].node.before(slot);slot.append(source);for(const item of group.nodes) source.append(item.node);
    group.slot=slot;group.source=source;return slot;
  }
  function trailingContent(group,control) {
    let current=group.nodes.at(-1).node;
    while(current && current!==control) {
      for(let sibling=current.nextSibling;sibling;sibling=sibling.nextSibling) {
        if(sibling.nodeType===Node.TEXT_NODE?sibling.data.trim():sibling.nodeType===Node.ELEMENT_NODE && sibling.getClientRects().length) return true;
      }
      current=current.parentNode;
    }
    return false;
  }
  function insertBilingual(group,text,language) {
    if(sameText(plainText(group),text)) return;
    const rect=groupRect(group),style=getStyle(group.anchor),font=parseFloat(style.fontSize)||14,translatedWidth=translationWidth(group,text,font);
    if(compact(group)) {
      const control=group.anchor.closest(INTERACTIVE),controlRect=control?.getBoundingClientRect();
      const slot=sourceSlot(group);
      if(slot) {
        // Fit both lines into the existing label box; do not add flex/grid items.
        // A label may inherit a container-sized line-height (e.g. 200px).
        // Use its actual glyph box instead of expanding to that container height.
        const height=Math.max(rect.height,Math.min(parseFloat(style.lineHeight)||font*1.2,font*1.6)),width=Math.max(1,rect.width);
        const box=controlRect || group.anchor.getBoundingClientRect(),boxStyle=control?getStyle(control):style;
        const free=box.right-rect.right-(parseFloat(boxStyle.paddingRight)||0);
        const trailing=control && trailingContent(group,control);
        if((control?getStyle(control).display==='flex':!['inline','contents'].includes(style.display)) && free>translatedWidth && !trailing) {
          const needed=width+translatedWidth;
          isolatedStyle(slot,`display:inline-flex!important;align-items:center!important;position:relative!important;width:${needed}px!important;height:${height}px!important;max-width:100%!important;vertical-align:middle!important;white-space:nowrap!important;`);
          isolatedStyle(group.source,`display:inline-block!important;width:${width}px!important;vertical-align:middle!important;`);
          const output=createOutput(group,text,language,'inline');isolatedStyle(output,'display:inline-block!important;flex-shrink:0!important;margin-inline-start:8px!important;white-space:nowrap!important;');slot.append(output);return;
        }
        isolatedStyle(slot,`display:inline-block!important;position:relative!important;width:${width}px!important;max-width:100%!important;height:${height}px!important;vertical-align:middle!important;line-height:${height}px!important;`);
        isolatedStyle(group.source,`display:block!important;position:absolute!important;inset:0 0 auto!important;font-size:${Math.min(font,height*.46)}px!important;line-height:${height/2}px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;`);
        const output=createOutput(group,text,language,'compact');
        isolatedStyle(output,`display:block!important;position:absolute!important;inset:auto 0 0!important;max-width:100%!important;font-size:${Math.min(font,height*.46)}px!important;line-height:${height/2}px!important;`);
        slot.append(output);return;
      }
    }
    const heading=group.anchor.closest('h1,h2,h3,h4,h5,h6'),headingParent=heading?.parentElement;
    if(headingParent && /flex$/.test(getStyle(headingParent).display)) {
      const parentStyle=getStyle(headingParent),siblings=[...headingParent.children].filter(child=>child!==heading);
      const remaining=headingParent.getBoundingClientRect().width-heading.getBoundingClientRect().width-siblings.reduce((sum,child)=>sum+child.getBoundingClientRect().width,0)-(parseFloat(parentStyle.paddingLeft)||0)-(parseFloat(parentStyle.paddingRight)||0)-(parseFloat(parentStyle.columnGap)||0)*siblings.length;
      if(remaining>translatedWidth) {
        const slot=sourceSlot(group);
        if(slot) {
          isolatedStyle(slot,`display:inline-flex!important;align-items:baseline!important;flex-shrink:0!important;white-space:nowrap!important;width:${rect.width+translatedWidth}px!important;`);
          const output=createOutput(group,text,language,'inline');isolatedStyle(output,'display:inline-block!important;margin-inline-start:8px!important;white-space:nowrap!important;flex-shrink:0!important;');slot.append(output);return;
        }
      }
    }
    const right=group.anchor.getBoundingClientRect().right-rect.right;
    const inline=plainText(group).length<=90 && text.length<=100 && right>translatedWidth+font*.6 && !/(?:flex|grid)$/.test(style.display);
    const output=createOutput(group,text,language,inline?'inline':'block');
    isolatedStyle(output,inline?'display:inline!important;margin-inline-start:.6em!important;white-space:nowrap!important;':'display:block!important;margin:5px 0 2px!important;min-width:0!important;max-width:100%!important;');
    if(/(?:flex|grid)$/.test(style.display)) {
      const occupied=[...group.anchor.children].reduce((sum,child)=>sum+child.getBoundingClientRect().width,0);
      const available=Math.max(rect.width,group.anchor.getBoundingClientRect().width-occupied-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0)-(parseFloat(style.columnGap)||0)*group.anchor.children.length);
      const slot=sourceSlot(group);
      if(slot) {isolatedStyle(slot,`display:inline-block!important;min-width:0!important;max-width:100%!important;width:${Math.max(1,Math.min(available,Math.max(rect.width,translatedWidth)))}px!important;`);slot.append(output);return;}
    }
    group.nodes.at(-1).node.after(output);
  }
  function writeTranslated(group) {
    for(const item of group.nodes) {
      if(!/[\p{L}]/u.test(item.original)) continue;
      if(item.node.isConnected && (item.node.data===item.original || item.node.data===item.translated)) {
        const text=item.parts.map(part=>part.translation || part.text).join('');
        item.translated=item.original.match(/^\s*/)[0]+text.trim()+item.original.match(/\s*$/)[0];item.node.data=item.translated;
      }
    }
  }
  globalThis.ErrorTranslatorDOM={collect,roots,splitText,plainText,sameText,restore,restoreNodes,insertBilingual,writeTranslated,protectedElement};
})();
