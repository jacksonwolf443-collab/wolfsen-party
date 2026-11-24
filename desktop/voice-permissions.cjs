'use strict';
const {fileURLToPath}=require('node:url');
const path=require('node:path');

function installVoicePermissions(contents,rendererPath){
 const session=contents.session;
 const renderer=path.resolve(rendererPath);
 const isRenderer=url=>{
  try{const value=new URL(url);return value.protocol==='file:'&&!value.search&&!value.hash&&path.resolve(fileURLToPath(value))===renderer;}
  catch{return false;}
 };
 const trusted=(sender,details)=>sender===contents&&details?.isMainFrame===true&&
   isRenderer(sender.getURL())&&(!details.requestingUrl||isRenderer(details.requestingUrl));
 session.setPermissionCheckHandler((sender,permission,origin,details)=>
   trusted(sender,details)&&
   (permission==='speaker-selection'||(permission==='media'&&details.mediaType==='audio')));
 session.setPermissionRequestHandler((sender,permission,callback,details)=>{
  const audioOnly=permission==='media'&&Array.isArray(details?.mediaTypes)&&details.mediaTypes.length===1&&details.mediaTypes[0]==='audio';
  callback(trusted(sender,details)&&(audioOnly||permission==='speaker-selection'));
 });
}
module.exports={installVoicePermissions};
