// A fresh browser context blocks Google Fonts and holds local font files.
// The page must paint with fallback text before any font response is released.
async page=>{
 const base=new URL(page.url()).origin;
 const context=await page.context().browser().newContext({viewport:{width:1440,height:1000}});
 const probe=await context.newPage();
 let external=0,local=0,release,seen;
 const gate=new Promise(r=>release=r),firstFont=new Promise(r=>seen=r);
 const errors=[];probe.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)){external++;return route.abort();}
  if(route.request().resourceType()==='font'&&u.origin===base){local++;seen();await gate;}
  return route.continue().catch(()=>{});
 });
 try{
  await probe.goto(base+'/login',{waitUntil:'domcontentloaded'});
  await firstFont;
  await probe.waitForFunction(()=>performance.getEntriesByType('paint').some(p=>p.name==='first-contentful-paint'));
  const firstPaint=await probe.evaluate(()=>Math.round(performance.getEntriesByName('first-contentful-paint')[0].startTime));
  if(external||!local)throw Error('Fonts are not served locally');
  release();await probe.evaluate(()=>document.fonts.ready);
  if(!await probe.evaluate(()=>document.fonts.check('400 13px "Be Vietnam Pro"')))throw Error('Local font did not load');
  if(errors.length)throw Error(errors.join('; '));
  return {result:'PASS',firstPaintMs:firstPaint,paintBeforeFontResponses:true,externalFontRequests:external,localFontRequests:local};
 }finally{release();await context.close();}
}
