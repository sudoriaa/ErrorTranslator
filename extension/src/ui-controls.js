const controls=new Map();
let open=null,listNumber=0;
function closeList(focus=false) {
  if(!open) return;
  const current=open;open=null;current.panel.remove();current.trigger.setAttribute('aria-expanded','false');
  current.trigger.removeAttribute('aria-activedescendant');if(focus) current.trigger.focus();
}
function position(panel,trigger) {
  const rect=trigger.getBoundingClientRect(),below=innerHeight-rect.bottom-8,above=rect.top-8;
  const upward=below<160 && above>below;
  panel.style.width=`${Math.max(rect.width,170)}px`;
  panel.style.maxWidth=`${innerWidth-16}px`;panel.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-Math.max(rect.width,170)-8))}px`;
  panel.style.maxHeight=`${Math.max(80,Math.min(290,upward?above:below))}px`;
  if(upward) panel.style.bottom=`${innerHeight-rect.top+5}px`;else panel.style.top=`${rect.bottom+5}px`;
}
function openList(trigger,items,choose,{search=true,selected='',model=false}={}) {
  closeList();
  const panel=document.createElement('div');panel.className='select-popover';
  const list=document.createElement('div');list.className='select-options';list.id=`et-list-${++listNumber}`;list.setAttribute('role','listbox');
  trigger.setAttribute('aria-controls',list.id);trigger.setAttribute('aria-expanded','true');
  let filtered=items,active=Math.max(0,items.findIndex(item=>item.value===selected));
  const searchBox=document.createElement('input');searchBox.type='search';searchBox.className='select-search';searchBox.placeholder=model?'搜索模型…':'搜索…';searchBox.setAttribute('aria-label',model?'搜索模型':'搜索选项');
  function highlight() {
    const options=[...list.querySelectorAll('[role="option"]')];
    options.forEach((option,index)=>option.classList.toggle('active',index===active));
    if(options[active]) {trigger.setAttribute('aria-activedescendant',options[active].id);searchBox.setAttribute('aria-activedescendant',options[active].id);options[active].scrollIntoView({block:'nearest'});}
  }
  function select(item) {if(!item || item.disabled) return;choose(item.value);closeList(!model);}
  function render(query='') {
    filtered=items.filter(item=>item.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()));active=Math.min(active,Math.max(0,filtered.length-1));list.replaceChildren();
    for(const [index,item] of filtered.entries()) {
      const option=document.createElement('button');option.type='button';option.className='select-option';option.id=`${list.id}-${index}`;option.setAttribute('role','option');option.setAttribute('aria-label',item.label);option.setAttribute('aria-selected',String(item.value===selected));option.disabled=Boolean(item.disabled);
      const label=document.createElement('span');label.textContent=item.label;const check=document.createElement('span');check.className='select-check';check.textContent=item.value===selected?'✓':'';option.append(label,check);
      option.addEventListener('pointerdown',event=>event.preventDefault());option.addEventListener('click',()=>select(item));option.addEventListener('pointermove',()=>{active=index;highlight();});list.append(option);
    }
    if(!filtered.length) {const empty=document.createElement('div');empty.className='select-empty';empty.textContent='没有匹配的选项';list.append(empty);}
    highlight();
  }
  function key(event) {
    if(event.key==='Escape') {event.preventDefault();closeList(true);return;}
    if(event.key==='Tab') {closeList();return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();active=event.key==='Home'?0:event.key==='End'?filtered.length-1:(active+(event.key==='ArrowDown'?1:-1)+filtered.length)%Math.max(1,filtered.length);highlight();
    }
    if(event.key==='Enter') {event.preventDefault();select(filtered[active]);}
  }
  searchBox.addEventListener('input',()=>{active=0;render(searchBox.value);});searchBox.addEventListener('keydown',key);
  if(search) panel.append(searchBox);panel.append(list);document.body.append(panel);position(panel,trigger);
  open={panel,trigger,key,refresh:query=>render(query)};render(model?trigger.value:'');
  if(search && !model) searchBox.focus();
}
export function refreshSelects() {
  for(const [select,trigger] of controls) {
    trigger.querySelector('.select-value').textContent=select.selectedOptions[0]?.textContent || '请选择';
    trigger.disabled=select.disabled;trigger.setAttribute('aria-disabled',String(select.disabled));
  }
}
export function enhanceSelects(root=document) {
  for(const select of root.querySelectorAll('select')) {
    if(controls.has(select)) continue;
    const wrapper=document.createElement('span');wrapper.className='select-control';
    const trigger=document.createElement('button');trigger.type='button';trigger.className='select-trigger';trigger.id=`${select.id}-trigger`;trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
    const label=select.getAttribute('aria-label') || [...(select.labels?.[0]?.childNodes || [])].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent.trim()).join(' ') || '选择选项';
    trigger.setAttribute('aria-label',label);
    const value=document.createElement('span');value.className='select-value';const arrow=document.createElement('span');arrow.className='select-chevron';arrow.textContent='⌄';arrow.setAttribute('aria-hidden','true');trigger.append(value,arrow);
    select.before(wrapper);wrapper.append(select,trigger);select.hidden=true;controls.set(select,trigger);
    function show() {
      if(select.disabled) return;
      if(open?.trigger===trigger) {closeList();return;}
      openList(trigger,[...select.options].map(option=>({value:option.value,label:option.textContent,disabled:option.disabled})),next=>{select.value=next;select.dispatchEvent(new Event('change',{bubbles:true}));refreshSelects();},{selected:select.value,search:select.options.length>7});
    }
    trigger.addEventListener('click',show);
    trigger.addEventListener('keydown',event=>{if(open?.trigger===trigger) open.key(event);else if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();show();}});
    select.addEventListener('change',refreshSelects);
    new MutationObserver(refreshSelects).observe(select,{childList:true,subtree:true,attributes:true});
  }
  refreshSelects();
}
export function enhanceModelInput(input,datalist) {
  input.removeAttribute('list');input.setAttribute('role','combobox');input.setAttribute('aria-haspopup','listbox');input.setAttribute('aria-expanded','false');input.autocomplete='off';
  function show() {
    const items=[...datalist.options].map(option=>({value:option.value,label:option.value}));
    if(!items.length) return;
    openList(input,items,value=>{input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));},{model:true,search:false,selected:input.value});
  }
  input.addEventListener('focus',show);
  input.addEventListener('click',()=>{if(open?.trigger!==input) show();});
  input.addEventListener('input',()=>{if(open?.trigger!==input) show();else open.refresh(input.value);});
  input.addEventListener('keydown',event=>{if(open?.trigger===input) open.key(event);else if(event.key==='ArrowDown'){event.preventDefault();show();}});
}
document.addEventListener('pointerdown',event=>{if(open && !open.panel.contains(event.target) && !open.trigger.contains(event.target)) closeList();});
window.addEventListener('resize',()=>closeList());
window.addEventListener('scroll',event=>{if(open && !open.panel.contains(event.target)) closeList();},true);
