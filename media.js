/* media.js: shared video helpers for the tools on this site (stereo.html, watermark.html).
   - makeMp4: plain MP4 muxer (moov first, constant frame rate, real duration, optional AAC audio track)
   - GifWriter: streaming GIF encoder
   - createMp4Sink / createGifSink: take finished frames one at a time, so long clips never pile up in memory
   - loadVideoSource / drawVideoFrame: read a video or animated GIF and grab frames at any time
   - probeMp4 / readMp4Audio: read frame rate and copy the AAC audio of an MP4 or MOV without re-encoding */

function sleep(ms){ return new Promise(function(r){ setTimeout(r,ms); }); }

/* ---------------- MP4 muxer ----------------
   Builds a plain, non-fragmented MP4 from H.264 samples in AVCC form (what WebCodecs' VideoEncoder gives with
   {avc:{format:'avc'}}). Browser MediaRecorder files lack the total duration, which is why Google Photos showed 0:00. */
function mp4Cat(list){ var n=0,i; for(i=0;i<list.length;i++) n+=list[i].length; var o=new Uint8Array(n),p=0; for(i=0;i<list.length;i++){ o.set(list[i],p); p+=list[i].length; } return o; }
function mp4U32(v){ return new Uint8Array([(v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255]); }
function mp4U16(v){ return new Uint8Array([(v>>>8)&255,v&255]); }
function mp4Str(s){ var o=new Uint8Array(s.length); for(var i=0;i<s.length;i++) o[i]=s.charCodeAt(i); return o; }
function mp4Z(n){ return new Uint8Array(n); }
function mp4Box(type,parts){ var body=mp4Cat(parts); return mp4Cat([mp4U32(body.length+8),mp4Str(type),body]); }
/* samples: [{data:Uint8Array, key:bool}] in presentation order, one every 1/fps s. avcC: AVCDecoderConfigurationRecord bytes.
   audio (optional): {timescale, channels, sampleRate, esds (the whole 'esds' box of the source, bytes), samples:[Uint8Array], durs:[ticks per sample]} */
function makeMp4(samples,avcC,w,h,fps,audio){
  var N=samples.length, TS=Math.round(1000*fps), i, durMs=Math.round(N*1000/fps);
  var A=audio&&audio.samples&&audio.samples.length?audio:null, aTicks=0, aBytes=0;
  if(A){ for(i=0;i<A.durs.length;i++) aTicks+=A.durs[i]; for(i=0;i<A.samples.length;i++) aBytes+=A.samples[i].length; durMs=Math.max(durMs,Math.round(aTicks*1000/A.timescale)); }
  var matrix=mp4Cat([mp4U32(0x10000),mp4Z(12),mp4U32(0x10000),mp4Z(12),mp4U32(0x40000000)]);
  var ftyp=mp4Box('ftyp',[mp4Str('isom'),mp4U32(512),mp4Str('isomiso2avc1mp41')]);
  var keys=[]; for(i=0;i<N;i++) if(samples[i].key||i===0) keys.push(i+1);
  var sizes=new Uint8Array(4*N); for(i=0;i<N;i++) sizes.set(mp4U32(samples[i].data.length),4*i);
  var keyB=new Uint8Array(4*keys.length); for(i=0;i<keys.length;i++) keyB.set(mp4U32(keys[i]),4*i);
  var vBytes=0; for(i=0;i<N;i++) vBytes+=samples[i].data.length;
  var dinf=mp4Box('dinf',[mp4Box('dref',[mp4Z(4),mp4U32(1),mp4Box('url ',[mp4U32(1)])])]);
  function videoTrak(off){
    var avc1=mp4Box('avc1',[mp4Z(6),mp4U16(1),mp4Z(16),mp4U16(w),mp4U16(h),mp4U32(0x480000),mp4U32(0x480000),mp4Z(4),mp4U16(1),mp4Z(32),mp4U16(0x18),mp4U16(0xffff),mp4Box('avcC',[avcC])]);
    var stbl=mp4Box('stbl',[
      mp4Box('stsd',[mp4Z(4),mp4U32(1),avc1]),
      mp4Box('stts',[mp4Z(4),mp4U32(1),mp4U32(N),mp4U32(1000)]),
      mp4Box('stss',[mp4Z(4),mp4U32(keys.length),keyB]),
      mp4Box('stsc',[mp4Z(4),mp4U32(1),mp4U32(1),mp4U32(N),mp4U32(1)]),
      mp4Box('stsz',[mp4Z(4),mp4U32(0),mp4U32(N),sizes]),
      mp4Box('stco',[mp4Z(4),mp4U32(1),mp4U32(off)])]);
    var minf=mp4Box('minf',[mp4Box('vmhd',[mp4U32(1),mp4Z(8)]),dinf,stbl]);
    var mdia=mp4Box('mdia',[mp4Box('mdhd',[mp4Z(4),mp4Z(8),mp4U32(TS),mp4U32(N*1000),mp4U16(0x55c4),mp4Z(2)]),
      mp4Box('hdlr',[mp4Z(4),mp4Z(4),mp4Str('vide'),mp4Z(12),mp4Str('VideoHandler'),mp4Z(1)]),minf]);
    return mp4Box('trak',[mp4Box('tkhd',[mp4U32(3),mp4Z(8),mp4U32(1),mp4Z(4),mp4U32(Math.round(N*1000/fps)),mp4Z(8),mp4Z(4),mp4Z(4),matrix,mp4U32(w*65536),mp4U32(h*65536)]),mdia]);
  }
  function audioTrak(off){
    var n=A.samples.length, asz=new Uint8Array(4*n), runs=[], j;
    for(j=0;j<n;j++) asz.set(mp4U32(A.samples[j].length),4*j);
    for(j=0;j<n;j++){ if(runs.length&&runs[runs.length-1][1]===A.durs[j]) runs[runs.length-1][0]++; else runs.push([1,A.durs[j]]); }
    var stts=new Uint8Array(8*runs.length); for(j=0;j<runs.length;j++){ stts.set(mp4U32(runs[j][0]),8*j); stts.set(mp4U32(runs[j][1]),8*j+4); }
    var mp4a=mp4Box('mp4a',[mp4Z(6),mp4U16(1),mp4Z(8),mp4U16(A.channels),mp4U16(16),mp4Z(4),mp4U32((A.sampleRate&0xffff)*65536),A.esds]);
    var stbl=mp4Box('stbl',[
      mp4Box('stsd',[mp4Z(4),mp4U32(1),mp4a]),
      mp4Box('stts',[mp4Z(4),mp4U32(runs.length),stts]),
      mp4Box('stsc',[mp4Z(4),mp4U32(1),mp4U32(1),mp4U32(n),mp4U32(1)]),
      mp4Box('stsz',[mp4Z(4),mp4U32(0),mp4U32(n),asz]),
      mp4Box('stco',[mp4Z(4),mp4U32(1),mp4U32(off)])]);
    var minf=mp4Box('minf',[mp4Box('smhd',[mp4Z(8)]),dinf,stbl]);
    var mdia=mp4Box('mdia',[mp4Box('mdhd',[mp4Z(4),mp4Z(8),mp4U32(A.timescale),mp4U32(aTicks),mp4U16(0x55c4),mp4Z(2)]),
      mp4Box('hdlr',[mp4Z(4),mp4Z(4),mp4Str('soun'),mp4Z(12),mp4Str('SoundHandler'),mp4Z(1)]),minf]);
    return mp4Box('trak',[mp4Box('tkhd',[mp4U32(3),mp4Z(8),mp4U32(2),mp4Z(4),mp4U32(Math.round(aTicks*1000/A.timescale)),mp4Z(8),mp4Z(2),mp4Z(2),mp4U16(0x100),mp4Z(2),matrix,mp4Z(8)]),mdia]);
  }
  function moovAt(vOff,aOff){
    var mvhd=mp4Box('mvhd',[mp4Z(4),mp4Z(8),mp4U32(1000),mp4U32(durMs),mp4U32(0x10000),mp4U16(0x100),mp4Z(10),matrix,mp4Z(24),mp4U32(A?3:2)]);
    var kids=[mvhd,videoTrak(vOff)]; if(A) kids.push(audioTrak(aOff));
    return mp4Box('moov',kids);
  }
  var moovLen=moovAt(0,0).length, base=ftyp.length+moovLen+8;
  var moov=moovAt(base,base+vBytes), parts=[ftyp,moov,mp4U32(vBytes+aBytes+8),mp4Str('mdat')];
  for(i=0;i<N;i++) parts.push(samples[i].data);
  if(A) for(i=0;i<A.samples.length;i++) parts.push(A.samples[i]);
  return mp4Cat(parts);
}

/* ---------------- GIF writer ----------------
   Streams frames one at a time: each frame gets its own 256-colour palette (median cut on 15-bit colour) and LZW data. */
function gifQuantize(rgba,n){
  var hist=new Uint32Array(32768), i, key;
  for(i=0;i<n;i++){ var o=i*4; hist[((rgba[o]>>3)<<10)|((rgba[o+1]>>3)<<5)|(rgba[o+2]>>3)]++; }
  var cols=[]; for(key=0;key<32768;key++) if(hist[key]) cols.push(key);
  var R=function(k){ return k>>10; }, G=function(k){ return (k>>5)&31; }, B=function(k){ return k&31; };
  var boxes=[{c:cols}], ch=[R,G,B];
  function stats(b){ var mn=[31,31,31], mx=[0,0,0], pop=0, j, k, c; for(j=0;j<b.c.length;j++){ c=b.c[j]; pop+=hist[c]; for(k=0;k<3;k++){ var v=ch[k](c); if(v<mn[k]) mn[k]=v; if(v>mx[k]) mx[k]=v; } }
    var ax=0,rg=mx[0]-mn[0]; if(mx[1]-mn[1]>rg){ ax=1; rg=mx[1]-mn[1]; } if(mx[2]-mn[2]>rg){ ax=2; rg=mx[2]-mn[2]; }
    b.axis=ax; b.range=rg; b.pop=pop; b.score=b.c.length>1? (rg+1)*Math.sqrt(pop):0; }
  stats(boxes[0]);
  while(boxes.length<256){
    var bi=-1, best=0, j; for(j=0;j<boxes.length;j++) if(boxes[j].score>best){ best=boxes[j].score; bi=j; }
    if(bi<0) break;
    var b=boxes[bi], f=ch[b.axis]; b.c.sort(function(p,q){ return f(p)-f(q); });
    var half=b.pop/2, acc=0, cut=1; for(j=0;j<b.c.length-1;j++){ acc+=hist[b.c[j]]; cut=j+1; if(acc>=half) break; }
    var nb={c:b.c.slice(cut)}; b.c=b.c.slice(0,cut); stats(b); stats(nb); boxes.push(nb);
  }
  var lut=new Uint8Array(32768), pal=new Uint8Array(768), bx, k, c;
  for(bx=0;bx<boxes.length;bx++){ var sr=0,sg=0,sb=0,sp=0, bb=boxes[bx];
    for(k=0;k<bb.c.length;k++){ c=bb.c[k]; var p=hist[c]; sr+=R(c)*p; sg+=G(c)*p; sb+=B(c)*p; sp+=p; lut[c]=bx; }
    pal[bx*3]=Math.min(255,Math.round(sr/sp*8+4)); pal[bx*3+1]=Math.min(255,Math.round(sg/sp*8+4)); pal[bx*3+2]=Math.min(255,Math.round(sb/sp*8+4)); }
  var idx=new Uint8Array(n);
  for(i=0;i<n;i++){ var q=i*4; idx[i]=lut[((rgba[q]>>3)<<10)|((rgba[q+1]>>3)<<5)|(rgba[q+2]>>3)]; }
  return {pal:pal,idx:idx};
}
function gifLzw(idx){
  var out=[], buf=0, nb=0, cur=[], HS=16384, hk=new Int32Array(HS), hv=new Int32Array(HS);
  var CLEAR=256, EOI=257, next=258, size=9, i;
  function emit(code){ buf|=code<<nb; nb+=size; while(nb>=8){ cur.push(buf&255); buf>>>=8; nb-=8; if(cur.length===255){ out.push(255); for(var j=0;j<255;j++) out.push(cur[j]); cur=[]; } } }
  function resetTable(){ hk.fill(-1); next=258; size=9; }
  resetTable(); emit(CLEAR);
  var code=idx[0];
  for(i=1;i<idx.length;i++){
    var k=idx[i], key=(code<<8)|k, h=(Math.imul(key,2654435761)>>>18)&(HS-1), found=-1;
    while(hk[h]!==-1){ if(hk[h]===key){ found=hv[h]; break; } h=(h+1)&(HS-1); }
    if(found>=0){ code=found; continue; }
    emit(code);
    if(next===4096){ emit(CLEAR); resetTable(); }
    else { if(next>=(1<<size)) size++; hk[h]=key; hv[h]=next++; }
    code=k;
  }
  emit(code); emit(EOI);
  if(nb>0) cur.push(buf&255);
  if(cur.length){ out.push(cur.length); for(i=0;i<cur.length;i++) out.push(cur[i]); }
  out.push(0);
  return Uint8Array.from(out);
}
function GifWriter(w,h,fps){
  this.w=w; this.h=h; this.fps=fps; this.n=0; this.parts=[];
  var le=function(v){ return [v&255,(v>>8)&255]; };
  this.parts.push(Uint8Array.from([71,73,70,56,57,97].concat(le(w),le(h),[0x70,0,0, 33,255,11,78,69,84,83,67,65,80,69,50,46,48,3,1,0,0,0])));
}
/* rgba: Uint8ClampedArray (w*h*4, opaque). Delay is rounded so the average frame time stays exact at any fps. */
GifWriter.prototype.addFrame=function(rgba){
  var q=gifQuantize(rgba,this.w*this.h), le=function(v){ return [v&255,(v>>8)&255]; };
  var d=Math.round((this.n+1)*100/this.fps)-Math.round(this.n*100/this.fps); this.n++;
  this.parts.push(Uint8Array.from([33,249,4,0x04].concat(le(d),[0,0])));
  this.parts.push(Uint8Array.from([44,0,0,0,0].concat(le(this.w),le(this.h),[0x87])));
  this.parts.push(q.pal);
  this.parts.push(Uint8Array.from([8])); this.parts.push(gifLzw(q.idx));
};
GifWriter.prototype.finish=function(){ var p=this.parts.concat([Uint8Array.from([59])]); return mp4Cat(p); };

/* ---------------- sinks ---------------- */
/* canvas: the canvas whose current contents are the next frame. Returns null when this browser has no H.264 encoder. */
async function createMp4Sink(canvas,W,H,fps){
  if(typeof VideoEncoder==='undefined' || typeof VideoFrame==='undefined') return null;
  var bps=Math.min(40e6,Math.max(4e6,Math.round(W*H*fps*1.2))), cfg=null, ci, cands=['avc1.640028','avc1.640033','avc1.4d0028','avc1.42002a'];
  for(ci=0;ci<cands.length && !cfg;ci++){
    var base={codec:cands[ci],width:W,height:H,bitrate:bps,framerate:fps,avc:{format:'avc'}};
    try{ var sup=await VideoEncoder.isConfigSupported(base); if(sup.supported) cfg=base; }catch(e){}
  }
  if(!cfg) return null;
  var samples=[], avcC=null, err=null, lastTs=-1, ordered=true;
  var enc=new VideoEncoder({
    output:function(chunk,meta){
      var dsc=meta&&meta.decoderConfig&&meta.decoderConfig.description;
      if(dsc && !avcC){ avcC=(dsc instanceof ArrayBuffer)?new Uint8Array(dsc.slice(0)):new Uint8Array(dsc.buffer.slice(dsc.byteOffset,dsc.byteOffset+dsc.byteLength)); }
      var d=new Uint8Array(chunk.byteLength); chunk.copyTo(d);
      if(chunk.timestamp<=lastTs) ordered=false; lastTs=chunk.timestamp;
      samples.push({data:d,key:chunk.type==='key'});
    },
    error:function(e){ err=e; }
  });
  enc.configure(cfg);
  var every=Math.max(1,Math.round(fps));
  return {
    add:async function(i){
      if(err) throw err;
      while(enc.encodeQueueSize>6){ await sleep(4); if(err) throw err; }
      var f=new VideoFrame(canvas,{timestamp:Math.round(i*1e6/fps),duration:Math.round(1e6/fps)});
      enc.encode(f,{keyFrame:i%every===0}); f.close();
    },
    /* audio: optional, as for makeMp4 */
    finish:async function(audio){
      await enc.flush(); enc.close(); if(err) throw err;
      if(!avcC||!samples.length) throw new Error('the encoder produced no video');
      if(!ordered) throw new Error('this browser reorders frames, which is not supported');
      return new Blob([makeMp4(samples,avcC,W,H,fps,audio)],{type:'video/mp4'});
    }
  };
}
function createGifSink(W,H,fps){
  var gw=new GifWriter(W,H,fps);
  return { add:async function(i,canvasOrData){ gw.addFrame(canvasOrData); }, finish:async function(){ return new Blob([gw.finish()],{type:'image/gif'}); } };
}

/* ---------------- video / GIF source ---------------- */
function waitEvent(el,ok,bad){
  return new Promise(function(res,rej){
    function cl(){ el.removeEventListener(ok,done); el.removeEventListener(bad,fail); }
    function done(){ cl(); res(); } function fail(){ cl(); rej(new Error('Could not read that file.')); }
    el.addEventListener(ok,done); el.addEventListener(bad,fail);
  });
}
/* File -> {kind:'video'|'gif', duration, w, h, name, file, ...}. Revoke vid.url when done with a video. */
async function loadVideoSource(f){
  var name=f.name.replace(/\.[^.]+$/,'');
  if(f.type==='image/gif' || /\.gif$/i.test(f.name)){
    if(typeof ImageDecoder==='undefined') throw new Error('GIF input needs a recent Chrome, Edge or Brave. Alternatively convert the GIF to MP4 first.');
    var dec=new ImageDecoder({data:await f.arrayBuffer(),type:'image/gif'});
    await dec.tracks.ready; await dec.completed;
    var cnt=Math.min(dec.tracks.selectedTrack.frameCount,400), bmps=[], starts=[], total=0;
    for(var i=0;i<cnt;i++){
      var r=await dec.decode({frameIndex:i}), dur=(r.image.duration||100000)/1e6; if(dur<0.02) dur=0.1;
      starts.push(total); total+=dur; bmps.push(await createImageBitmap(r.image)); r.image.close();
    }
    dec.close();
    return {kind:'gif',bmps:bmps,starts:starts,duration:total,w:bmps[0].width,h:bmps[0].height,name:name,file:f};
  }
  var v=document.createElement('video'), url=URL.createObjectURL(f);
  v.muted=true; v.playsInline=true; v.preload='auto'; v.src=url;
  await waitEvent(v,'loadeddata','error');
  return {kind:'video',el:v,url:url,duration:isFinite(v.duration)?v.duration:10,w:v.videoWidth,h:v.videoHeight,name:name,file:f};
}
/* Draws the source at time t (seconds) scaled into g (a 2d context) as w x h.
   crop (optional): {x,y,w,h} in source pixels, draws only that part. */
async function drawVideoFrame(vid,t,g,w,h,crop){
  var src;
  if(vid.kind==='gif'){
    var idx=0; for(var i=0;i<vid.starts.length;i++){ if(vid.starts[i]<=t) idx=i; else break; }
    src=vid.bmps[idx];
  } else {
    var tt=Math.min(Math.max(0,t),Math.max(0,vid.duration-0.05));
    if(Math.abs(vid.el.currentTime-tt)>0.001){ var p=waitEvent(vid.el,'seeked','error'); vid.el.currentTime=tt; await p; }
    src=vid.el;
  }
  if(crop) g.drawImage(src,crop.x,crop.y,crop.w,crop.h,0,0,w,h); else g.drawImage(src,0,0,w,h);
}

/* ---------------- reading MP4 / MOV (frame rate + AAC audio copy) ---------------- */
function mp4Kids(u8,s,e){
  var out=[], p=s, dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  while(p+8<=e){
    var sz=dv.getUint32(p), type=String.fromCharCode(u8[p+4],u8[p+5],u8[p+6],u8[p+7]), hdr=8;
    if(sz===1){ sz=Number(dv.getBigUint64(p+8)); hdr=16; } else if(sz===0) sz=e-p;
    if(sz<hdr||p+sz>e) break;
    out.push({type:type,start:p+hdr,end:p+sz,boxStart:p}); p+=sz;
  }
  return out;
}
function mp4Find(kids,type){ for(var i=0;i<kids.length;i++) if(kids[i].type===type) return kids[i]; return null; }
/* Parses a track's sample tables: {ts, dur, sizes, durs, offsets, n} */
function mp4Tables(m,stbl){
  var dv=new DataView(m.buffer,m.byteOffset,m.byteLength), k=mp4Kids(m,stbl.start,stbl.end), i,j;
  var stsz=mp4Find(k,'stsz'), stts=mp4Find(k,'stts'), stsc=mp4Find(k,'stsc'), stco=mp4Find(k,'stco')||mp4Find(k,'co64');
  if(!stsz||!stts||!stsc||!stco) return null;
  var n=dv.getUint32(stsz.start+8), fixed=dv.getUint32(stsz.start+4), sizes=new Uint32Array(n);
  for(i=0;i<n;i++) sizes[i]=fixed||dv.getUint32(stsz.start+12+4*i);
  var durs=new Uint32Array(n), c=dv.getUint32(stts.start+4), p=stts.start+8, idx=0;
  for(i=0;i<c;i++){ var cnt=dv.getUint32(p), d=dv.getUint32(p+4); p+=8; for(j=0;j<cnt&&idx<n;j++) durs[idx++]=d; }
  var sc=dv.getUint32(stsc.start+4), firsts=[], spcs=[]; p=stsc.start+8;
  for(i=0;i<sc;i++){ firsts.push(dv.getUint32(p)); spcs.push(dv.getUint32(p+4)); p+=12; }
  var nch=dv.getUint32(stco.start+4), is64=stco.type==='co64', offsets=new Float64Array(n), si=0;
  for(i=0;i<nch;i++){
    var off=is64?Number(dv.getBigUint64(stco.start+8+8*i)):dv.getUint32(stco.start+8+4*i), spc=spcs[0];
    for(j=0;j<sc;j++) if(i+1>=firsts[j]) spc=spcs[j];
    for(j=0;j<spc&&si<n;j++){ offsets[si]=off; off+=sizes[si]; si++; }
  }
  return {n:n,sizes:sizes,durs:durs,offsets:offsets};
}
/* file: a File. Returns null when it isn't an MP4/MOV, else
   {fps, audio:null | {tables, timescale, channels, sampleRate, esds}, audioNote} */
async function probeMp4(file){
  async function rd(a,b){ return new Uint8Array(await file.slice(a,b).arrayBuffer()); }
  var size=file.size, p=0, moov=null, first=true;
  while(p+8<=size){
    var h=await rd(p,Math.min(p+16,size)), dv=new DataView(h.buffer), sz=dv.getUint32(0), hdr=8, type=String.fromCharCode(h[4],h[5],h[6],h[7]);
    if(first && type!=='ftyp' && type!=='moov' && type!=='free' && type!=='wide') return null;
    first=false;
    if(sz===1){ sz=Number(dv.getBigUint64(8)); hdr=16; } else if(sz===0) sz=size-p;
    if(sz<hdr) return null;
    if(type==='moov'){ if(sz-hdr>256e6) return null; moov=await rd(p+hdr,p+sz); break; }
    p+=sz;
  }
  if(!moov) return null;
  var mdv=new DataView(moov.buffer), res={fps:null,audio:null,audioNote:'no audio track'}, traks=mp4Kids(moov,0,moov.length);
  for(var ti=0;ti<traks.length;ti++){
    if(traks[ti].type!=='trak') continue;
    var mdia=mp4Find(mp4Kids(moov,traks[ti].start,traks[ti].end),'mdia'); if(!mdia) continue;
    var mk=mp4Kids(moov,mdia.start,mdia.end), hdlr=mp4Find(mk,'hdlr'), mdhd=mp4Find(mk,'mdhd'), minf=mp4Find(mk,'minf'); if(!hdlr||!mdhd||!minf) continue;
    var handler=String.fromCharCode(moov[hdlr.start+8],moov[hdlr.start+9],moov[hdlr.start+10],moov[hdlr.start+11]);
    var ver=moov[mdhd.start], ts=mdv.getUint32(mdhd.start+(ver===1?20:12));
    var stbl=mp4Find(mp4Kids(moov,minf.start,minf.end),'stbl'); if(!stbl) continue;
    if(handler==='vide' && res.fps==null){
      var tb=mp4Tables(moov,stbl); if(tb&&tb.n>1){ var tot=0; for(var i=0;i<tb.n;i++) tot+=tb.durs[i]; if(tot>0) res.fps=tb.n*ts/tot; }
    } else if(handler==='soun' && !res.audio){
      var sk=mp4Kids(moov,stbl.start,stbl.end), stsd=mp4Find(sk,'stsd'); if(!stsd) continue;
      var ent=mp4Kids(moov,stsd.start+8,stsd.end)[0]; if(!ent) continue;
      if(ent.type!=='mp4a'){ res.audioNote='the audio is '+ent.type.trim()+', not AAC'; continue; }
      var sver=mdv.getUint16(ent.start+8), kidsAt=ent.start+28+(sver===1?16:0);
      if(sver>1){ res.audioNote='unsupported audio format'; continue; }
      var esds=mp4Find(mp4Kids(moov,kidsAt,ent.end),'esds'); if(!esds){ res.audioNote='the audio has no codec info'; continue; }
      var tbl=mp4Tables(moov,stbl); if(!tbl||!tbl.n){ res.audioNote='the audio track is empty'; continue; }
      res.audio={tables:tbl,timescale:ts,channels:mdv.getUint16(ent.start+16),sampleRate:mdv.getUint16(ent.start+24),
                 esds:moov.slice(esds.boxStart,esds.end)};
      res.audioNote='';
    }
  }
  return res;
}
/* Copies the audio samples that fall in [t0, t0+len) seconds. Returns an object for makeMp4's `audio`, or null. */
async function readMp4Audio(file,info,t0,len){
  if(!info||!info.audio) return null;
  var a=info.audio, tb=a.tables, ts=a.timescale, start=t0*ts, end=(t0+len)*ts, t=0, sel=[], i;
  for(i=0;i<tb.n;i++){ if(t+tb.durs[i]>start && t<end) sel.push(i); t+=tb.durs[i]; if(t>=end) break; }
  if(!sel.length) return null;
  var samples=[], durs=[], runStart=0;
  while(runStart<sel.length){
    var runEnd=runStart, off0=tb.offsets[sel[runStart]], bytes=tb.sizes[sel[runStart]];
    while(runEnd+1<sel.length && tb.offsets[sel[runEnd+1]]===off0+bytes && bytes<8e6){ runEnd++; bytes+=tb.sizes[sel[runEnd]]; }
    var buf=new Uint8Array(await file.slice(off0,off0+bytes).arrayBuffer()), q=0;
    for(i=runStart;i<=runEnd;i++){ var s=tb.sizes[sel[i]]; samples.push(buf.slice(q,q+s)); durs.push(tb.durs[sel[i]]); q+=s; }
    runStart=runEnd+1;
  }
  return {timescale:ts,channels:a.channels,sampleRate:a.sampleRate,esds:a.esds,samples:samples,durs:durs};
}

if (typeof module !== 'undefined') { module.exports = { makeMp4, GifWriter, probeMp4, readMp4Audio }; }
