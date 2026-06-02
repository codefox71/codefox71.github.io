class RelayCPU {
  constructor(opts={}){
    this.mem = new Uint8Array(5); // 5 words, 4-bit each
    this.acc = 0; // 4-bit accumulator
    this.regs = new Uint8Array(4); // 4 regs, 2-bit values (0-3)
    this.ip = 0;
    this.program = [];
    this.running = false;
    this.serial = [];
    this.relays = new Array(12).fill(false);
    this.onTick = null;
    this.audioCtx = null;
    this.soundEnabled = true;
    this.volume = 0.8;
  }

  reset(){
    this.mem.fill(0);
    this.acc = 0;
    this.regs.fill(0);
    this.ip = 0;
    this.serial = [];
    this.relays.fill(false);
    this.program = [];
  }

  mask4(v){ return v & 0xF }

  step(){
    if(this.ip < 0 || this.ip >= this.program.length) return false;
    const instr = this.program[this.ip++];
    this.execute(instr);
    if(this.onTick) this.onTick(instr);
    return true;
  }

  run(ms){
    if(this.running) return;
    this.running = true;
    const loop = async () => {
      while(this.running){
        const ok = this.step();
        if(!ok) break;
        await new Promise(r=>setTimeout(r,ms));
      }
      this.running = false;
    }
    loop();
  }

  stop(){ this.running = false }

  execute(instr){
    const op = instr.op.toUpperCase();
    const a = instr.a, b = instr.b;
    const regval = r => this.regs[r] & 0x3;
    const valOf = token => {
      if(token == null) return 0;
      if(token.type==='imm') return this.mask4(token.value);
      if(token.type==='acc') return this.acc;
      if(token.type==='reg') return regval(token.value);
      if(token.type==='mem') return this.mem[token.value] & 0xF;
      return 0;
    }

    const writeTo = (token, value) => {
      value = this.mask4(value);
      if(token.type==='acc'){ this.acc = value }
      else if(token.type==='reg'){ this.regs[token.value] = value & 0x3 }
      else if(token.type==='mem'){ this.mem[token.value] = value & 0xF }
    }

    const aluApply = (fn, rindex)=>{
      const rv = regval(rindex);
      const res = fn(this.acc, rv);
      this.acc = this.mask4(res);
    }

    switch(op){
      case 'MVI':
        writeTo(a, valOf(b));
        break;
      case 'MOV':
        writeTo(a, valOf(b));
        break;
      case 'CLR':
        this.acc = 0; break;
      case 'LAR':
        // load accumulator from register
        if(a && a.type==='reg') this.acc = this.mask4(this.regs[a.value]);
        break;
      case 'RDT':
        // read last serial into acc
        if(this.serial.length) this.acc = this.mask4(this.serial[this.serial.length-1]);
        else this.acc = 0;
        break;
      case 'WRB':
        // write value or reg to serial
        const out = valOf(a);
        this.serial.push(this.mask4(out));
        break;
      case 'ADD': aluApply((x,y)=>x+y, a.value); break;
      case 'MUL': aluApply((x,y)=>x*y, a.value); break;
      case 'SUB': aluApply((x,y)=>x-y, a.value); break;
      case 'NAND': aluApply((x,y)=>~(x & y), a.value); break;
      case 'XOR': aluApply((x,y)=>x ^ y, a.value); break;
      default:
        // unknown -> ignore
        break;
    }
    // flip some relays for visual
    this.pulseRelays();
  }

  pulseRelays(){
    for(let i=0;i<this.relays.length;i++) this.relays[i] = Math.random() > 0.6;
    this.playRelaySound(Math.random());
  }
  playRelaySound(strength=0.8){
    if(!this.soundEnabled) return;
    try{
      if(!this.audioCtx) this.audioCtx = new (window.AudioContext||window.webkitAudioContext)();
      const ctx = this.audioCtx;
      const now = ctx.currentTime;

      // main click oscillator (fast pitch envelope)
      const o = ctx.createOscillator(); o.type='square'; o.frequency.value = 1400 + (strength*1200);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.00001, now);
      o.connect(g);

      // mechanical resonance (sine, short)
      const r = ctx.createOscillator(); r.type='sine'; r.frequency.value = 220 + Math.random()*80;
      const rg = ctx.createGain(); rg.gain.setValueAtTime(0.00001, now);
      r.connect(rg);

      // subtle noise for mechanical clack
      const bufferSize = 2*ctx.sampleRate; const noiseBuf = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for(let i=0;i<bufferSize;i++) data[i] = (Math.random()*2-1) * (Math.random()*0.6);
      const nb = ctx.createBufferSource(); nb.buffer = noiseBuf; nb.loop = false;
      const nf = ctx.createBiquadFilter(); nf.type='highpass'; nf.frequency.value=800;
      nb.connect(nf);

      // mix
      const mix = ctx.createGain(); mix.gain.value = 0.6 * (this.volume || 1);
      g.connect(mix); rg.connect(mix); nf.connect(mix);
      mix.connect(ctx.destination);

      // envelopes
      g.gain.exponentialRampToValueAtTime(0.06 * (0.6+strength*0.6), now+0.002);
      g.gain.exponentialRampToValueAtTime(0.00001, now+0.12);
      rg.gain.exponentialRampToValueAtTime(0.02, now+0.005);
      rg.gain.exponentialRampToValueAtTime(0.00001, now+0.18);

      o.start(now); o.stop(now+0.12);
      r.start(now); r.stop(now+0.18);
      nb.start(now); nb.stop(now+0.12);
    }catch(e){/* ignore audio errors */}
  }
}

