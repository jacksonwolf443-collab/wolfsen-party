'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('partyDesktop',Object.freeze({call:(route,body,method)=>ipcRenderer.invoke('party:call',route,body,method)}));
