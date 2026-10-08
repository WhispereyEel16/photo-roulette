/* Photo Roulette v3 — optional Live Duo realtime rooms.
   Works on GitHub Pages when firebase-config.js is configured.
   Solo app still runs with no Firebase setup or internet. */
const $ = id => document.getElementById(id);
const bridge = window.PhotoRouletteBridge;
const config = window.PHOTO_ROULETTE_FIREBASE || {};
const CODE_RE = /^[A-HJ-NP-Z2-9]{20}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let database, roomReference, roomCode = '', unsubscribeRoom, unsubscribeConnection;
let online = false, connecting = false, ready = false;
let get, ref, set, onValue, runTransaction;
const roomDisplay = code => code.match(/.{1,4}/g).join('-');
const normalized = str => String(str || '').trim().toUpperCase().replace(/[^A-Z2-9]/g, '');
const message = (msg, error = false) => { $('liveStatus').textContent = msg; $('liveStatus').style.borderColor = error ? '#b57965' : '#46614e'; };
const randomCode = () => { const b = new Uint8Array(20); crypto.getRandomValues(b); return Array.from(b, n => ALPHABET[n % ALPHABET.length]).join(''); };
const roomLink = code => { const u = new URL(location.href); u.searchParams.delete('m'); u.searchParams.delete('s'); u.searchParams.set('live', code); return u.toString(); };
const roomPath = code => ref(database, 'rooms/' + code);
const defaultTimer = minutes => ({ running:false, endsAt:0, remaining:minutes * 60 });
const disableLiveButtons = disabled => { $('createLive').disabled = disabled || Boolean(roomCode); $('joinLiveButton').disabled = disabled || Boolean(roomCode); };
function updateVisual(){
  $('liveRoomCode').textContent = roomCode ? roomDisplay(roomCode) : 'Not in a live room';
  $('shareLive').disabled = !roomCode || !ready;
  $('leaveLive').disabled = !roomCode;
  $('liveChip').className = 'livechip' + (roomCode ? '' : ' off');
  $('liveChip').textContent = !roomCode ? 'SOLO / MATCHED CODES' : ready && online ? 'LIVE DUO · CONNECTED' : 'LIVE DUO · RECONNECTING';
  disableLiveButtons(connecting || !online);
  if(roomCode){$('createLive').disabled=true;$('joinLiveButton').disabled=true;}
  bridge.availability(!roomCode || (ready && online));
}
const describeError = e => {
  const raw = String(e?.code || e?.message || e || 'Unknown error');
  if (raw.includes('permission_denied') || raw.includes('PERMISSION_DENIED')) return 'Database access denied. Paste the security rules from the setup guide and publish them.';
  if (raw.includes('auth/operation-not-allowed')) return 'Turn on Anonymous sign-in in Firebase Authentication.';
  if (raw.includes('auth/unauthorized-domain')) return 'Add your GitHub Pages domain in Firebase Authentication authorized domains.';
  if (raw.includes('auth/invalid-api-key') || raw.includes('app/invalid-api-key')) return 'Check the apiKey in firebase-config.js.';
  if (raw.includes('databaseURL') || raw.includes('invalid database')) return 'Check the Realtime Database URL in firebase-config.js.';
  return raw.slice(0,180);
};
const fail = e => {message(describeError(e),true);bridge.notify('Live connection failed — check setup');};
function stopSubscription(){
  if(unsubscribeRoom){unsubscribeRoom();unsubscribeRoom=undefined;}
  roomReference=undefined;roomCode='';ready=false;
}
function showLiveData(data){
  if(!data || data.version !== 3){message('This room has an incompatible version.',true);return;}
  if(!ready){ready=true;bridge.connected();}
  bridge.apply(data);
  message(online?'Connected · Changes on either phone appear on both.':'Offline · reconnect to continue live play.');
  updateVisual();
}
async function enterRoom(code){
  if(connecting)return;
  if(!CODE_RE.test(code)){message('Enter a valid 20-character Live Duo room code.',true);return;}
  connecting=true;updateVisual();message('Connecting to room…');
  try{
    const nextRef=roomPath(code);
    const data=await get(nextRef);
    if(!data.exists()){message('Room not found. Ask the person who created it to share their live invitation.',true);return;}
    stopSubscription();roomCode=code;roomReference=nextRef;
    try{localStorage.setItem('photo-roulette-last-live-room',code);}catch(e){}
    const u=new URL(location.href);u.searchParams.delete('m');u.searchParams.delete('s');u.searchParams.set('live',code);history.replaceState(null,'',u.toString());
    unsubscribeRoom=onValue(nextRef,snapshot=>{
      if(!roomReference || code!==roomCode)return;
      if(!snapshot.exists()){message('Room no longer exists. Leave and create another.',true);bridge.availability(false);return;}
      showLiveData(snapshot.val());
    },err=>{message(describeError(err),true);ready=false;updateVisual();});
    $('liveDetails').open=true;
  } catch(e){fail(e);} finally {connecting=false;updateVisual();}
}
async function createRoom(){
  if(connecting||roomCode)return;
  if(!online){message('An internet connection is required to create a room.',true);return;}
  connecting=true;updateVisual();message('Creating private live room…');
  try{
    let code=randomCode(),r=roomPath(code);
    for(let i=0;i<3;i++){
      const s=await get(r);
      if(!s.exists())break;
      code=randomCode();r=roomPath(code);
    }
    const shared=bridge.snapshot();
    shared.timer=defaultTimer(shared.minutes);
    await set(r,shared);
    connecting=false;
    await enterRoom(code);
    bridge.notify('Live Duo room created');
  }catch(e){fail(e);}finally{connecting=false;updateVisual();}
}
async function leaveRoom(){
  stopSubscription();
  try{localStorage.removeItem('photo-roulette-last-live-room');}catch(e){}
  const u=new URL(location.href);u.searchParams.delete('live');history.replaceState(null,'',u.toString());
  bridge.disconnected();
  message('Solo mode · Create or join a live room any time.');updateVisual();
  bridge.notify('Returned to solo mode');
}
async function invite(){
  if(!roomCode)return;
  const link=roomLink(roomCode);
  const txt=`Photo Roulette — Live Duo\nJoin our private live photography room:\n${link}\nRoom code: ${roomDisplay(roomCode)}\nEither phone can change missions, settings and timer.`;
  if(navigator.share){try{await navigator.share({title:'Photo Roulette Live Duo',text:txt,url:link});return;}catch(e){if(e.name==='AbortError')return;}}
  try{await navigator.clipboard.writeText(txt);bridge.notify('Live invitation copied');}
  catch(e){const input=$('joinLive');input.value=roomDisplay(roomCode);input.select();bridge.notify('Copy the room code shown above');}
}
async function publishAction({type, ...payload}){
  if(!roomReference||!ready)return;
  if(!online){message('Offline: reconnect before editing a live mission.',true);return;}
  const currentRoom=roomReference;
  try{
    const result=await runTransaction(currentRoom,cur=>{
      if(!cur||cur.version!==3)return;
      const next={...cur};
      const mins=[2,3,5].includes(Number(cur.minutes))?Number(cur.minutes):3;
      switch(type){
        case 'next':if(cur.round>=9999)return;next.round=cur.round+1;next.reroll=0;next.timer=defaultTimer(mins);break;
        case 'previous':if(cur.round<=1)return;next.round=cur.round-1;next.reroll=0;next.timer=defaultTimer(mins);break;
        case 'reroll':next.reroll=(cur.reroll+1)%51;next.timer=defaultTimer(mins);break;
        case 'done':{
          const entry=payload.entry;
          if(!entry||typeof entry.code!=='string')return;
          const history=Array.isArray(cur.history)?cur.history:(cur.history?Object.values(cur.history):[]);
          if(history.some(h=>h.code===entry.code))return;
          next.history=[entry,...history].slice(0,40);break;
        }
        case 'settings':{
          if(!['minutes','light','distance','difficulty'].includes(payload.key))return;
          const choices={minutes:[2,3,5],light:['M','S','O','L'],distance:['Q','N','E'],difficulty:['G','B','W']};
          if(!choices[payload.key].includes(payload.value))return;
          next[payload.key]=payload.value;
          next.timer=defaultTimer(payload.key==='minutes'?payload.value:mins);break;
        }
        case 'timer':{
          const t=payload.timer;
          if(!t||typeof t.remaining!=='number')return;
          next.timer={running:Boolean(t.running),endsAt:Number(t.endsAt)||0,remaining:Math.max(0,Math.min(600,Math.round(t.remaining)))};break;
        }
        default:return;
      }
      next.changedAt=Date.now();
      return next;
    },{applyLocally:false});
    if(!result.committed && ready && roomReference === currentRoom){message('This change was not saved. Try again.',true);}
  }catch(e){fail(e);}
}
$('createLive').addEventListener('click',createRoom);
$('shareLive').addEventListener('click',invite);
$('joinLiveButton').addEventListener('click',()=>enterRoom(normalized($('joinLive').value)));
$('joinLive').addEventListener('keydown',e=>{if(e.key==='Enter')$('joinLiveButton').click();});
$('leaveLive').addEventListener('click',leaveRoom);
window.addEventListener('photo-roulette-action', e => publishAction(e.detail));
message('Live Duo needs a one-time Firebase setup. Solo and matching codes already work.');
updateVisual();
if (!config.apiKey || String(config.apiKey).includes('PASTE_') || !config.databaseURL || String(config.databaseURL).includes('PASTE_')){
  message('Live Duo not configured yet. Follow the included Firebase setup guide. Solo mode works normally.');
  disableLiveButtons(true);
}else{
  try{
    const root='https://www.gstatic.com/firebasejs/12.19.0/';
    const [appModule,authModule,dbModule]=await Promise.all([
      import(root+'firebase-app.js'),import(root+'firebase-auth.js'),import(root+'firebase-database.js')
    ]);
    ({get,ref,set,onValue,runTransaction}=dbModule);
    const app=appModule.initializeApp(config);
    database=dbModule.getDatabase(app);
    const auth=authModule.getAuth(app);
    const existing=await new Promise((resolve,reject)=>{const unsub=authModule.onAuthStateChanged(auth,u=>{unsub();resolve(u);},reject);});
    if(!existing)await authModule.signInAnonymously(auth);
    unsubscribeConnection=onValue(ref(database,'.info/connected'),snap=>{
      online=Boolean(snap.val());
      if(roomCode)message(online?'Connected · Both phones are synchronized.':'Reconnecting… Live controls disabled until online.');
      else message(online?'Ready · Create a live room, then share the invitation.':'Firebase connected, waiting for network.');
      updateVisual();
    });
    // Auto-rejoin after refresh or after opening another device's invitation.
    const params=new URL(location.href).searchParams;
    const requested=normalized(params.get('live'));
    let saved='';try{saved=normalized(localStorage.getItem('photo-roulette-last-live-room'));}catch(e){}
    const target=CODE_RE.test(requested)?requested:(CODE_RE.test(saved)?saved:'');
    if(target)await enterRoom(target);
  }catch(e){fail(e);disableLiveButtons(true);}
}
