const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),{JSDOM}=require('jsdom');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,f);
const React=require('react'),{act}=React;
async function view(t){const dom=new JSDOM('<div id="root"></div>',{url:'https://party.test'});Object.assign(global,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});dom.window.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){}});const root=require('react-dom/client').createRoot(document.getElementById('root')),flush=()=>new Promise(r=>setImmediate(r));t.after(async()=>{await act(async()=>root.unmount());dom.window.close();delete global.window;delete global.document;delete global.IS_REACT_ACT_ENVIRONMENT});return{render:async e=>act(async()=>{root.render(e);await flush()}),click:async b=>act(async()=>{assert(b);b.click();await flush()})}}
const renamed=[[1,'今晚谁最搭'],[7,'客官,YOU HAPPY？'],[3,'线下决斗'],[4,'毕加索在世'],[9,'全场最强英雄']];

test('renamed activity menus, headings and rules keep the saved internal ids and presentation order',async t=>{
 const v=await view(t),d=require('../src/domain.ts'),{activityRules}=require('../src/rules-data.ts'),calls=[],states={taskBank:{value:['请对方说“今晚，请验收我”'],version:7},truth:{value:{preserved:'保留档案'},version:3}};
 window.partyDesktop={call:async(route,body,method)=>{calls.push({route,body,method});return{ok:true,data:route==='boot'?{players:[],states,event:{id:'e'},ai:{},dataDirectory:'isolated'}:route==='mission/list'?{round:null,missions:[]}:route==='game/win/list'?{events:[]}:route==='scores/list'?{players:[],history:[]}:route==='mobile/status'?{running:false}:{}}}};
 await v.render(React.createElement(require('../src/console.tsx').default));
 assert.deepEqual(d.activityDisplayOrder,[1,7,3,4,6,5,2,8,9,10,11]);assert.deepEqual(d.activityKinds,['pairs','truth','tails','draw','crop','fans','taskBank','lottery','scores','voicePitch','voiceImitation']);
 assert.deepEqual([...document.querySelectorAll('aside nav button')].map(b=>b.textContent.replace(/^\d{2}/,'')),['今晚谁最搭','客官,YOU HAPPY？','线下决斗','毕加索在世','王不见王','这又是哪位佳丽','谁是最有趣开心的人','随机抽取玩家','全场最强英雄','谁叫的最高','谁叫得最像']);
 for(const[id,name]of renamed){assert.equal(d.activityNames[id-1],name);assert.equal(activityRules[id].title,name);await v.click(document.querySelectorAll('aside nav button')[d.displayNumber(id)-1]);assert.equal(document.querySelector('.activity-header h1').textContent,name);assert.match(document.querySelector('.activity-header .eyebrow').textContent,new RegExp('MISSION '+String(d.displayNumber(id)).padStart(2,'0')));assert(document.querySelector('.breadcrumbs').textContent.includes('活动'+d.displayNumber(id)+' · '+name));if(id===7)assert(document.body.textContent.includes('请对方说“今晚，请验收我”'));}
 assert(!calls.some(c=>c.route==='state'||c.route==='activity/reset'));assert.equal(states.taskBank.version,7);
});

test('legacy screen metadata adapts only known system labels and leaves source and free text intact',()=>{
 const {adaptScreenActivityNames}=require('../src/domain.ts');
 const saved={activity:1,mode:'pair',title:'天作之合总结',subtitle:'今晚，请验收我',tag:'天作之合 · 心有灵犀',body:'我把“天作之合”写进自己的任务',task:'唱今晚验收我',caption:'天作之合'},before=structuredClone(saved),shown=adaptScreenActivityNames(saved);
 assert.equal(shown.title,'今晚谁最搭总结');assert.equal(shown.subtitle,'客官,YOU HAPPY？');assert.equal(shown.tag,'今晚谁最搭 · 心有灵犀');assert.equal(shown.body,saved.body);assert.equal(shown.task,saved.task);assert.equal(shown.caption,saved.caption);assert.deepEqual(saved,before);
 for(const[old,name]of [['天作之合','今晚谁最搭'],['今晚验收我','客官,YOU HAPPY？'],['今晚，验收我','客官,YOU HAPPY？'],['今晚,请验收我','客官,YOU HAPPY？'],['抢你的尾巴','线下决斗'],['抢尾巴大赛 · 当前排名','线下决斗 · 当前排名'],['你画，AI猜','毕加索在世'],['全场积分榜','全场最强英雄']])assert.equal(adaptScreenActivityNames({title:old}).title,name);
 const custom={title:'我的天作之合回忆',subtitle:'请唱“今晚验收我”',tag:'天作之合 · 自定义合照说明'};assert.deepEqual(adaptScreenActivityNames(custom),custom);
});

test('stage displays renamed live labels from an old saved screen without writing or changing mission text',async t=>{
 const v=await view(t),Stage=require('../src/stage.tsx').default,calls=[],players=[{id:'a',number:'1',name:'甲',active:1},{id:'b',number:'2',name:'乙',active:1}],saved={activity:7,mode:'missions',title:'今晚，请验收我',subtitle:'今晚验收我',tag:'天作之合'},before=structuredClone(saved);
 window.partyDesktop={call:async(route,body,method)=>{calls.push({route,body,method});return{ok:true,data:route==='boot'?{players,states:{}}:route==='screen'?saved:route==='scores/list'?{players}:route==='mission/list'?{round:{id:'r',ended:false},missions:[{id:'m',actor:'a',target:'b',task:'请说“天作之合”，然后画出你画，AI猜',completed_at:null}]}:{}}}};
 await v.render(React.createElement(Stage,{onClose:()=>{}}));assert(document.body.textContent.includes('客官,YOU HAPPY？'));assert(document.body.textContent.includes('请说“天作之合”，然后画出你画，AI猜'));assert(!calls.some(c=>c.method==='PUT'||c.route==='state'));assert.deepEqual(saved,before);
 const project=require('../src/live-projection.ts').liveProjection;for(const[id,name]of renamed)assert(project({activity:id,players,screen:{activity:id,title:'旧标题'}}).title.startsWith(name));
});
