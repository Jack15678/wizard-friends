import { desktopFan } from './hand-model.js';

export function captureHand(hand) {
  if (!hand) return null;
  return { hidden:hand.offsetParent===null,expanded:hand.classList.contains('hand-grid'),focus:hand.contains(document.activeElement) ? document.activeElement.dataset.card : null,
    cards:new Map([...hand.querySelectorAll('[data-card]')].map(node=>[node.dataset.card,{node,rect:node.getBoundingClientRect()}])) };
}

// Keep card nodes keyed by their actual card IDs, including identical special
// faces. Rendering a new permission-filtered view never changes card identity.
export class HandMotion {
  constructor(onInspect) { this.onInspect=onInspect;this.animations=new Map();this.hovered=null; }
  attach(hand, previous, selected) {
    this.observer?.disconnect();for(const animation of this.animations.values())animation.cancel();this.animations.clear();
    this.hand=hand;this.selected=selected;if(!hand){this.nodes=[];this.hovered=null;return;}
    const next=[...hand.querySelectorAll('[data-card]')];
    for(const placeholder of next) {
      const old=previous?.cards.get(placeholder.dataset.card)?.node;if(!old)continue;
      for(const attribute of [...old.attributes])old.removeAttribute(attribute.name);
      for(const attribute of placeholder.attributes)old.setAttribute(attribute.name,attribute.value);
      old.innerHTML=placeholder.innerHTML;placeholder.replaceWith(old);
    }
    this.nodes=[...hand.querySelectorAll('[data-card]')];
    this.landscape=matchMedia('(orientation:landscape) and (min-width:600px) and (max-height:540px)').matches;
    const desktop=matchMedia('(min-width:851px) and (min-height:541px)').matches;
    this.canHover=matchMedia('(hover:hover) and (pointer:fine)').matches && (desktop || this.landscape);
    this.fan=(desktop || this.landscape) && !hand.classList.contains('hand-grid');
    hand.classList.toggle('desktop-fan',this.fan);
    if(!this.nodes.some(node=>node.dataset.card===this.hovered))this.hovered=null;
    this.layout();
    const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
    if(previous && !previous.hidden && !reduce && previous.expanded===hand.classList.contains('hand-grid')) {
      for(const node of this.nodes) {
        const was=previous.cards.get(node.dataset.card)?.rect;if(!was)continue;
        node.style.transition='none';const now=node.getBoundingClientRect();
        const dx=was.left-now.left,dy=was.top-now.top;
        const translate=getComputedStyle(node).translate;
        node.style.transition='';
        if(Math.abs(dx)+Math.abs(dy)>1) {
          const base=translate==='none' ? [0,0] : translate.split(' ').map(parseFloat);
          const animation=node.animate([{translate:`${dx+(base[0]||0)}px ${dy+(base[1]||0)}px`},{translate:`${base[0]||0}px ${base[1]||0}px`}],{duration:260,easing:'cubic-bezier(.2,.8,.2,1)'});
          this.animations.set(node.dataset.card,animation);
          animation.onfinish=()=>this.animations.delete(node.dataset.card);
        }
      }
    }
    for(const node of this.nodes) {
      node.onpointerenter=event=>{if(this.canHover && event.pointerType==='mouse')this.inspect(node.dataset.card);};
      node.onpointerleave=event=>{if(this.canHover && event.pointerType==='mouse')this.inspect(null);};
      node.onfocus=()=>{if(this.canHover)this.inspect(node.dataset.card);};
      node.onblur=()=>{if(this.canHover)this.inspect(null);};
    }
    this.onInspect(this.canHover ? this.hovered : null);
    this.observer=new ResizeObserver(()=>this.layout());this.observer.observe(hand);
    if(previous?.focus) this.nodes.find(node=>node.dataset.card===previous.focus)?.focus({preventScroll:true});
  }
  inspect(id) { this.hovered=id;this.layout();this.onInspect(id); }
  layout() {
    if(!this.hand)return;
    if(!this.fan)return;
    const inspected=this.nodes.findIndex(node=>node.dataset.card===this.hovered);
    const selected=this.nodes.findIndex(node=>node.dataset.card===this.selected);
    const fan=desktopFan(this.nodes.length,this.hand.clientWidth,inspected,selected,this.landscape);
    this.hand.style.setProperty('--fan-card-width',`${fan.cardWidth}px`);
    this.nodes.forEach((node,i)=>{
      const pose=fan.poses[i];
      node.style.setProperty('--fan-x',`${pose.x}px`);node.style.setProperty('--fan-y',`${pose.y}px`);
      node.style.setProperty('--hand-angle',`${pose.angle}deg`);node.style.setProperty('--hand-push',`${pose.push}px`);
      node.style.setProperty('--hand-lift',`${pose.lift}px`);node.style.zIndex=String(pose.z);
      node.classList.toggle('hovered',node.dataset.card===this.hovered);
    });
  }
}
