// Regression tests execute application code with controlled native/network/React boundaries.
// They do not replace device audio or rendered UI testing.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const deps = path.join(root, 'node_modules');
const ts = require(path.join(deps, 'typescript'));
const silent = {log(){},warn(){},error(){},info(){}};
const tick = () => new Promise(resolve => setImmediate(resolve));
const defer = () => { let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}; };
function load(file, modules={}, globals={}, extra='') {
 const source=fs.readFileSync(path.join(root,file),'utf8')+String.fromCharCode(10)+extra;
 const code=ts.transpileModule(source,{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 const exports={}; const context={exports,Buffer,console:silent,setTimeout,clearTimeout,setInterval,clearInterval,...globals};
 context.require=name=>{if(!(name in modules))throw new Error('Unexpected import '+name+' from '+file);return modules[name];};
 vm.runInNewContext(code,context,{filename:file}); return exports;
}
function hooks() {
 const refs=[],effects=[];
 return {refs,effects,react:{forwardRef:fn=>fn,memo:fn=>fn,useRef:v=>{const r={current:v};refs.push(r);return r},useEffect:fn=>effects.push(fn),useImperativeHandle:(r,fn)=>{r.current=fn()},useState:v=>[v,()=>{}],useMemo:fn=>fn(),useCallback:fn=>fn},jsx:{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}};
}
const log={error(){},info(){},warn(){},r_error(){},r_warn(){}};
async function run(id,label,fn){ await test(id+' '+label, fn); }
(async()=>{
 await run('F01','multipart data sends correctly and clears request timers',async()=>{
  for(const file of ['src/core/init/userApi/request.js','src/utils/request.js']) {
   const timers=new Map(), calls=[];let n=0;
   class FormData { constructor(){this.values=[]} append(k,v){this.values.push([k,v])} }
   const modules={'react-native-background-timer':{setTimeout:fn=>{timers.set(++n,fn);return n},clearTimeout:id=>timers.delete(id)}};
   if(file.includes('utils/request')) Object.assign(modules,{'./message':{requestMsg:{}},'./musicSdk/options':{bHh:'test-header'},pako:{deflateRaw(){}}});
   const api=load(file,modules,{global:{AbortController,FormData,fetch:async(url,opts)=>{calls.push(opts);return {text:async()=>'{"ok":true}',headers:{map:{}},status:200,ok:true}}}},file.includes('utils/request')?'export { fetchData };':'');
   await api.fetchData('https://fixture.invalid',{method:'post',formData:{id:'song',unicode:'歌曲'},headers:{'content-type':'multipart/form-data'}}).request;
   assert.deepEqual(calls[0].body.values,[['id','song'],['unicode','歌曲']]);
   assert.equal(Object.keys(calls[0].headers).some(k=>k.toLowerCase()==='content-type'),false);
   assert.equal(timers.size,0);
   const invalid={};Object.defineProperty(invalid,'boom',{enumerable:true,get(){throw Error('invalid field')}});
   await assert.rejects(api.fetchData('https://fixture.invalid',{method:'POST',formData:invalid}).request,/invalid field/);
   assert.equal(calls.length,1);assert.equal(timers.size,0);
  }
 });
 await run('F02','failed saves preserve previously committed playlists',async()=>{
  const storage=new Map([['playlist',JSON.stringify(['existing-song'])]]);
  const adapter={getItem:async k=>storage.get(k)??null,multiGet:async ks=>ks.map(k=>[k,storage.get(k)??null]),removeItem:async k=>storage.delete(k),multiRemove:async ks=>ks.forEach(k=>storage.delete(k)),multiSet:async()=>{throw Error('ENOSPC injected')}};
  const api=load('src/plugins/storage.ts',{'@react-native-async-storage/async-storage':adapter,'@/utils/log':{log}});
  await assert.rejects(api.saveData('playlist',['new-song']),/ENOSPC/);
  const remaining=await api.getData('playlist');assert.deepEqual(Array.from(remaining),['existing-song']);return {before:['existing-song'],after:remaining};
 });
 await run('F02b','chunked saves survive staging and commit failures, migrate legacy data and serialize races',async()=>{
  const disk=new Map();let mode='',cleanupFails=false;
  const adapter={getItem:async k=>disk.get(k)??null,multiGet:async ks=>ks.map(k=>[k,disk.get(k)??null]),multiRemove:async ks=>{if(cleanupFails)throw Error('cleanup blocked');ks.forEach(k=>disk.delete(k))},clear:async()=>disk.clear(),getAllKeys:async()=>[...disk.keys()],multiSet:async entries=>{
   const shards=entries[0][0].startsWith('@___PART_A___');
   if(mode==='stage'&&shards){disk.set(...entries[0]);throw Error('stage ENOSPC')}
   if(mode==='commit'&&!shards)throw Error('commit ENOSPC');
   for(const pair of entries)disk.set(...pair);
  }};
  const api=load('src/plugins/storage.ts',{'@react-native-async-storage/async-storage':adapter,'@/utils/log':{log}});
  const old={song:'旧歌 🎵',payload:'x'.repeat(1100000)},next={song:'new',payload:'y'.repeat(1400000)};
  await api.saveData('playlist',old);
  for(const failure of ['stage','commit']) {mode=failure;await assert.rejects(api.saveData('playlist',next),/ENOSPC/);assert.equal(JSON.stringify(await api.getData('playlist')),JSON.stringify(old));}
  mode='';cleanupFails=true;await api.saveData('playlist',next);assert.equal((await api.getData('playlist')).song,'new');cleanupFails=false;
  const first=api.saveData('playlist',old),reading=api.getData('playlist'),second=api.saveData('playlist',next);
  await first;assert.equal((await reading).song,'旧歌 🎵');await second;assert.equal((await api.getData('playlist')).song,'new');
  disk.set('legacy','@___PART___legacy0,legacy1');disk.set('legacy0','{"song":');disk.set('legacy1','"legacy"}');
  assert.equal((await api.getData('legacy')).song,'legacy');await api.saveData('legacy',{song:'migrated'});assert.equal((await api.getData('legacy')).song,'migrated');assert.equal(disk.has('legacy0'),false);
  disk.set('legacy-array','@___PART_A___["part,0","part,1"]');disk.set('part,0','["one",');disk.set('part,1','"two"]');
  assert.deepEqual(Array.from(await api.getData('legacy-array')),['one','two']);
  await api.saveDataMultiple([['a',old],['b',next],['a',{song:'last duplicate'}]]);
  const data=await api.getDataMultiple(['a','b']);assert.equal(data[0][1].song,'last duplicate');assert.equal(data[1][1].song,'new');
  mode='stage';await assert.rejects(api.saveDataMultiple([['a',old],['b',old]]),/ENOSPC/);assert.equal((await api.getData('a')).song,'last duplicate');assert.equal((await api.getData('b')).song,'new');
  mode='';await api.removeDataMultiple(['playlist','a','b']);assert.equal(await api.getData('playlist'),null);
 });
 await run('F02c','installed native storage defers deletion and rolls back a failed manifest',async()=>{
  const native=fs.readFileSync(path.join(deps,'@react-native-async-storage/async-storage/ios/RNCAsyncStorage.mm'),'utf8');
  const entry=native.slice(native.indexOf('- (NSDictionary *)_writeEntry:'),native.indexOf('- (void)_multiGet:'));
  assert.ok(entry.includes('LX_STORAGE_COMMIT'));
  assert.ok(!entry.includes('removeItemAtPath:'));
  assert.ok(entry.includes('if (!error) [RCTGetCache() setObject:value'));
  const multi=native.slice(native.indexOf('RCT_EXPORT_METHOD(multiSet:'),native.indexOf('RCT_EXPORT_METHOD(multiMerge:'));
  assert.ok(multi.includes('_manifest = [committedManifest mutableCopy]'));
  assert.ok(multi.indexOf('[self _writeManifest:&errors]')<multi.indexOf('removeItemAtPath:'));
 });
 await run('F03','failed exports show failure instead of success',async()=>{
  const toasts=[]; const api=load('src/screens/Home/Views/Setting/settings/Backup/actions.ts',{'@/config/constant':{LIST_IDS:{}},'@/core/list':{getListMusics:async()=>[]},'@/utils':{},'@/utils/log':{log},'@/utils/tools':{toast:s=>toasts.push(s),handleSaveFile:async()=>{throw Error('write denied')}},'@/store/list/state':{defaultList:{id:'default'},loveList:{id:'love'},userList:[]}},{global:{i18n:{t:k=>k}}});
  api.handleExportList('/fixture');await tick();assert.match(toasts.at(-1),/^setting_backup_part_export_list_tip_failed/);assert.ok(!toasts.includes('setting_backup_part_export_list_tip_success'));return {writeFailure:'write denied',toasts};
 });
 await run('F04','cached searches retain their keyword and source on refresh',async()=>{
  const results=[];
  for(const kind of ['music','songlist']){
   const h=hooks(),calls=[]; const state={searchText:'test song',source:'all',listInfos:{all:{list:[{id:'a'}],maxPage:3,page:1},kw:{list:[],page:1,maxPage:3}},maxPages:{all:3,kw:3}};
   const mod=kind==='music'?'MusicList':'SonglistList';
   const modules={react:h.react,'react/jsx-runtime':h.jsx};
   modules['@/core/search/'+kind]={search:async(...args)=>{calls.push(args);return []}};
   modules['@/store/search/'+kind+'/state']=state;
   modules[kind==='music'?'@/components/OnlineList':'@/screens/Home/Views/SongList/components/Songlist']={};
   const Component=load('src/screens/Home/Views/Search/'+mod+'.tsx',modules,{requestAnimationFrame:fn=>fn()}).default;
   const ref={};const view=Component({},ref);h.refs[0].current={setList(){},setStatus(){}};
   await ref.current.loadList('test song','all');view.props.onRefresh();await tick();
   assert.equal(calls[0][0],'test song');assert.equal(calls[0][2],'all');results.push({kind,displayedQuery:'test song',displayedSource:'all',actualRefresh:calls[0]});
  }return results;
 });
 await run('F05','late search responses cannot clear newer results',async()=>{
  const h=hooks(),requests=new Map(),updates=[];
  const state={searchText:'',source:'kw',sources:['kw'],listInfos:{kw:{list:[],limit:30,maxPage:3,page:1,key:null}},maxPages:{kw:3}};
  const actions={setSource:s=>state.source=s,setSearchText:s=>state.searchText=s,setListInfo:d=>state.listInfos.kw.list=d.list,clearListInfo:()=>{state.listInfos.kw.list=[]}};
  const core=load('src/core/search/music.ts',{'@/store/search/music/state':state,'@/store/search/music/action':actions,'@/utils/musicSdk':{kw:{musicSearch:{search:text=>{const d=defer();requests.set(text,d);return d.promise}}}}});
  const Component=load('src/screens/Home/Views/Search/MusicList.tsx',{react:h.react,'react/jsx-runtime':h.jsx,'@/components/OnlineList':{},'@/core/search/music':core,'@/store/search/music/state':state},{requestAnimationFrame:fn=>fn()}).default;
  const ref={};Component({},ref);h.refs[0].current={setList:list=>updates.push(list.map(x=>x.id)),setStatus(){}};
  const first=ref.current.loadList('old','kw'),second=ref.current.loadList('new','kw');
  requests.get('new').resolve({list:[{id:'new-result'}]});await second;
  requests.get('old').resolve({list:[{id:'old-result'}]});await first;
  assert.deepEqual(updates.at(-1),['new-result']);return {renderedUpdates:updates,storeStillContains:state.listInfos.kw.list};
 });
 await run('F06','single and aggregate songlist searches compute the last page',async()=>{
  const state={source:'kw',listInfos:{kw:{list:[],limit:18,page:1,total:0},all:{list:[],limit:15,page:1,total:0}},maxPages:{}};
  const actions=load('src/store/search/songlist/action.ts',{'./state':state,'@/utils/common':{sortInsert:(a,v)=>a.push(v),similar:()=>1}}).default;
  actions.setListInfo({source:'kw',list:[{id:'a'}],total:1,limit:18},1,'a');
  actions.setListInfo([{source:'kw',list:[{id:'a',name:'a'}],total:1,limit:18}],1,'a');
  assert.equal(state.maxPages.all,1);const single={source:'kw',listInfos:{kw:{list:[],limit:18}},maxPages:{}};
  const a=load('src/store/search/songlist/action.ts',{'./state':single,'@/utils/common':{}}).default;a.setListInfo({source:'kw',list:[{id:'a'}],total:1,limit:18},1,'a');assert.equal(single.maxPages.kw,1);
  return {singleMaxPage:String(single.maxPages.kw),aggregateMaxPage:String(state.maxPages.all),expected:1};
 });
 await run('F07','home unmount removes all config listeners',async()=>{
  const ActualEvent=load('src/event/Event.ts',{}, {setImmediate}).default;const h=hooks(),events=new ActualEvent();events.listenerCount=name=>events.listeners.get(name)?.length??0;const modules={react:h.react,'react/jsx-runtime':h.jsx,'react-native':{},'@/store/common/state':{navActiveId:'nav_setting'},'@/utils/tools':{createStyle:x=>x},'react-native-pager-view':{},'@/core/common':{},'@/store/setting/state':{}};
  for(const page of ['Search','SongList','Mylist','Leaderboard','Setting'])modules['../Views/'+page]={};
  const api=load('src/screens/Home/Vertical/Main.tsx',modules,{global:{state_event:events},requestAnimationFrame:fn=>fn()},'export { SongListPage, LeaderboardPage, MylistPage };');
  for(const page of ['SongListPage','LeaderboardPage','MylistPage'])api[page]();
  const cleanup=h.effects.map(fn=>fn());const mounted=events.listenerCount('configUpdated');cleanup.forEach(fn=>fn());const afterUnmount=events.listenerCount('configUpdated');
  assert.equal(mounted,3);assert.equal(afterUnmount,0);return {mounted,afterUnmount,expectedAfterUnmount:0};
 });
 await run('F08','comment first-load failure shows a retryable error',async()=>{
  const results=[];
  for(const kind of ['Hot','New']){
   const h=hooks(),statuses=[],unhandled=[]; const onError=e=>unhandled.push(e.message);process.on('unhandledRejection',onError);
   try{
    const modules={react:h.react,'react/jsx-runtime':h.jsx,'./components/List':{},'@/utils/musicSdk':{kw:{comment:{}}},'./utils':{filterList:x=>x,['get'+kind+'Comment']:async()=>{throw Error('offline fixture')}}};
    const Component=load('src/screens/Comment/Comment'+kind+'.tsx',modules).default;Component({musicInfo:{id:'song',source:'kw'},onUpdateTotal(){}});
    h.refs[0].current={setList(){},setStatus:s=>statuses.push(s)};h.effects.forEach(fn=>fn());await tick();await tick();
    assert.equal(statuses.at(-1),'error');assert.deepEqual(unhandled,[]);results.push({kind,statuses,unhandled});
   }finally{process.off('unhandledRejection',onError)}
  }return results;
 });
 await run('F09','old-session encryption never sends through a new socket',async()=>{
  const sockets=[],configs=[],pending=defer(),decryption=defer(),received=[],statuses=[];let timer=0;
  class Socket extends EventEmitter { constructor(url){super();this.url=url;this.sent=[];this.closes=[];sockets.push(this)} addEventListener(e,f){this.on(e,f)} send(v){this.sent.push(v)} close(code){this.closes.push(code)} }
  const modules={'./utils':{encryptMsg:()=>pending.promise,decryptMsg:()=>decryption.promise},'./sync':{callObj:{}},'../log':log,'../utils':{aesEncrypt:()=>''},'@/core/sync':{setSyncStatus:s=>statuses.push({...s})},'@/utils/common':{dateFormat:()=>''},message2call:{createMsg2call:c=>{configs.push(c);return {remote:{},createQueueRemote:()=>({}),destroy(){},message:x=>received.push(x)}}},'@/utils/tools':{toast(){}},'../constants':{SYNC_CODE:{msgConnect:'connect'},SYNC_CLOSE_CODE:{normal:1000,failed:4100}}};
  const api=load('src/plugins/sync/client/client.ts',modules,{WebSocket:Socket,setTimeout:()=>++timer,clearTimeout(){}});
  api.connect({wsProtocol:'wss:',hostPath:'old.invalid'},{clientId:'old',key:'oldkey'});sockets[0].emit('open');configs[0].sendMessage({old:'payload'});sockets[0].emit('message',{data:'old encrypted response'});
  await api.disconnect();api.connect({wsProtocol:'wss:',hostPath:'new.invalid'},{clientId:'new',key:'newkey'});sockets[1].emit('open');pending.resolve('OLD_KEY_CIPHERTEXT');decryption.resolve('{}');await tick();
  const statusCount=statuses.length;sockets[0].emit('close',{code:4100});sockets[0].emit('open');sockets[0].emit('error',{message:'stale error'});configs[0].funcsObj.finished();assert.equal(statuses.length,statusCount);assert.deepEqual(sockets[1].closes,[]);assert.equal(received.length,0);
  assert.deepEqual(sockets[0].sent,[]);assert.deepEqual(sockets[1].sent,[]);configs[1].sendMessage({new:'valid'});await tick();assert.equal(sockets[1].sent.length,1);return {oldSocketSends:sockets[0].sent,newSocketSends:sockets[1].sent};
 });
 await run('F10','native metadata methods settle and allow subsequent full updates',async()=>{
  const nativeSource=fs.readFileSync(path.join(deps,'react-native-track-player/ios/RNTrackPlayer/RNTrackPlayer.swift'),'utf8');
  const start=nativeSource.indexOf('public func updateNowPlayingMetadata('),end=nativeSource.indexOf('// MARK: - QueuedAudioPlayer Event Handlers',start);
  const method=nativeSource.slice(start,end);assert.ok(method.includes('Metadata.update'));assert.ok(method.includes('resolve(NSNull())'));assert.ok(method.includes('LX_METADATA_PROMISE'));
  const timers=new Map(),calls=[];let n=0;
  const player={getState:async()=>1,updateNowPlayingMetadata:data=>{calls.push(data.title);return Promise.resolve()}};
  const modules={'@/utils/log':{log},'@/plugins/trackPlayer':{...player,default:player,__esModule:true,State:{Playing:1}},'react-native-background-timer':{setTimeout:fn=>{timers.set(++n,fn);return n},clearTimeout:id=>timers.delete(id)},'@/config':{},'@/store/setting/state':{setting:{}},'@/store/player/state':{musicInfo:{}}};
  const api=load('src/plugins/player/playList.ts',modules);
  api.delayUpdateMusicInfo({id:'one',name:'first song'});await tick();
  const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());
  api.delayUpdateMusicInfo({id:'two',name:'second song'});await tick();
  assert.deepEqual(calls,['first song','second song']);return {nativeMethodSettlesPromise:true,requested:['first song','second song'],nativeUpdates:calls};
 });
 await run('F11','native playback error details reach logs',async()=>{
  const nativeSource=fs.readFileSync(path.join(deps,'react-native-track-player/ios/RNTrackPlayer/RNTrackPlayer.swift'),'utf8');assert.ok(nativeSource.includes('body: ["error": error?.localizedDescription]'));
  const listeners={},logs=[];let register;
  const player={addEventListener:(event,fn)=>listeners[event]=fn,registerPlaybackService:fn=>register=fn};
  const api=load('src/plugins/player/service.ts',{'@/utils/log':{log:{error:(...s)=>logs.push(s)}},'@/plugins/trackPlayer':{__esModule:true,default:player,State:{},Event:{PlaybackError:'error'}},'./utils':{isTempId:()=>false},'@/core/common':{},'./playList':{},'@/core/player/player':{}},{global:{lx:{playerStatus:{}},app_event:{error(){},playerError(){}}}});
  api.default();await register()();await listeners.error({error:'AVFoundationErrorDomain fixture cannot decode media'});
  assert.deepEqual(logs[0],['[player native]','unknown','AVFoundationErrorDomain fixture cannot decode media']);return {nativeError:'AVFoundationErrorDomain fixture cannot decode media',persistedLog:logs[0]};
 });
 await run('F12','bad local files are isolated and import loading always resets',async()=>{
  const statuses=[],added=[],updated=[],removed=[];let scanError=false;
  const modules={'@/core/list':{setFetchingListStatus:(id,v)=>statuses.push(v),addListMusics:async(id,m)=>added.push(...m),updateListMusics:async m=>updated.push(...m),removeListMusics:async(id,paths)=>removed.push(...paths)},'@/utils/tools':{toast(){}},'@/core/syncSourceList':{},'@/utils/log':{log},'@/utils':{formatPlayTime2:()=> '03:00'},'@/screens/Home/Views/Setting/settings/Backup/actions':{},'@/utils/localMediaMetadata':{scanAudioFiles:async()=>{if(scanError)throw Error('scan denied');return [{path:'/fixture/good.mp3',name:'good.mp3'},{path:'/fixture/corrupt.mp3',name:'corrupt.mp3'}]},readMetadata:async p=>{if(p.includes('corrupt'))throw Error('E_MEDIA');return {name:'good',singer:'artist',ext:'mp3',interval:180}}},'@/store/setting/state':{setting:{}}};
  const api=load('src/screens/Home/Views/Mylist/MyList/listAction.ts',modules,{global:{i18n:{t:k=>k}}});
  await api.handleImportMediaFile({id:'list'},'/fixture');
  assert.deepEqual(statuses,[true,false]);assert.equal(updated.length,1);assert.equal(updated[0].musicInfo.name,'good');assert.deepEqual(removed,['/fixture/corrupt.mp3']);
  scanError=true;await api.handleImportMediaFile({id:'list'},'/fixture');assert.deepEqual(statuses,[true,false,true,false]);
 });
 await run('F13','metadata editor persists explicit replacements of existing fields',async()=>{
  const disk=new Map();const original={name:'Original title',singer:'Original singer',albumName:'Original album'};
  const modules={'react-native':{NativeModules:{LXMedia:{readMetadata:async()=>original},LXDocuments:{writeTextAtomic:async(p,s)=>disk.set(p,s)}}},'react-native-fs':{LibraryDirectoryPath:'/library',mkdir:async()=>{}},'react-native-quick-md5':{stringMd5:()=> 'song'},'@/utils/fs':{existsFile:async p=>disk.has(p),readFile:async p=>disk.get(p)}};
  const api=load('src/utils/localMediaMetadata.ios.ts',modules);
  const h=hooks(),form={name:'Edited title',singer:'Edited singer',albumName:'Edited album',pic:'',lyric:''};
  h.react.useState=value=>[true,()=>{}];
  const Component=load('src/components/MetadataEditModal/index.tsx',{
   react:h.react,'react/jsx-runtime':h.jsx,'@/components/common/ConfirmAlert':{},'@/components/common/Text':{},'react-native':{Platform:{OS:'ios'},View:{}},
   '@/utils/tools':{TEMP_FILE_PATH:'/temp',createStyle:x=>x,toast(){}},'@/utils/localMediaMetadata':{...api,readPic:async()=>'',readLyric:async()=>''},
   '@/utils/hooks':{useUnmounted:()=>({current:false})},'./MetadataForm':{defaultData:{}},'@/utils/log':{log},'@/utils':{formatPlayTime2:()=> '03:00'},'@/utils/fs':{unlink:async()=>{}},
  },{requestAnimationFrame:fn=>fn(),global:{i18n:{t:k=>k}}}).default;
  const ref={};const view=Component({onUpdate(){}},ref);
  h.refs[0].current={setVisible(){}};h.refs[1].current={setForm(){},getForm:()=>form};
  ref.current.show('/song.mp3');await tick();await view.props.onConfirm();
  const after=await api.readMetadata('/song.mp3');assert.equal(after.name,'Edited title');assert.equal(after.singer,'Edited singer');
  return {submitted:{name:'Edited title',singer:'Edited singer'},readBack:after,storedOverride:JSON.parse([...disk.values()][0])};
 });
 await run('F14','late startup artwork and lyrics cannot overwrite a new song',async()=>{
  const picture=defer(),lyric=defer(),applied=[];
  const old={id:'A'},state={playMusicInfo:{musicInfo:old,listId:'list'},musicInfo:{id:'A',pic:null}};
  const modules={'@/plugins/player':{initTrackInfo:async()=>{}},'@/core/player/playStatus':{},'@/store/player/state':state,'@/store/setting/state':{setting:{}},'@/core/player/playInfo':{setMusicInfo:info=>{applied.push(info);Object.assign(state.musicInfo,info)}},'@/core/player/playedList':{},'@/core/player/tempPlayList':{},'@/core/music':{getPicPath:()=>picture.promise,getLyricInfo:()=>lyric.promise},'@/utils/message':{},'@/utils/common':{},'./utils':{},'react-native-background-timer':{},'@/utils/tools':{debounceBackgroundTimer:fn=>fn},'@/config/constant':{},'@/core/list':{},'@/core/dislikeList':{}};
  const api=load('src/core/player/player.ts',modules,{setTimeout:()=>1,global:{app_event:{picUpdated(){},lyricUpdated(){}}}},'export { handleRestorePlay };');
  await api.handleRestorePlay({time:0,maxTime:200});state.playMusicInfo={musicInfo:{id:'B'},listId:'list'};state.musicInfo={id:'B',pic:null};
  picture.resolve('https://fixture.invalid/A.jpg');lyric.resolve({lyric:'Lyrics for A',rawlrcInfo:{lyric:'Lyrics for A'}});await tick();
  assert.equal(state.musicInfo.id,'B');assert.equal(state.musicInfo.lrc,undefined);assert.equal(state.musicInfo.pic,null);assert.equal(applied.length,0);return {currentSong:state.musicInfo.id,applied};
 });
 await run('F15','playlist songs remain visible when scroll-position loading fails',async()=>{
  const h=hooks(),events=new EventEmitter(),appEvents=new EventEmitter(),stateUpdates=[],unhandled=[];let calls=0;
  h.react.useState=initial=>[initial,v=>stateUpdates.push(v)];
  const modules={react:h.react,'react/jsx-runtime':h.jsx,'react-native':{FlatList:'FlatList'},'@/components/common/Button':{},'@/components/common/Text':{},'@/utils/log':{log},'@/core/player/player':{},'@/store/list/state':{activeListId:'list'},'@/store/player/state':{playMusicInfo:{}},'@/utils/data':{getListPrevSelectId:async()=> 'list',getListPosition:async()=>{throw Error('scroll-position read failed')}},'@/core/list':{getListMusics:async()=>{calls++;return [{id:'existing-song'}]}},'./ListItem':{ITEM_HEIGHT:50},'@/utils/tools':{createStyle:x=>x,getRowInfo:()=>({rowNum:1})},'@/store/player/hook':{usePlayInfo:()=>({}),usePlayMusicInfo:()=>({})},'@/store/list/hook':{useActiveListId:()=> 'list'},'@/store/setting/hook':{useSettingValue:()=>false}};
  const api=load('src/screens/Home/Views/Mylist/MusicList/List.tsx',modules,{global:{lx:{},state_event:events,app_event:appEvents},requestAnimationFrame:fn=>fn()});
  const listener=e=>unhandled.push(e.message);process.on('unhandledRejection',listener);
  try{api.default({},{});h.effects.forEach(fn=>fn());await tick();await tick();events.emit('mylistToggled','list');await tick();
   assert.equal(calls,1);assert.ok(stateUpdates.some(x=>Array.isArray(x)&&x[0]?.id==='existing-song'));assert.deepEqual(unhandled,[]);return {musicReadSucceeded:true,renderedSongs:stateUpdates,readCallsAfterReselect:calls,unhandled};
  }finally{process.off('unhandledRejection',listener)}
 });
 await run('F15b','playlist read failure can retry the same list and unmount ignores late replies',async()=>{
  const h=hooks(),events=new EventEmitter(),updates=[];let calls=0,fail=true;const pending=defer();
  h.react.useState=initial=>[initial,v=>updates.push(v)];
  const modules={react:h.react,'react/jsx-runtime':h.jsx,'react-native':{FlatList:'FlatList'},'@/components/common/Button':{},'@/components/common/Text':{},'@/utils/log':{log},'@/core/player/player':{},'@/store/list/state':{activeListId:'list'},'@/store/player/state':{playMusicInfo:{}},'@/utils/data':{getListPrevSelectId:async()=> 'list',getListPosition:async()=>0},'@/core/list':{getListMusics:async()=>{calls++;if(fail)throw Error('temporary read failure');return pending.promise}},'./ListItem':{ITEM_HEIGHT:50},'@/utils/tools':{createStyle:x=>x,getRowInfo:()=>({rowNum:1})},'@/store/player/hook':{usePlayInfo:()=>({}),usePlayMusicInfo:()=>({})},'@/store/list/hook':{useActiveListId:()=> 'list'},'@/store/setting/hook':{useSettingValue:()=>false}};
  const Component=load('src/screens/Home/Views/Mylist/MusicList/List.tsx',modules,{global:{lx:{},state_event:events,app_event:new EventEmitter()},requestAnimationFrame:fn=>fn()}).default;
  Component({},{});const cleanups=h.effects.map(fn=>fn());await tick();assert.ok(updates.includes(true));
  fail=false;events.emit('mylistToggled','list');await tick();assert.equal(calls,2);
  pending.resolve([{id:'recovered'}]);await tick();assert.ok(updates.some(x=>Array.isArray(x)&&x[0]?.id==='recovered'));
  const count=updates.length;cleanups.forEach(fn=>fn?.());events.emit('mylistToggled','another');await tick();assert.equal(updates.length,count);
 });
 await run('F16','late catalogue and leaderboard responses cannot overwrite current selection',async()=>{
  const results=[];
  for(const kind of ['songlist','leaderboard']){
   const h=hooks(),requests=new Map(),rendered=[];
   const state=kind==='songlist'?{listInfo:{list:[],source:'kw',tagId:'',sortId:'',maxPage:1}}:{listDetailInfo:{list:[],source:'kw',id:'',maxPage:1}};
   const actions=load('src/store/'+kind+'/action.ts',{'./state':state}).default;
   let core,ui,modules={react:h.react,'react/jsx-runtime':h.jsx};
   if(kind==='songlist'){
    core={setListInfo:(source,tag,sort)=>{actions.clearList();actions.setListInfo(source,tag,sort)},setList:actions.setList,clearList:actions.clearList,getList:(source,tag)=>{const d=defer();requests.set(tag,d);return d.promise}};
    ui='src/screens/Home/Views/SongList/List.tsx';modules['./components/Songlist']={};
   }else{
    core={setListDetailInfo:id=>{actions.clearListDetail();actions.setListDetailInfo('kw',id)},setListDetail:actions.setListDetail,clearListDetail:actions.clearListDetail,getListDetail:id=>{const d=defer();requests.set(id,d);return d.promise}};
    ui='src/screens/Home/Views/Leaderboard/MusicList.tsx';modules['@/components/OnlineList']={};modules['./listAction']={};
   }
   modules['@/core/'+kind]=core;modules['@/store/'+kind+'/state']=state;
   const Component=load(ui,modules,{requestAnimationFrame:fn=>fn()}).default,ref={};Component({},ref);h.refs[0].current={setList:x=>rendered.push(x.map(y=>y.id)),setStatus(){}};
   const first=kind==='songlist'?ref.current.loadList('kw','hot','A'):ref.current.loadList('kw','A');
   const second=kind==='songlist'?ref.current.loadList('kw','hot','B'):ref.current.loadList('kw','B');
   requests.get('B').resolve({source:'kw',list:[{id:'B-song'}],total:1,limit:30});await second;
   requests.get('A').resolve({source:'kw',list:[{id:'A-song'}],total:1,limit:30});await first;
   assert.equal(rendered.at(-1)[0],'B-song');assert.equal((kind==='songlist'?state.listInfo:state.listDetailInfo).list[0].id,'B-song');results.push({kind,selected:'B',renderedLast:rendered.at(-1)});
  }return results;
 });

})();
