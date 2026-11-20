// Living Music Hub Studio — browser-based recording and live mixing tools.
// Audio stays in the browser until the user chooses to export or submit it.
const $ = (id) => document.getElementById(id);
const studio = {
  ctx: null, master: null, micGain: null, keysGain: null, drumsGain: null,
  recordDest: null, micStream: null, micSource: null, recorder: null,
  chunks: [], lastBlob: null, lastUrl: null, oscillators: new Set(),
  sequencerTimer: null, step: 0, bpm: 110, isRecording: false,
  pattern: {
    kick:  [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
    snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],
    hat:   [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],
    clap:  [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
  }
};
const notes = [
  ['C4',261.63],['D4',293.66],['E4',329.63],['F4',349.23],['G4',392.00],['A4',440.00],['B4',493.88],['C5',523.25],
  ['D5',587.33],['E5',659.25],['F5',698.46],['G5',783.99]
];
function status(text, bad=false) { const el=$('studioStatus'); if(el){el.textContent=text;el.classList.toggle('error',bad);} }
function ensureAudio() {
  if (!studio.ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('This browser does not support the music studio audio engine. Please use a recent version of Chrome.');
    studio.ctx = new Ctx();
    studio.master = studio.ctx.createGain();
    studio.micGain = studio.ctx.createGain();
    studio.keysGain = studio.ctx.createGain();
    studio.drumsGain = studio.ctx.createGain();
    studio.recordDest = studio.ctx.createMediaStreamDestination();
    studio.micGain.connect(studio.master);
    studio.keysGain.connect(studio.master);
    studio.drumsGain.connect(studio.master);
    studio.master.connect(studio.ctx.destination);
    studio.master.connect(studio.recordDest);
    studio.master.gain.value = Number($('mixMaster').value)/100;
    studio.micGain.gain.value = Number($('mixMic').value)/100;
    studio.keysGain.gain.value = Number($('mixKeys').value)/100;
    studio.drumsGain.gain.value = Number($('mixDrums').value)/100;
  }
  if (studio.ctx.state === 'suspended') studio.ctx.resume();
  return studio.ctx;
}
function tone(freq, duration=.22, type='triangle', target=studio.keysGain, peak=.22) {
  const ctx=ensureAudio(); target = target || studio.keysGain; const osc=ctx.createOscillator(), amp=ctx.createGain(), now=ctx.currentTime;
  osc.type=type; osc.frequency.setValueAtTime(freq,now);
  amp.gain.setValueAtTime(.0001,now); amp.gain.exponentialRampToValueAtTime(peak,now+.012); amp.gain.exponentialRampToValueAtTime(.0001,now+duration);
  osc.connect(amp); amp.connect(target); osc.start(now); osc.stop(now+duration+.03);
  studio.oscillators.add(osc); osc.onended=()=>studio.oscillators.delete(osc);
}
function noiseBuffer(seconds=.25) {
  const ctx=ensureAudio(), buffer=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*seconds),ctx.sampleRate), data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
  return buffer;
}
function drum(kind) {
  const ctx=ensureAudio(), now=ctx.currentTime;
  if(kind==='kick') {
    const osc=ctx.createOscillator(), amp=ctx.createGain(); osc.type='sine'; osc.frequency.setValueAtTime(145,now); osc.frequency.exponentialRampToValueAtTime(42,now+.18);
    amp.gain.setValueAtTime(.9,now); amp.gain.exponentialRampToValueAtTime(.001,now+.34); osc.connect(amp); amp.connect(studio.drumsGain); osc.start(now); osc.stop(now+.36);
  } else {
    const src=ctx.createBufferSource(), filter=ctx.createBiquadFilter(), amp=ctx.createGain(); src.buffer=noiseBuffer(kind==='hat'?.09:.24);
    filter.type='highpass'; filter.frequency.value=kind==='hat'?6500:kind==='clap'?1200:1400;
    amp.gain.setValueAtTime(kind==='hat'?.28:.55,now); amp.gain.exponentialRampToValueAtTime(.001,now+(kind==='hat'?.075:.22));
    src.connect(filter); filter.connect(amp); amp.connect(studio.drumsGain); src.start(now); src.stop(now+(kind==='hat'?.1:.25));
    if(kind==='snare') tone(180,.08,'triangle',studio.drumsGain,.13);
    if(kind==='clap') { [0,.035,.07].forEach((d)=>{const s=ctx.createBufferSource(),g=ctx.createGain();s.buffer=noiseBuffer(.07);g.gain.value=.23;s.connect(g);g.connect(studio.drumsGain);s.start(now+d);}); }
  }
  const pad=$(`[data-drum="${kind}"]`); if(pad){pad.classList.add('hit');setTimeout(()=>pad.classList.remove('hit'),100);}
}
function buildKeyboard() {
  const root=$('keyboardKeys'); if(!root) return;
  root.innerHTML=notes.map(([name,freq],i)=>`<button type="button" class="piano-key ${name.includes('#')?'black':''}" data-frequency="${freq}" aria-label="Play ${name}"><span>${name}</span></button>`).join('');
  root.querySelectorAll('[data-frequency]').forEach((key)=>{
    const start=(ev)=>{ev.preventDefault();key.classList.add('pressed');tone(Number(key.dataset.frequency),.45,'triangle',studio.keysGain,.2);};
    key.addEventListener('pointerdown',start);
    key.addEventListener('pointerup',()=>key.classList.remove('pressed'));
    key.addEventListener('pointerleave',()=>key.classList.remove('pressed'));
    key.addEventListener('contextmenu',(ev)=>ev.preventDefault());
  });
}
function buildSequencer() {
  document.querySelectorAll('.step-row').forEach((row)=>{
    const kind=row.dataset.instrument, grid=row.querySelector('.steps');
    grid.innerHTML=Array.from({length:16},(_,i)=>`<button type="button" class="step ${studio.pattern[kind][i]?'on':''}" data-step="${i}" aria-label="${kind} step ${i+1}" aria-pressed="${!!studio.pattern[kind][i]}"></button>`).join('');
    grid.querySelectorAll('[data-step]').forEach((button)=>button.addEventListener('click',()=>{
      const i=Number(button.dataset.step);studio.pattern[kind][i]=studio.pattern[kind][i]?0:1;
      button.classList.toggle('on',!!studio.pattern[kind][i]);button.setAttribute('aria-pressed',String(!!studio.pattern[kind][i]));
    }));
  });
}
function sequencerTick() {
  const step=studio.step%16;
  for(const kind of ['kick','snare','hat','clap']) if(studio.pattern[kind][step]) drum(kind);
  document.querySelectorAll('.step').forEach((el)=>el.classList.toggle('current',Number(el.dataset.step)===step));
  studio.step=(step+1)%16;
}
function startBeat() {
  ensureAudio(); stopBeat(); studio.step=0; sequencerTick();
  const interval=(60/studio.bpm/4)*1000;
  studio.sequencerTimer=setInterval(sequencerTick,interval);
  $('beatPlay').textContent='Stop beat'; status(`Beat playing at ${studio.bpm} BPM. Start recording to capture it.`);
}
function stopBeat() {
  if(studio.sequencerTimer) clearInterval(studio.sequencerTimer);
  studio.sequencerTimer=null; $('beatPlay').textContent='Play beat';
  document.querySelectorAll('.step').forEach((el)=>el.classList.remove('current'));
}
async function toggleMic() {
  try {
    ensureAudio();
    if(studio.micStream){studio.micStream.getTracks().forEach(t=>t.stop());studio.micStream=null;studio.micSource?.disconnect();studio.micSource=null;$('micToggle').textContent='Enable microphone';status('Microphone turned off.');return;}
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires HTTPS and a supported browser.');
    studio.micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    studio.micSource=studio.ctx.createMediaStreamSource(studio.micStream);studio.micSource.connect(studio.micGain);
    $('micToggle').textContent='Turn microphone off';status('Microphone is live. Use headphones to avoid feedback while recording.');
  } catch(e){status(e.message||'Could not access the microphone.',true);}
}
function chooseRecorderType() {
  if(!window.MediaRecorder) throw new Error('Audio recording is not supported by this browser. Please use Chrome on Android or desktop.');
  const choices=['audio/webm;codecs=opus','audio/webm','audio/mp4'];
  return choices.find(t=>MediaRecorder.isTypeSupported(t))||'';
}
async function makeWav(blob) {
  const ctx = ensureAudio();
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  const targetRate = 22050, channels = 1;
  const ratio = decoded.sampleRate / targetRate;
  const frames = Math.floor(decoded.length / ratio);
  const wav = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(wav);
  const write = (offset, value) => { for (let i=0;i<value.length;i++) view.setUint8(offset+i,value.charCodeAt(i)); };
  write(0,'RIFF'); view.setUint32(4,36+frames*2,true); write(8,'WAVE'); write(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,channels,true);
  view.setUint32(24,targetRate,true); view.setUint32(28,targetRate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
  write(36,'data'); view.setUint32(40,frames*2,true);
  const inputL=decoded.getChannelData(0), inputR=decoded.numberOfChannels>1?decoded.getChannelData(1):inputL;
  let offset=44;
  for(let i=0;i<frames;i++){
    const pos=i*ratio, a=Math.floor(pos), b=Math.min(a+1,decoded.length-1), frac=pos-a;
    const left=inputL[a]+(inputL[b]-inputL[a])*frac, right=inputR[a]+(inputR[b]-inputR[a])*frac;
    const sample=Math.max(-1,Math.min(1,(left+right)*.5));
    view.setInt16(offset,sample<0?sample*0x8000:sample*0x7fff,true);offset+=2;
  }
  return new Blob([wav],{type:'audio/wav'});
}
function startRecording() {
  try {
    ensureAudio(); const mimeType=chooseRecorderType();
    studio.chunks=[];studio.lastBlob=null;
    studio.recorder=new MediaRecorder(studio.recordDest.stream,mimeType?{mimeType}:undefined);
    studio.recorder.ondataavailable=(e)=>{if(e.data?.size)studio.chunks.push(e.data);};
    studio.recorder.onstop=async()=>{
      try {
        const raw=new Blob(studio.chunks,{type:studio.recorder.mimeType||'audio/webm'});
        status('Preparing your studio mix as a mobile-friendly WAV file…');
        studio.lastBlob=await makeWav(raw);
        if(studio.lastUrl)URL.revokeObjectURL(studio.lastUrl);studio.lastUrl=URL.createObjectURL(studio.lastBlob);
        $('studioPreview').src=studio.lastUrl;$('studioPreviewWrap').classList.remove('hidden');
        $('recordingInfo').textContent=`WAV mix ready · ${(studio.lastBlob.size/1024/1024).toFixed(2)} MB · 22.05 kHz mono`;
        $('downloadMix').href=studio.lastUrl;$('downloadMix').download='living-music-hub-studio-mix.wav';
        $('useMix').disabled=false;status('Recording finished. Your WAV mix can be previewed, downloaded or submitted as a song.');
      } catch(e) { status(`Could not convert the recording: ${e.message||'unsupported audio format'}`,true); }
    };
    studio.recorder.start(250);studio.isRecording=true;
    $('recordStart').disabled=true;$('recordStop').disabled=false;status('Recording your live mix. Play the keyboard, trigger drum pads or start the beat.');
  }catch(e){status(e.message||'Could not start recording.',true);}
}
function stopRecording() {
  if(studio.recorder&&studio.recorder.state!=='inactive'){studio.recorder.stop();studio.isRecording=false;}
  $('recordStart').disabled=false;$('recordStop').disabled=true;
}
function useMixForUpload() {
  if(!studio.lastBlob)return;
  const ext='wav';
  const file=new File([studio.lastBlob],`living-music-hub-studio-mix.${ext}`,{type:'audio/wav'});
  const input=$('uploadForm')?.elements.audio;
  if(!input)return;
  const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;
  document.querySelector('#upload').scrollIntoView({behavior:'smooth'});
  const title=$('uploadForm').elements.title;if(title&&!title.value)title.value='My Studio Recording';
  const note=$('uploadStatus');if(note)note.textContent='Studio mix attached. Add your song details and rights confirmation, then submit for review.';
}
function bindMixers() {
  [['mixMaster','master'],['mixMic','micGain'],['mixKeys','keysGain'],['mixDrums','drumsGain']].forEach(([id,key])=>$(id).addEventListener('input',e=>{
    if(studio[key])studio[key].gain.setTargetAtTime(Number(e.target.value)/100,studio.ctx.currentTime,.015);
    $(`${id}Value`).textContent=`${e.target.value}%`;
  }));
}
function init() {
  buildKeyboard();buildSequencer();bindMixers();
  document.querySelectorAll('[data-drum]').forEach(p=>p.addEventListener('pointerdown',e=>{e.preventDefault();drum(p.dataset.drum);}));
  $('micToggle').addEventListener('click',toggleMic);
  $('beatPlay').addEventListener('click',()=>studio.sequencerTimer?stopBeat():startBeat());
  $('bpm').addEventListener('input',e=>{studio.bpm=Number(e.target.value);$('bpmValue').textContent=`${studio.bpm} BPM`;if(studio.sequencerTimer)startBeat();});
  $('recordStart').addEventListener('click',startRecording);$('recordStop').addEventListener('click',stopRecording);$('useMix').addEventListener('click',useMixForUpload);
  $('downloadMix').addEventListener('click',()=>{if(!studio.lastBlob)status('Make a recording first.',true);});
  window.addEventListener('beforeunload',()=>{stopBeat();studio.micStream?.getTracks().forEach(t=>t.stop());});
}
init();
