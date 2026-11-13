const CAP_Y=1460,FONT='Inter';
function parseText(s){return s.split(' ').map(w=>{const hl=w.includes('*');w=w.replace(/\*/g,'');return{raw:w,hl,disp:w.replace(/[.,]+$/,'')}})}
function buildCaps(sc,start){
  const words=parseText(sc.text);const lead=.12,span=sc.dur-.25;
  const wt=words.map(w=>w.raw.length+3+(/[.,?!]$/.test(w.raw)?4:0));const tot=wt.reduce((a,b)=>a+b,0);
  let acc=start+lead;words.forEach((w,i)=>{w.t=acc;acc+=wt[i]/tot*span});
  const chunks=[];let cur=[];
  words.forEach((w,i)=>{cur.push(w);const brk=/[.,?!:]$/.test(w.raw)||cur.length>=3;const nxtHl=words[i+1]&&words[i+1].hl&&w.hl;
    if(brk&&!(nxtHl&&cur.length<4)){chunks.push(cur);cur=[]}});
  if(cur.length)chunks.push(cur);
  chunks.forEach((c,i)=>{c.t0=c[0].t;c.t1=chunks[i+1]?chunks[i+1][0].t:start+sc.dur});
  sc.words=words;sc.chunks=chunks;
}
function segs(ws){const out=[];ws.forEach(w=>{const l=out[out.length-1];if(l&&l.hl&&w.hl)l.txt+=' '+w.disp;else out.push({hl:w.hl,txt:w.disp})});return out}
function drawRich(parts,cx,cy,size,scale,align){
  ctx.save();ctx.font=`900 ${size}px ${FONT}`;ctx.textBaseline='middle';
  const gap=size*.28,pad=size*.22;
  const ws=parts.map(p=>ctx.measureText(p.txt).width+(p.hl?pad*2:0));
  const total=ws.reduce((a,b)=>a+b,0)+gap*(parts.length-1);
  ctx.translate(cx,cy);ctx.scale(scale,scale);
  let x=align==='left'?0:-total/2;
  parts.forEach((p,i)=>{
    if(p.hl){rr(x,-size*.68,ws[i],size*1.3,size*.2);ctx.fillStyle='#FFC83D';ctx.fill();ctx.lineWidth=size*.07;ctx.strokeStyle='#2A1B0B';ctx.stroke();ctx.fillStyle='#22160A';ctx.fillText(p.txt,x+pad,size*.03)}
    else{ctx.lineJoin='round';ctx.lineWidth=size*.17;ctx.strokeStyle='#17120E';ctx.strokeText(p.txt,x,size*.03);ctx.fillStyle='#FFFFFF';ctx.fillText(p.txt,x,size*.03)}
    x+=ws[i]+gap});
  ctx.restore();
}
function drawCaption(sc,t){const c=sc.chunks.find(c=>t>=c.t0&&t<c.t1);if(!c)return;const lt=t-c.t0,sg=segs(c);ctx.save();ctx.font='900 76px '+FONT;const wd=sg.reduce((a,p)=>a+ctx.measureText(p.txt).width+(p.hl?76*.44:0),0)+76*.28*(sg.length-1);ctx.restore();const fit=Math.min(1,960/wd);drawRich(sg,W/2,CAP_Y,76,(lt<.14?.82+.18*back(lt/.14):1)*fit)}
function drawLabels(sc,lt){
  if(sc._noLabel){if(sc.tag){ctx.save();ctx.font=`800 28px ${FONT}`;const w=ctx.measureText(sc.tag).width+40;rr(W-58-w,90,w,48,10);ctx.fillStyle='rgba(20,20,28,.82)';ctx.fill();ctx.fillStyle='#fff';ctx.textBaseline='middle';ctx.fillText(sc.tag,W-58-w+20,115);ctx.restore()}return}
  ctx.save();ctx.font=`800 30px ${FONT}`;ctx.textBaseline='middle';ctx.fillStyle='#FFC83D';ctx.beginPath();ctx.arc(66,112,8,0,7);ctx.fill();
  ctx.shadowColor='rgba(0,0,0,.6)';ctx.shadowBlur=8;ctx.fillStyle='#fff';ctx.fillText(sc.label.split('').join(String.fromCharCode(8202)),86,113);ctx.restore();
  drawRich(sc.title.map(s=>({hl:s.startsWith('*'),txt:s.replace('*','').trim()})),58,190,58,1,'left');
  if(sc.tag){ctx.save();ctx.font=`800 28px ${FONT}`;const w=ctx.measureText(sc.tag).width+40;rr(W-58-w,90,w,48,10);ctx.fillStyle='rgba(20,20,28,.82)';ctx.fill();ctx.fillStyle='#fff';ctx.textBaseline='middle';ctx.fillText(sc.tag,W-58-w+20,115);ctx.restore()}
}
function pill(txt,cx,cy,bg,fg,size){ctx.save();ctx.font=`900 ${size}px ${FONT}`;ctx.textBaseline='middle';const w=ctx.measureText(txt).width+size*1.1,h=size*1.75;rr(cx-w/2,cy-h/2,w,h,h*.3);ctx.fillStyle=bg;ctx.fill();ctx.lineWidth=4;ctx.strokeStyle='#2A1B0B';ctx.stroke();ctx.fillStyle=fg;ctx.textAlign='center';ctx.fillText(txt,cx,cy+2);ctx.restore()}
function wordT(sc,w){const x=sc.words.find(x=>x.disp.toLowerCase().startsWith(w));return x?x.t:sc.start}
