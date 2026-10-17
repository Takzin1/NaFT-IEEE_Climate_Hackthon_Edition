// Capture REAL public-browser interactions for the IEEE ClimateChain 2026 demo.
// No synthetic images, no transaction signing, no private keys, no mock Etherscan.
// Playwright records the browser page, not a slideshow of screenshots.
import { chromium } from 'playwright';
import { mkdir, copyFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const mode = process.env.NAFT_VIDEO_MODE || 'preview';
if (!['preview','full'].includes(mode)) throw Error('NAFT_VIDEO_MODE must be preview or full');
const showExplorer = mode === 'full' && process.env.NAFT_VIDEO_EXPLORER === '1';
const output = resolve(process.env.NAFT_VIDEO_OUTPUT || 'video-output');
const url = 'https://takzin1.github.io/NaFT-IEEE_Climate_Hackthon_Edition/#/climatechain';
const sleep = ms => new Promise(done => setTimeout(done, ms));
const totalSeconds = mode === 'full' ? 250 : 24;
const weights = [25,25,45,30,50,30,30,15];
const sceneSeconds = mode === 'full' ? weights : weights.map(() => 3);
const timeline = [], errors = [];
let context, browser, page, recording;
await mkdir(output,{recursive:true});

const mark = message => { console.log('[NaFT video] '+message); };
async function scene(name,index,action) {
  const at = performance.now(), started = Date.now();
  mark('Scene '+(index+1)+'/8: '+name);
  await action();
  const elapsed = performance.now()-at;
  const remaining = sceneSeconds[index]*1000-elapsed;
  if(remaining>0) await sleep(remaining);
  timeline.push({scene:index+1,name,started_at:new Date(started).toISOString(),
    duration_seconds:Math.round((performance.now()-at)/100)/10});
}
async function focus(selector,ms=700){
  await page.locator(selector).first().waitFor({state:'attached',timeout:15000});
  await page.evaluate(async ({selector,ms}) => {
    const el=document.querySelector(selector);
    if(!el)throw Error('FOCUS_ELEMENT_MISSING:'+selector);
    const origin=window.scrollY;
    const top=origin+el.getBoundingClientRect().top-
      Math.max(50,(window.innerHeight-Math.min(500,el.getBoundingClientRect().height))/2);
    const target=Math.max(0,Math.min(top,document.documentElement.scrollHeight-innerHeight));
    if(Math.abs(target-origin)<3)return;
    await new Promise(resolve=>{
      const start=performance.now();
      function frame(now){
        const t=Math.min(1,(now-start)/ms);
        const eased=t*t*(3-2*t);
        window.scrollTo(0,origin+(target-origin)*eased);
        if(t<1)requestAnimationFrame(frame);else resolve();
      }
      requestAnimationFrame(frame);
    });
  },{selector,ms});
}
async function assertion(){
  await page.locator('.climate-impact .metric strong').first().waitFor({timeout:20000});
  const numbers=await page.locator('.climate-impact .metric strong').allTextContents();
  const actual=numbers.map(s=>s.trim());
  const expected=['100','30','70','15','15'];
  if(JSON.stringify(actual)!==JSON.stringify(expected))
    throw Error('LIVE_IMPACT_VALUES_MISMATCH:'+JSON.stringify(actual));
}
async function rerun(){
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('button[data-action="climatechain-run"]').waitFor({timeout:20000});
  await page.locator('button[data-action="climatechain-run"]').click();
  await assertion();
}
browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage','--no-sandbox']});
try{
  context=await browser.newContext({
    viewport:{width:1920,height:1080},deviceScaleFactor:1,locale:'en-US',
    colorScheme:'light', reducedMotion:'reduce',acceptDownloads:false,
    recordVideo:{dir:output,size:{width:1920,height:1080}}
  });
  page=await context.newPage();
  recording=page.video();
  page.on('pageerror',error=>errors.push(String(error.message)));
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('.climate-hero').waitFor({timeout:20000});
  const brand=page.locator('.climate-corner-logo img');
  await brand.waitFor();
  if(!await brand.evaluate(x=>x.complete&&x.naturalWidth>0))throw Error('PUBLIC_LOGO_NOT_LOADED');
  if(!await page.getByText('VERIFIED TESTNET').first().isVisible())throw Error('TESTNET_STATUS_NOT_VISIBLE');

  await scene('NaFT identity and problem',0,async()=>{
    await focus('.climate-hero',300);
  });
  await scene('Fictional MRV aggregator problem',1,async()=>{
    await focus('.climate-scenario',900);
  });
  await scene('Real 100-claim computation',2,async()=>{
    await focus('.climate-hero',750);
    await page.locator('button[data-action="climatechain-run"]').click();
    await assertion();
    await focus('.climate-impact .metric-grid',1300);
  });
  await scene('Explain CLIMATE-086 synthetic trace',3,async()=>{
    await page.locator('button[data-claim-id="CLIMATE-086"]').click();
    await page.locator('.climate-trace-header h3').getByText('CLIMATE-086').waitFor();
    await focus('.climate-trace',950);
    const detail=page.locator('.climate-impact details').first();
    await detail.locator('summary').click();
    await focus('.climate-impact details',800);
  });
  await scene('Prepare local anchor plan and inspect real Sepolia evidence',4,async()=>{
    await page.locator('button[data-action="climatechain-anchor-plan"]').click();
    await page.locator('.climate-anchor').waitFor();
    const label=await page.locator('.climate-anchor').innerText();
    if(!label.includes('NOT_SUBMITTED')||!label.includes('VERIFIED TESTNET'))
      throw Error('ANCHOR_STATUS_INCORRECT');
    const p2=await page.locator('.climate-anchor .climate-chain-links a')
      .filter({hasText:'P2 Tx'}).first().getAttribute('href');
    if(!/^https:\/\/sepolia\.etherscan\.io\/tx\/0x[0-9a-fA-F]{64}$/.test(p2||''))
      throw Error('PUBLIC_P2_TRANSACTION_LINK_INVALID');
    await focus('.climate-anchor',900);
    if(showExplorer){
      // Display actual transaction ONLY if the real public explorer loads.
      // Restore the browser demo afterward so subsequent scenes are genuine.
      try {
        await sleep(4500);
        await page.goto(p2,{waitUntil:'domcontentloaded',timeout:14000});
        const body=await page.locator('body').innerText({timeout:5000});
        if(!body.toLowerCase().includes('0xb5aef981'))
          throw Error('REAL_EXPLORER_TRANSACTION_TEXT_NOT_VERIFIED');
        mark('Real Sepolia P2 transaction visible in browser.');
        await sleep(8000);
      } catch(e) {
        mark('Real explorer could not be verified; returning to public app: '+e.message);
      } finally {
        await rerun();
        await page.locator('button[data-action="climatechain-anchor-plan"]').click();
        await page.locator('.climate-anchor').waitFor();
      }
    }
  });
  await scene('Architecture and trust boundary',5,async()=>{
    await focus('.climate-architecture',1000);
    await page.locator('.climate-architecture img').evaluate(async img=>{
      if(img.complete&&img.naturalWidth)return;
      await new Promise((resolve,reject)=>{
        img.addEventListener('load',resolve,{once:true});
        img.addEventListener('error',()=>reject(Error('ARCHITECTURE_IMAGE_FAILED')),{once:true});
      });
    });
    if(mode === 'full') {
      await focus('.climate-architecture img',500);
      await sleep(18000);
    }
    await focus('.climate-trust',850);
  });
  await scene('614-case synthetic engineering evaluation',6,async()=>{
    await focus('.climate-engineering',1200);
    const info=await page.locator('.climate-engineering').innerText();
    if(!info.includes('614')||!info.includes('False negatives'))
      throw Error('ENGINEERING_EVIDENCE_NOT_VISIBLE');
  });
  await scene('Closing on real NaFT logo',7,async()=>{
    await focus('.climate-hero',1100);
  });
  if(errors.length)throw Error('BROWSER_EXCEPTIONS:'+JSON.stringify(errors));
  mark('All 8 real browser scenes passed.');
}finally{
  if(context)await context.close();
  if(browser)await browser.close();
}
const source=await recording.path();
const saved=join(output,'NaFT_IEEE_ClimateChain_raw.webm');
await copyFile(source,saved);
const meta={mode,actual_scene_seconds:timeline.reduce((a,x)=>a+x.duration_seconds,0),
  target_seconds:totalSeconds,url,width:1920,height:1080,
  synthetic_fixture:true,real_explorer_requested:showExplorer,
  onchain_claim:'Hash lineage only, not certification',
  timeline,recording_bytes:(await stat(saved)).size};
await writeFile(join(output,'NaFT_IEEE_recording_manifest.json'),
  JSON.stringify(meta,null,2)+'\n','utf8');
mark('Raw real-browser recording written: '+saved);
