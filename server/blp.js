'use strict';
const zlib=require('node:zlib');
const crcTable=Array.from({length:256},(_,i)=>{for(let k=0;k<8;k++)i=(i>>>1)^((i&1)?0xedb88320:0);return i>>>0;});
function crc32(b){let c=0xffffffff;for(const v of b)c=(c>>>8)^crcTable[(c^v)&255];return (c^0xffffffff)>>>0;}
function chunk(name,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;}
function png(width,height,pixels){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;const raw=Buffer.alloc(height*(width*4+1));for(let y=0;y<height;y++)pixels.copy(raw,y*(width*4+1)+1,y*width*4,(y+1)*width*4);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const rgb565=n=>[Math.round((n>>11)*255/31),Math.round(((n>>5)&63)*255/63),Math.round((n&31)*255/31),255];
function decodeBLP(b,maxSize=1024){
  if(b.toString('ascii',0,4)!=='BLP2'||b.readUInt32LE(4)!==1)throw new Error('Unsupported texture format (expected BLP2)');
  const encoding=b[8],alphaDepth=b[9],alphaEncoding=b[10];let width=b.readUInt32LE(12),height=b.readUInt32LE(16),mip=0;
  while(Math.max(width,height)>maxSize&&mip<15&&b.readUInt32LE(20+(mip+1)*4)){width=Math.max(1,width>>1);height=Math.max(1,height>>1);mip++;}
  if(!width||!height||width*height>16777216)throw new Error('Invalid BLP dimensions');
  let p=b.readUInt32LE(20+mip*4);const pixels=Buffer.alloc(width*height*4);
  if(encoding===1){const alphaStart=p+width*height;for(let i=0;i<width*height;i++){const c=148+b[p+i]*4;pixels[i*4]=b[c+2];pixels[i*4+1]=b[c+1];pixels[i*4+2]=b[c];pixels[i*4+3]=alphaDepth===8?b[alphaStart+i]:alphaDepth===4?((b[alphaStart+(i>>1)]>>((i%2)*4))&15)*17:alphaDepth===1?((b[alphaStart+(i>>3)]>>(i%8))&1)*255:255;}}
  else if(encoding===3){for(let i=0;i<width*height;i++){pixels[i*4]=b[p+i*4+2];pixels[i*4+1]=b[p+i*4+1];pixels[i*4+2]=b[p+i*4];pixels[i*4+3]=b[p+i*4+3];}}
  else if(encoding===2){const dxt=alphaDepth===0||alphaEncoding===0?1:alphaEncoding===1?3:5;for(let by=0;by<height;by+=4)for(let bx=0;bx<width;bx+=4){let alphas=Array(16).fill(255);if(dxt===3){for(let k=0;k<16;k++)alphas[k]=((b[p+(k>>1)]>>((k%2)*4))&15)*17;p+=8;}if(dxt===5){const a0=b[p],a1=b[p+1],table=[a0,a1];if(a0>a1){for(let j=1;j<=6;j++)table.push(((7-j)*a0+j*a1)/7);}else{for(let j=1;j<=4;j++)table.push(((5-j)*a0+j*a1)/5);table.push(0,255);}const packed=b.readUIntLE(p+2,6);for(let k=0;k<16;k++)alphas[k]=table[Math.floor(packed/2**(k*3))%8];p+=8;}const c0=b.readUInt16LE(p),c1=b.readUInt16LE(p+2),cs=[rgb565(c0),rgb565(c1)];if(c0>c1||dxt!==1){cs.push(cs[0].map((v,j)=>(2*v+cs[1][j])/3),cs[0].map((v,j)=>(v+2*cs[1][j])/3));}else{cs.push(cs[0].map((v,j)=>(v+cs[1][j])/2),[0,0,0,0]);}let indices=b.readUInt32LE(p+4);p+=8;for(let k=0;k<16;k++){const x=bx+k%4,y=by+(k>>2),c=cs[(indices>>>(k*2))&3];if(x>=width||y>=height)continue;const at=(y*width+x)*4;for(let j=0;j<3;j++)pixels[at+j]=Math.round(c[j]);pixels[at+3]=c[3]===0?0:Math.round(alphas[k]);}}}
  else throw new Error(`Unsupported BLP encoding ${encoding}`);
  return {width,height,pixels};
}
module.exports={decodeBLP,png,crc32};