// --- Assembler / parser ---
function parseProgram(txt){
  const lines = txt.split(/\r?\n/).map(l=>l.replace(/;.*$/,'').trim()).filter(Boolean);
  const program = [];
  for(const raw of lines){
    const parts = raw.replace(/,/g,' ').split(/\s+/);
    const op = parts[0].toUpperCase();
    const args = parts.slice(1);
    const node = {op, a:null, b:null, raw};
    const tok = t=>{
      if(!t) return null;
      if(/^A$/i.test(t)) return {type:'acc'};
      if(/^R([0-3])$/i.test(t)){ return {type:'reg', value:parseInt(t[1],10)} }
      if(/^M([0-4])$/i.test(t)){ return {type:'mem', value:parseInt(t[1],10)} }
      if(/^0x[0-9a-f]+$/i.test(t)) return {type:'imm', value:parseInt(t,16)};
      if(/^[0-9]+$/i.test(t)) return {type:'imm', value:parseInt(t,10)};
      return {type:'imm', value:0};
    }
    if(op==='MVI' || op==='MOV'){
      node.a = tok(args[0]); node.b = tok(args[1]);
    }else if(op==='CLR' || op==='RDT'){
      // no args
    }else if(op==='LAR'){
      node.a = tok(args[0]);
    }else if(op==='WRB'){
      node.a = tok(args[0]);
    }else if(['ADD','MUL','SUB','NAND','XOR'].includes(op)){
      node.a = tok(args[0]);
    }
    program.push(node);
  }
  return program;
}

