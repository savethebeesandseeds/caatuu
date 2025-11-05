import { setVar, $ } from './utils.js';

function dragResizer(el, onMove){
  let dragging=false;
  const move=(e)=>{ if(!dragging) return; onMove(e); };
  const up=()=>{ dragging=false; document.body.style.userSelect=''; document.removeEventListener('mousemove',move); document.removeEventListener('mouseup',up); };
  el.addEventListener('mousedown', ()=>{
    dragging=true; document.body.style.userSelect='none';
    document.addEventListener('mousemove',move);
    document.addEventListener('mouseup',up);
  });
}

export function initResizers(){
  // Vertical resizer between Agent (left) and right column (top row)
  dragResizer($('#vr'), (e)=>{
    const grid = $('#grid');
    const rect = grid.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, rect.width*0.18), rect.width*0.75);
    const pct = (x / rect.width) * 100;
    setVar('--col-left', pct.toFixed(2)+'%');
  });

  // Vertical resizer between middle and far-right column (entire height)
  dragResizer($('#vrRight'), (e)=>{
    const grid = $('#grid');
    const rect = grid.getBoundingClientRect();
    // distance from pointer to right edge = desired help column width
    const xFromRight = rect.right - e.clientX;
    // clamp between 16% and 44% of total width; minmax(260px, …) still applies in CSS
    const pct = Math.min(Math.max((xFromRight / rect.width) * 100, 16), 44);
    setVar('--col-help', pct.toFixed(2) + '%');
  });


  // Horizontal resizer between top and bottom
  dragResizer($('#hr'), (e)=>{
    const grid = $('#grid');
    const rect = grid.getBoundingClientRect();
    const y = Math.min(Math.max(e.clientY - rect.top, rect.height*0.30), rect.height*0.85);
    setVar('--row-top', y.toFixed(0)+'px');
  });

  // Horizontal resizer inside right column (Help vs Challenge)
  const right = $('#rightTop');
  const hrRight = $('#hrRight');
  if (right && hrRight){
    dragResizer(hrRight, (e)=>{
      const r = right.getBoundingClientRect();
      let y = e.clientY - r.top;
      const min = Math.max(120, r.height * 0.15);
      const max = Math.min(r.height - 120, r.height * 0.85);
      y = Math.min(Math.max(y, min), max);
      setVar('--right-split', `${Math.round(y)}px`);
    });
  }
}
