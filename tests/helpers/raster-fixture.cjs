// Minimal filter-0 RGBA PNG codec for test fixtures. Production uses Electron nativeImage.
const zlib=require('node:zlib');
function crc32(b){let c=0xffffffff;for(const v of b){c^=v;for(let n=0;n<8;n++)c=c&1?(c>>>1)^0xedb88320:c>>>1}return(c^0xffffffff)>>>0}
function chunk(type,data){const t=Buffer.from(type),length=Buffer.alloc(4),crc=Buffer.alloc(4);length.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([t,data])));return Buffer.concat([length,t,data,crc])}
const codec={
 encode(r){const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(r.width,0);ihdr.writeUInt32BE(r.height,4);ihdr[8]=8;ihdr[9]=6;const lines=[];for(let y=0;y<r.height;y++)lines.push(Buffer.from([0]),r.data.subarray(y*r.width*4,(y+1)*r.width*4));return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.concat(lines))),chunk('IEND',Buffer.alloc(0))])},
 decode(b){const width=b.readUInt32BE(16),height=b.readUInt32BE(20),idat=[];for(let off=8;off<b.length;){const len=b.readUInt32BE(off),type=b.toString('ascii',off+4,off+8);if(type==='IDAT')idat.push(b.subarray(off+8,off+8+len));off+=len+12}const raw=zlib.inflateSync(Buffer.concat(idat)),data=Buffer.alloc(width*height*4);for(let y=0;y<height;y++){if(raw[y*(width*4+1)]!==0)throw Error('Only test filter 0 is supported');raw.copy(data,y*width*4,y*(width*4+1)+1,(y+1)*(width*4+1))}return{width,height,data}}
};
function solid(width,height,color){const data=Buffer.alloc(width*height*4);for(let i=0;i<data.length;i+=4){data[i]=color;data[i+1]=45;data[i+2]=68;data[i+3]=255}return codec.encode({width,height,data})}
const headGeometry={box:[100,100,800,800],outline:[[100,100],[900,100],[900,900],[100,900]]};
const layout={sceneMatches:true,heads:[{box:[100,150,250,550]},{box:[650,150,250,550]}]};
module.exports={codec,solid,headGeometry,layout};