// --- UI wiring ---
(function(){
  const cpu = new RelayCPU();
  const accVal = document.getElementById('accVal');
  const memList = document.getElementById('memList');
  const regsEl = document.getElementById('regs');
  const consoleEl = document.getElementById('console');
  const serialOut = document.getElementById('serialOut');
  const relaysEl = document.getElementById('relays');

  function render(){
    accVal.textContent = '0x'+cpu.acc.toString(16).toUpperCase();
    memList.innerHTML = '';
    for(let i=0;i<5;i++){
      const d = document.createElement('div'); d.className='memitem';
      d.innerHTML = `<div style="font-size:12px;color:var(--muted)">M${i}</div><div style="font-family:monospace">${('0x'+(cpu.mem[i]&0xF).toString(16).toUpperCase())}</div>`;
      memList.appendChild(d);
    }
    regsEl.innerHTML = '';
    for(let i=0;i<4;i++){
      const r = document.createElement('div'); r.className='reg';
      r.innerHTML = `<div style="font-size:12px;color:var(--muted)">R${i}</div><div style="font-family:monospace">${cpu.regs[i]&0x3}</div>`;
      regsEl.appendChild(r);
    }
    serialOut.textContent = cpu.serial.map(v=>('0x'+(v&0xF).toString(16).toUpperCase())).join(' ');

    // relays
    relaysEl.innerHTML = '';
    cpu.relays.forEach((on,i)=>{
      const r = document.createElement('div'); r.className='relay';
      r.style.opacity = on? '1':'0.35';
      r.textContent = 'R'+(i+1);
      relaysEl.appendChild(r);
    })
    // animate relays for tactile effect
    setTimeout(()=>{
      const nodes = relaysEl.querySelectorAll('.relay');
      nodes.forEach((n,i)=>{
        const on = cpu.relays[i];
        if(on){ n.classList.add('on'); n.style.transform = `translateY(-2px) rotateZ(${(Math.random()-0.5)*2}deg)`; }
        else { n.classList.remove('on'); n.style.transform = `translateY(0px) rotateZ(0deg)`; }
      });
    }, 20);
  }

  // schematic modal and wiring
  const schematicBtn = document.getElementById('schematicBtn');
  const schematicModal = document.getElementById('schematicModal');
  const schematicContainer = document.getElementById('schematicContainer');
  const closeSchematic = document.getElementById('closeSchematic');
  async function openSchematic(){
    schematicModal.setAttribute('aria-hidden','false');
    try{ const svg = await fetch('assets/schematic.svg').then(r=>r.text()); schematicContainer.innerHTML = svg; }
    catch(e){ schematicContainer.textContent = 'Failed to load schematic.' }
  }
  function closeModal(){ schematicModal.setAttribute('aria-hidden','true'); }
  schematicBtn.addEventListener('click', openSchematic);
  closeSchematic.addEventListener('click', closeModal);
  schematicModal.querySelector('.modal-backdrop').addEventListener('click', closeModal);

  cpu.onTick = (instr)=>{
    consoleEl.textContent = (instr? instr.raw : '') + '\n' + consoleEl.textContent;
    render();
  }

  document.getElementById('stepBtn').addEventListener('click', ()=>{ cpu.step(); render(); });
  document.getElementById('runBtn').addEventListener('click', ()=>{
    const ms = parseInt(document.getElementById('speed').value,10)||500; cpu.run(ms);
  });
  document.getElementById('stopBtn').addEventListener('click', ()=>{ cpu.stop(); });
  document.getElementById('resetBtn').addEventListener('click', ()=>{ cpu.reset(); render(); consoleEl.textContent=''; });

  document.getElementById('assemble').addEventListener('click', ()=>{
    const txt = document.getElementById('program').value; cpu.program = parseProgram(txt); cpu.ip=0; consoleEl.textContent='Program loaded'; render();
  });

  document.getElementById('loadProg').addEventListener('click', ()=>{
    // sample program
    const sample = `; Sample: write values to serial
MVI A, 0x5
WRB A
MVI R0, 2
LAR R0
ADD R0
WRB A
CLR
`;
    document.getElementById('program').value = sample; 
  });

  document.getElementById('clrSerial').addEventListener('click', ()=>{ cpu.serial = []; render(); });

  document.getElementById('downloadBtn').addEventListener('click', async ()=>{
    // create a single-file standalone HTML from current css and js
    const css = await fetch('css/styles.css').then(r=>r.text());
    const js = await fetch('js/main.js').then(r=>r.text());
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>4-bit Relay CPU</title><style>${css}</style></head><body>${document.documentElement.querySelector('body').innerHTML.replace(/<script[\s\S]*<\/script>/,'')}<script>${js}</script></body></html>`;
    const blob = new Blob([html], {type:'text/html'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = '4bit-relay-cpu.html'; a.click(); URL.revokeObjectURL(url);
  });

  // power button toggles audio permission simulation
  document.getElementById('powerBtn').addEventListener('click', async ()=>{
    try{ if(!cpu.audioCtx) cpu.audioCtx = new (window.AudioContext||window.webkitAudioContext)(); await cpu.audioCtx.resume(); console.log('Audio ready'); }
    catch(e){console.log('Audio blocked')}
  });

  // volume control
  const volEl = document.getElementById('volume');
  if(volEl){ volEl.addEventListener('input', (e)=>{ cpu.volume = parseFloat(e.target.value || '0.8'); }); volEl.value = cpu.volume; }

  // initial render + sample program
  document.getElementById('program').value = `; Example program\nMVI A, 0x7\nWRB A\nMVI R1, 3\nADD R1\nWRB A`;
  render();
})();
