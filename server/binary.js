'use strict';
// Small bounds-checked cursor for the client's little-endian binary formats.
class Reader {
  constructor(buffer, offset=0) { this.b=buffer; this.p=offset; }
  seek(p) { if(!Number.isInteger(p)||p<0||p>this.b.length) throw new Error(`Invalid file offset ${p} (size ${this.b.length})`); this.p=p; return this; }
  skip(n) { return this.seek(this.p+n); }
  u8() { return this.b.readUInt8(this.p++); }
  i8() { return this.b.readInt8(this.p++); }
  u16() { const v=this.b.readUInt16LE(this.p);this.p+=2;return v; }
  i16() { const v=this.b.readInt16LE(this.p);this.p+=2;return v; }
  u32() { const v=this.b.readUInt32LE(this.p);this.p+=4;return v; }
  i32() { const v=this.b.readInt32LE(this.p);this.p+=4;return v; }
  f32() { const v=this.b.readFloatLE(this.p);this.p+=4;return v; }
  vec(n=3) { return Array.from({length:n},()=>this.f32()); }
  pair() { return [this.u32(),this.u32()]; }
  text(n) { const s=this.b.toString('utf8',this.p,this.p+n).replace(/\0.*$/s,'');this.skip(n);return s; }
}
function chunks(b,start=0,end=b.length,reverse=false) {
  const out=new Map();
  for(let p=start;p+8<=end;){let tag=b.toString('ascii',p,p+4);if(reverse)tag=[...tag].reverse().join('');const n=b.readUInt32LE(p+4);if(p+8+n>end)throw new Error(`Truncated ${tag} chunk`);if(!out.has(tag))out.set(tag,b.subarray(p+8,p+8+n));p+=8+n;}
  return out;
}
const xyz = a => [a[0],a[2],-a[1]];
module.exports={Reader,chunks,xyz};
