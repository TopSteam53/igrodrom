// Пейзажи для «Коллажа»: рисуются кодом на canvas любого размера и пропорций. Одинаковый seed — одинаковая картина.
// window.COLLAGE_SCENES = { list: [{kind, name}], draw(ctx, w, h, kind, seed) }
(function(){
'use strict';
function rng(seed){return function(){seed=seed+0x6D2B79F5|0;var t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
function hex(c){var n=parseInt(c.slice(1),16);return [n>>16,n>>8&255,n&255]}
function mix(a,b,t){var x=hex(a),y=hex(b);return 'rgb('+Math.round(x[0]+(y[0]-x[0])*t)+','+Math.round(x[1]+(y[1]-x[1])*t)+','+Math.round(x[2]+(y[2]-x[2])*t)+')'}
function vgrad(g,y0,y1,stops){var gr=g.createLinearGradient(0,y0,0,y1);stops.forEach(function(s,i){gr.addColorStop(s[1]!=null?s[1]:i/(stops.length-1),s[0]||s)});return gr}
function sky(g,w,h,stops){g.fillStyle=vgrad(g,0,h,stops.map(function(c,i){return [c,i/(stops.length-1)]}));g.fillRect(0,0,w,h)}
// Линия хребта: смещение середины, сглаженная.
function ridge(r,n,rough){
  var p=[0,0];
  for(var lv=0,amp=1;lv<6;lv++,amp*=rough){
    var q=[];for(var i=0;i<p.length-1;i++){q.push(p[i]);q.push((p[i]+p[i+1])/2+(r()-.5)*amp)}q.push(p[p.length-1]);p=q;
  }
  return p;
}
function fillRidge(g,w,h,base,height,pts,color){
  g.fillStyle=color;g.beginPath();g.moveTo(0,h);
  for(var i=0;i<pts.length;i++)g.lineTo(i/(pts.length-1)*w,base-height*(.5+pts[i]));
  g.lineTo(w,h);g.closePath();g.fill();
}
function hill(g,w,h,base,amp,phase,freq,color){
  g.fillStyle=color;g.beginPath();g.moveTo(0,h);
  for(var x=0;x<=w;x+=w/60)g.lineTo(x,base-amp*Math.sin(x/w*Math.PI*freq+phase));
  g.lineTo(w,h);g.closePath();g.fill();
}
function sun(g,x,y,r,core,glow){
  var gr=g.createRadialGradient(x,y,r*.6,x,y,r*3.2);gr.addColorStop(0,glow);gr.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=gr;g.beginPath();g.arc(x,y,r*3.2,0,7);g.fill();
  g.fillStyle=core;g.beginPath();g.arc(x,y,r,0,7);g.fill();
}
function stars(g,r,w,h,n,maxY){for(var i=0;i<n;i++){var s=r()*1.6+.4;g.globalAlpha=.4+r()*.6;g.fillStyle='#fff';g.beginPath();g.arc(r()*w,r()*maxY,s*Math.max(1,w/500),0,7);g.fill()}g.globalAlpha=1}
function cloud(g,x,y,s,color){g.fillStyle=color;[[0,0,1],[.9,-.35,.8],[1.7,0,.85],[-.8,.1,.65],[.8,.25,.9]].forEach(function(c){g.beginPath();g.arc(x+c[0]*s,y+c[1]*s,c[2]*s,0,7);g.fill()})}
function pine(g,x,y,hgt,color,snow){
  var wd=hgt*.42;g.fillStyle=color;
  for(var k=0;k<3;k++){var ty=y-hgt+k*hgt*.24,by=y-hgt*.18+k*hgt*.06-(2-k)*hgt*.18;
    g.beginPath();g.moveTo(x,ty);g.lineTo(x+wd*(.55+k*.22),by+hgt*.2);g.lineTo(x-wd*(.55+k*.22),by+hgt*.2);g.closePath();g.fill();
    if(snow){g.fillStyle=snow;g.beginPath();g.moveTo(x,ty);g.lineTo(x+wd*.22,ty+hgt*.12);g.lineTo(x-wd*.22,ty+hgt*.12);g.closePath();g.fill();g.fillStyle=color}}
  g.fillRect(x-hgt*.035,y-hgt*.12,hgt*.07,hgt*.14);
}
function bird(g,x,y,s,color){g.strokeStyle=color;g.lineWidth=Math.max(1.2,s*.18);g.lineCap='round';g.beginPath();g.moveTo(x-s,y-s*.3);g.quadraticCurveTo(x-s*.4,y-s*.6,x,y);g.quadraticCurveTo(x+s*.4,y-s*.6,x+s,y-s*.3);g.stroke()}
function pick(r,a){return a[Math.floor(r()*a.length)]}

var K={};
K.mountains=function(g,w,h,r){
  var P=pick(r,[
    {sky:['#2b2d6e','#c4588a','#ffb36b'],sun:'#fff1c9',glow:'rgba(255,190,120,.55)',near:'#231a3d',far:'#d1789a'},
    {sky:['#1f5f8b','#7fc8d8','#ffe2b0'],sun:'#fffbe6',glow:'rgba(255,245,200,.5)',near:'#173a4a',far:'#8cc3c9'},
    {sky:['#3b1f4f','#e0607e','#ffc46b'],sun:'#ffe9a8',glow:'rgba(255,200,110,.6)',near:'#2a1530','far':'#e08a86'}]);
  sky(g,w,h,P.sky);
  sun(g,w*(.3+r()*.4),h*(.3+r()*.08),Math.min(w,h)*.09,P.sun,P.glow);
  for(var i=0;i<4;i++){var t=i/3;fillRidge(g,w,h,h*(.46+t*.4),h*(.26-t*.12),ridge(r,0,.45+t*.08),mix(P.far,P.near,.1+t*.9))}
  for(var b=0;b<4;b++)bird(g,w*(.15+r()*.5),h*(.15+r()*.2),Math.min(w,h)*.022,P.near);
};
K.night=function(g,w,h,r){
  var P=pick(r,[{sky:['#070b26','#1b2a6b','#3a4b9a'],hill:['#20306e','#121b45','#0a0f2a']},{sky:['#0b0820','#2c1752','#6a3a7a'],hill:['#3a2560','#22163f','#120c24']}]);
  sky(g,w,h,P.sky);stars(g,r,w,h,Math.round(w*h/1800),h*.6);
  var mx=w*(.6+r()*.25),my=h*.2,mr=Math.min(w,h)*.08;sun(g,mx,my,mr,'#fdf6d8','rgba(200,210,255,.25)');
  g.fillStyle='rgba(180,170,140,.35)';[[-.3,-.2,.22],[.25,.15,.16],[-.05,.35,.12]].forEach(function(c){g.beginPath();g.arc(mx+c[0]*mr,my+c[1]*mr,c[2]*mr,0,7);g.fill()});
  hill(g,w,h,h*.62,h*.06,r()*6,2,P.hill[0]);hill(g,w,h,h*.74,h*.07,r()*6,1.5,P.hill[1]);
  // домики с огнями на ближнем холме
  for(var i=0;i<4;i++){var x=w*(.12+i*.22+r()*.06),y=h*(.73-r()*.03),s=Math.min(w,h)*.07;
    g.fillStyle=P.hill[1];g.fillRect(x,y-s,s*1.2,s);g.beginPath();g.moveTo(x-s*.15,y-s);g.lineTo(x+s*.6,y-s*1.6);g.lineTo(x+s*1.35,y-s);g.fill();
    g.fillStyle='#ffd36b';g.fillRect(x+s*.2,y-s*.7,s*.3,s*.3);if(r()<.6)g.fillRect(x+s*.7,y-s*.7,s*.3,s*.3)}
  hill(g,w,h,h*.9,h*.05,r()*6,1,P.hill[2]);
  for(var p=0;p<6;p++)pine(g,w*(r()),h*(.93+r()*.05),h*(.16+r()*.1),P.hill[2]);
};
K.sea=function(g,w,h,r){
  var P=pick(r,[{sky:['#ff9e6b','#ffd3a1','#fff0d6'],sea:['#2d6fa3','#123a63'],sun:'#fff3c4',isl:'#5a4a6b'},{sky:['#4aa3df','#a8dcf0','#e8f7ff'],sea:['#1f8fb5','#0b4a72'],sun:'#ffffff',isl:'#2f6b5a'}]);
  var hz=h*(.52+r()*.08);
  sky(g,w,hz,P.sky);g.fillStyle=P.sky[2];g.fillRect(0,hz-1,w,1);
  var sx=w*(.3+r()*.4);sun(g,sx,hz-h*.12,Math.min(w,h)*.07,P.sun,'rgba(255,240,200,.45)');
  cloud(g,w*r(),h*.15,Math.min(w,h)*.05,'rgba(255,255,255,.75)');cloud(g,w*r(),h*.28,Math.min(w,h)*.04,'rgba(255,255,255,.6)');
  g.fillStyle=vgrad(g,hz,h,[[P.sea[0],0],[P.sea[1],1]]);g.fillRect(0,hz,w,h-hz);
  g.fillStyle='rgba(255,240,200,.55)';for(var i=0;i<9;i++){var y=hz+(h-hz)*(i+.5)/10,ww=w*.18*(1-i*.06);g.fillRect(sx-ww/2+(r()-.5)*w*.04,y,ww,Math.max(2,h*.006))}
  fillRidge(g,w*.45,hz+1,hz,h*.08,ridge(r,0,.5),P.isl);
  // маяк на скале справа
  var lx=w*.82,ly=hz+h*.06,lh=h*.3,lw=Math.min(w,h)*.05;
  g.fillStyle='#3a3340';g.beginPath();g.ellipse(lx,ly+h*.02,w*.14,h*.06,0,Math.PI,0);g.fill();
  g.fillStyle='#f4f1ea';g.beginPath();g.moveTo(lx-lw,ly);g.lineTo(lx-lw*.6,ly-lh);g.lineTo(lx+lw*.6,ly-lh);g.lineTo(lx+lw,ly);g.fill();
  g.fillStyle='#d6453a';for(var k=0;k<3;k++){var y0=ly-lh*(.2+k*.27);g.fillRect(lx-lw*(.92-k*.1),y0-lh*.08,lw*2*(.92-k*.1),lh*.08)}
  g.fillStyle='#ffe27a';g.fillRect(lx-lw*.45,ly-lh-lw*.8,lw*.9,lw*.8);g.fillStyle='#3a3340';g.fillRect(lx-lw*.7,ly-lh-lw*1.05,lw*1.4,lw*.3);
  // парусник
  var bx=w*(.2+r()*.3),by=hz+(h-hz)*.45,bs=Math.min(w,h)*.09;
  g.fillStyle='#7a3b2e';g.beginPath();g.moveTo(bx-bs,by);g.lineTo(bx+bs,by);g.lineTo(bx+bs*.7,by+bs*.3);g.lineTo(bx-bs*.7,by+bs*.3);g.fill();
  g.fillStyle='#fffaf0';g.beginPath();g.moveTo(bx,by-bs*1.6);g.lineTo(bx,by-bs*.1);g.lineTo(bx+bs*.8,by-bs*.1);g.fill();
  g.fillStyle='#ffe0c2';g.beginPath();g.moveTo(bx-.05*bs,by-bs*1.3);g.lineTo(bx-.05*bs,by-bs*.1);g.lineTo(bx-bs*.7,by-bs*.1);g.fill();
};
K.forest=function(g,w,h,r){
  var P=pick(r,[{sky:['#cfe8d6','#f3f0d0'],t:['#a9cbb4','#6d9e88','#3f6f5d','#1f4237']},{sky:['#f6d6b8','#fdf0d8'],t:['#e0b49a','#b37c6b','#6e4a4f','#35242f']}]);
  sky(g,w,h,P.sky);
  sun(g,w*(.25+r()*.5),h*.25,Math.min(w,h)*.08,'#fffdf0','rgba(255,255,230,.5)');
  // лучи
  g.fillStyle='rgba(255,255,240,.12)';for(var i=0;i<4;i++){var x=w*(.1+i*.25);g.beginPath();g.moveTo(x,0);g.lineTo(x+w*.1,0);g.lineTo(x+w*.35,h);g.lineTo(x+w*.15,h);g.fill()}
  for(var l=0;l<4;l++){
    var base=h*(.55+l*.15),col=P.t[l],n=6+l*2;
    g.fillStyle=col;g.fillRect(0,base,w,h-base);
    for(var k=0;k<n;k++)pine(g,(k+r()*.8)/n*w*1.08-w*.04,base+h*.02,h*(.22+l*.07)*(.8+r()*.4),col);
  }
};
K.desert=function(g,w,h,r){
  var P=pick(r,[{sky:['#ff7e5f','#feb47b','#ffe3a3'],d:['#e9a46a','#d98552','#b86640','#8a4a32']},{sky:['#6b4c9a','#e07a8a','#ffd29a'],d:['#d9967a','#c27460','#9a5652','#5e3a45']}]);
  sky(g,w,h,P.sky);
  sun(g,w*(.35+r()*.3),h*.42,Math.min(w,h)*.16,'#fff2c0','rgba(255,220,150,.4)');
  for(var b=0;b<3;b++)bird(g,w*(.1+r()*.7),h*(.1+r()*.2),Math.min(w,h)*.02,P.d[3]);
  for(var i=0;i<4;i++)hill(g,w,h,h*(.6+i*.11),h*(.06+i*.01),r()*6,1+r()*1.5,P.d[i]);
  // кактусы
  for(var c=0;c<2;c++){var x=w*(.15+c*.6+r()*.15),y=h*(.92-c*.05),s=h*(.22-c*.06);g.fillStyle='#3e5a3a';
    g.fillRect(x-s*.07,y-s,s*.14,s);g.fillRect(x-s*.3,y-s*.6,s*.1,s*.3);g.fillRect(x-s*.3,y-s*.4,s*.25,s*.08);g.fillRect(x+s*.2,y-s*.75,s*.1,s*.35);g.fillRect(x+s*.05,y-s*.48,s*.25,s*.08);
    g.beginPath();g.arc(x,y-s,s*.07,0,7);g.fill()}
};
K.winter=function(g,w,h,r){
  var P=pick(r,[{sky:['#9fc6e8','#dfe9f5','#fbe7e2']},{sky:['#1d2b5a','#5b5f9e','#d8a7b8']}]);
  sky(g,w,h,P.sky);
  hill(g,w,h,h*.58,h*.05,r()*6,2,'#c8d6ea');hill(g,w,h,h*.7,h*.06,r()*6,1.3,'#e2eaf5');
  // избушка с дымом
  var cx=w*(.55+r()*.2),cy=h*.72,s=Math.min(w,h)*.12;
  g.fillStyle='#7a4a33';g.fillRect(cx,cy-s,s*1.4,s);g.fillStyle='#ffffff';g.beginPath();g.moveTo(cx-s*.2,cy-s);g.lineTo(cx+s*.7,cy-s*1.6);g.lineTo(cx+s*1.6,cy-s);g.fill();
  g.fillStyle='#ffd36b';g.fillRect(cx+s*.25,cy-s*.65,s*.35,s*.3);g.fillStyle='#5a3424';g.fillRect(cx+s*.85,cy-s*.6,s*.3,s*.6);
  g.fillStyle='rgba(255,255,255,.7)';for(var k=0;k<4;k++){g.beginPath();g.arc(cx+s*1.1+k*s*.2,cy-s*1.6-k*s*.3,s*(.12+k*.05),0,7);g.fill()}
  hill(g,w,h,h*.86,h*.04,r()*6,1,'#ffffff');
  for(var p=0;p<7;p++)pine(g,w*r(),h*(.82+r()*.14),h*(.18+r()*.12),'#2f5d50','#ffffff');
  g.fillStyle='rgba(255,255,255,.85)';for(var f=0;f<Math.round(w*h/2500);f++){g.beginPath();g.arc(r()*w,r()*h,Math.max(1,Math.min(w,h)*.006*(.5+r())),0,7);g.fill()}
};
K.underwater=function(g,w,h,r){
  sky(g,w,h,['#3fc1c9','#1a7f9e','#0b3a5c']);
  g.fillStyle='rgba(255,255,255,.08)';for(var i=0;i<5;i++){var x=w*(i*.22+r()*.1);g.beginPath();g.moveTo(x,0);g.lineTo(x+w*.08,0);g.lineTo(x+w*.25,h);g.lineTo(x+w*.12,h);g.fill()}
  hill(g,w,h,h*.9,h*.04,r()*6,1.5,'#d9c48f');
  // водоросли
  for(var s=0;s<7;s++){var x0=w*r(),hh=h*(.25+r()*.25);g.strokeStyle=pick(r,['#2e8b57','#3fa86b','#1f6e4a']);g.lineWidth=Math.max(3,w*.012);g.lineCap='round';g.beginPath();g.moveTo(x0,h*.92);
    for(var t=0;t<=1;t+=.1)g.lineTo(x0+Math.sin(t*7+s)*w*.025,h*.92-hh*t);g.stroke()}
  // кораллы
  for(var c=0;c<3;c++){var cx=w*(.15+c*.33+r()*.1),cy=h*.9,cs=Math.min(w,h)*.08;g.fillStyle=pick(r,['#ff6b6b','#ff9f43','#f368e0']);
    [[0,0,1],[-.8,-.6,.6],[.7,-.7,.65],[0,-1.2,.55]].forEach(function(q){g.beginPath();g.arc(cx+q[0]*cs,cy+q[1]*cs,q[2]*cs,0,7);g.fill()})}
  // рыбы
  for(var f=0;f<6;f++){var fx=w*(.1+r()*.8),fy=h*(.15+r()*.55),fs=Math.min(w,h)*(.04+r()*.03),dir=r()<.5?1:-1,col=pick(r,['#ffd166','#ff8c42','#f15bb5','#9bf6ff','#ffffff']);
    g.fillStyle=col;g.beginPath();g.ellipse(fx,fy,fs,fs*.55,0,0,7);g.fill();g.beginPath();g.moveTo(fx-dir*fs*.8,fy);g.lineTo(fx-dir*fs*1.6,fy-fs*.5);g.lineTo(fx-dir*fs*1.6,fy+fs*.5);g.fill();
    g.fillStyle='#0b2a3c';g.beginPath();g.arc(fx+dir*fs*.5,fy-fs*.1,fs*.12,0,7);g.fill()}
  g.strokeStyle='rgba(255,255,255,.6)';g.lineWidth=1.5;for(var b=0;b<12;b++){g.beginPath();g.arc(w*r(),h*r()*.8,Math.min(w,h)*(.006+r()*.012),0,7);g.stroke()}
};
K.space=function(g,w,h,r){
  sky(g,w,h,['#05060f','#120f2e','#1d1240']);
  ['rgba(240,80,160,.35)','rgba(80,140,255,.35)','rgba(120,255,200,.2)'].forEach(function(c){var x=w*r(),y=h*r(),rr=Math.max(w,h)*(.3+r()*.2);var gr=g.createRadialGradient(x,y,0,x,y,rr);gr.addColorStop(0,c);gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,w,h)});
  stars(g,r,w,h,Math.round(w*h/900),h);
  var px=w*(.3+r()*.4),py=h*(.4+r()*.2),pr=Math.min(w,h)*.22,pc=pick(r,[['#ffcf8a','#d9774a'],['#9ad0ff','#3a5fbf'],['#d6a6ff','#7a3fbf']]);
  var gr=g.createRadialGradient(px-pr*.4,py-pr*.4,pr*.1,px,py,pr);gr.addColorStop(0,pc[0]);gr.addColorStop(1,pc[1]);
  g.save();g.translate(px,py);g.rotate(-.35);g.strokeStyle='rgba(255,240,220,.75)';g.lineWidth=pr*.09;g.beginPath();g.ellipse(0,0,pr*1.7,pr*.45,0,Math.PI,0);g.stroke();g.restore();
  g.fillStyle=gr;g.beginPath();g.arc(px,py,pr,0,7);g.fill();
  g.fillStyle='rgba(255,255,255,.12)';for(var b=0;b<3;b++){g.beginPath();g.ellipse(px,py-pr*.5+b*pr*.4,pr*.95,pr*.08,0,0,7);g.fill()}
  g.save();g.translate(px,py);g.rotate(-.35);g.strokeStyle='rgba(255,240,220,.75)';g.lineWidth=pr*.09;g.beginPath();g.ellipse(0,0,pr*1.7,pr*.45,0,0,Math.PI);g.stroke();g.restore();
  var mx=w*r(),my=h*r()*.4;g.fillStyle='#cfd3e6';g.beginPath();g.arc(mx,my,pr*.18,0,7);g.fill();g.fillStyle='rgba(0,0,0,.2)';g.beginPath();g.arc(mx+pr*.05,my+pr*.04,pr*.15,0,7);g.fill();
};
K.meadow=function(g,w,h,r){
  sky(g,w,h,['#6ec6ff','#bfe9ff','#f2fbff']);
  sun(g,w*(.1+r()*.2),h*.15,Math.min(w,h)*.07,'#fff7c2','rgba(255,250,200,.5)');
  for(var c=0;c<3;c++)cloud(g,w*(.25+c*.3+r()*.1),h*(.12+r()*.15),Math.min(w,h)*(.04+r()*.03),'#ffffff');
  hill(g,w,h,h*.6,h*.06,r()*6,1.8,'#8fd17a');hill(g,w,h,h*.72,h*.07,r()*6,1.2,'#5fb85a');
  // мельница
  var mx=w*(.6+r()*.25),my=h*.62,ms=Math.min(w,h)*.12;
  g.fillStyle='#f4ead8';g.beginPath();g.moveTo(mx-ms*.45,my+ms*.2);g.lineTo(mx-ms*.25,my-ms*1.2);g.lineTo(mx+ms*.25,my-ms*1.2);g.lineTo(mx+ms*.45,my+ms*.2);g.fill();
  g.fillStyle='#c0503e';g.beginPath();g.moveTo(mx-ms*.35,my-ms*1.2);g.lineTo(mx,my-ms*1.55);g.lineTo(mx+ms*.35,my-ms*1.2);g.fill();
  g.strokeStyle='#7a5a44';g.lineWidth=ms*.08;var a0=r()*3;for(var k=0;k<4;k++){var a=a0+k*Math.PI/2;g.beginPath();g.moveTo(mx,my-ms*1.25);g.lineTo(mx+Math.cos(a)*ms*1.1,my-ms*1.25+Math.sin(a)*ms*1.1);g.stroke()}
  hill(g,w,h,h*.88,h*.05,r()*6,1,'#3f9a4a');
  for(var f=0;f<Math.round(w*h/1400);f++){var y=h*(.76+r()*.24);g.fillStyle=pick(r,['#ff5d8f','#ffd23f','#ffffff','#b388ff','#ff8c42']);g.beginPath();g.arc(r()*w,y,Math.max(1.5,Math.min(w,h)*.008),0,7);g.fill()}
};
K.city=function(g,w,h,r){
  var P=pick(r,[{sky:['#1b1f4b','#6a3d7a','#ff8e72'],b:['#4a3a6e','#2f2550','#191430']},{sky:['#0f2a4a','#2f6f9a','#f2c98a'],b:['#2f4f6e','#1f3550','#0f1b2e']}]);
  sky(g,w,h,P.sky);stars(g,r,w,h,Math.round(w*h/4000),h*.35);
  sun(g,w*(.7+r()*.2),h*.2,Math.min(w,h)*.05,'#fff4d6','rgba(255,240,210,.3)');
  for(var l=0;l<3;l++){
    var x=-r()*w*.05,base=h*(.7+l*.12);
    while(x<w){var bw=w*(.06+r()*.08),bh=h*(.2+r()*.3)*(1-l*.15);g.fillStyle=P.b[l];g.fillRect(x,base-bh,bw,h-base+bh);
      if(l>0){g.fillStyle='rgba(255,215,120,'+(.5+l*.2)+')';var cw=bw/5,ch=h*.025;for(var yy=base-bh+ch;yy<base-ch;yy+=ch*2)for(var xx=x+cw*.6;xx<x+bw-cw*.6;xx+=cw*1.6)if(r()<.45)g.fillRect(xx,yy,cw*.7,ch)}
      x+=bw+w*.005}
  }
  g.fillStyle=P.b[2];g.fillRect(0,h*.95,w,h*.05);
};

var NAMES={mountains:'Горы на закате',night:'Ночная деревня',sea:'Маяк у моря',forest:'Лес в тумане',desert:'Пустыня',winter:'Зимняя избушка',underwater:'Под водой',space:'Планета с кольцами',meadow:'Мельница на лугу',city:'Вечерний город'};
window.COLLAGE_SCENES={
  list:Object.keys(K).map(function(k){return {kind:k,name:NAMES[k]}}),
  draw:function(g,w,h,kind,seed){g.save();K[kind](g,w,h,rng(seed|0));g.restore()}
};
})();
