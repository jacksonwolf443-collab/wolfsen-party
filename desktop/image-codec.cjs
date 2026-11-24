'use strict';
function createImageCodec(nativeImage){return{
 decode(bytes){const image=nativeImage.createFromBuffer(Buffer.from(bytes));if(image.isEmpty())throw Error('照片无法解码');const {width,height}=image.getSize();if(width*height>25000000)throw Error('照片尺寸过大');return{width,height,data:Buffer.from(image.toBitmap())}},
 encode(raster){return nativeImage.createFromBitmap(Buffer.from(raster.data),{width:raster.width,height:raster.height,scaleFactor:1}).toPNG()}
}}
module.exports={createImageCodec};
