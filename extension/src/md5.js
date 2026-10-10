// RFC 1321 MD5, used only for the signature required by Baidu Translate.
export function md5(text) {
  const bytes = new TextEncoder().encode(text);
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(length);
  data.set(bytes); data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(length-8, bytes.length*8, true);
  view.setUint32(length-4, Math.floor(bytes.length / 0x20000000), true);
  const shifts=[7,12,17,22,5,9,14,20,4,11,16,23,6,10,15,21];
  let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;
  for(let offset=0;offset<length;offset+=64) {
    let a=a0,b=b0,c=c0,d=d0;
    for(let i=0;i<64;i++) {
      let f,g;
      if(i<16){f=(b&c)|(~b&d);g=i;}
      else if(i<32){f=(d&b)|(~d&c);g=(5*i+1)%16;}
      else if(i<48){f=b^c^d;g=(3*i+5)%16;}
      else{f=c^(b|~d);g=(7*i)%16;}
      const n=(a+f+Math.floor(Math.abs(Math.sin(i+1))*0x100000000)+view.getUint32(offset+g*4,true))|0;
      const s=shifts[Math.floor(i/16)*4+i%4];
      a=d;d=c;c=b;b=(b+((n<<s)|(n>>>(32-s))))|0;
    }
    a0=(a0+a)|0;b0=(b0+b)|0;c0=(c0+c)|0;d0=(d0+d)|0;
  }
  const out=new DataView(new ArrayBuffer(16));
  [a0,b0,c0,d0].forEach((n,i)=>out.setUint32(i*4,n,true));
  return [...new Uint8Array(out.buffer)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
