// Run through Playwright CLI on an authenticated local or production page.
// Provider mutations are intercepted; this never saves a key or deploys a real chatbot.
async page => {
  const base = new URL(page.url()).origin, errors = [], deployed = [], models = [{id:'openai/gpt-oss-20b',contextWindow:131072,maxCompletionTokens:65536}];
  const baselineResponse=await page.request.get(base+'/api/workspace/state');
  if(!baselineResponse.ok())throw new Error('Workspace baseline unavailable');
  const baseline=await baselineResponse.json();
  let configured = false, example = false;
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if(m.type()==='error')errors.push(m.text()); });
  await page.route('**/api/**',async route => {
    const req=route.request(),path=new URL(req.url()).pathname;
    if(path==='/api/workspace/prices')return route.fulfill({json:{fetchedAt:Date.now(),gpus:[]}});
    if(path==='/api/workspace/groq/credential') {
      if(req.method()==='POST')configured=!!req.postDataJSON().apiKey;
      return route.fulfill({json:{configured,masked:configured?'••••test':''}});
    }
    if(path==='/api/workspace/groq/models')return route.fulfill({json:{models}});
    if(path==='/api/workspace/groq/deploy') { deployed.push(req.postDataJSON());example=true;return route.fulfill({status:201,json:{id:'00000000-0000-4000-8000-0000000000ab'}}); }
    if(req.method()==='POST')return route.fulfill({status:409,json:{error:'Mutation blocked by browser QA'}});
    if(path==='/api/workspace/state') {
      const state=structuredClone(baseline);
      if(example)state.chatGroups.push({id:'00000000-0000-4000-8000-0000000000ab',name:'Groq browser QA',provider:'groq',model:models[0].id,roundId:deployed[0].roundId,
        scope:'all',teamId:null,paused:false,canManage:true,chatbotEnabled:true,workspaceIds:[],templateId:'qa',ready:1,readySlots:2,total:0,estimatedUsd:0,hourlyUsd:0,queue:{queued:0,running:0,oldestQueuedAt:null,uncertain:[]}});
      return route.fulfill({json:state});
    }
    return route.continue();
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/#workspace');
  await page.getByLabel('Nhà cung cấp khi cấp phát').selectOption('groq');
  await page.getByLabel('Groq API key',{exact:true}).fill('gsk_browser_qa_fake_key_test');
  await page.getByRole('button',{name:'Kiểm tra và lưu khóa',exact:true}).click();
  await page.getByLabel('Model Groq',{exact:true}).selectOption(models[0].id);
  if(await page.getByLabel('Groq API key',{exact:true}).inputValue()!=='')throw new Error('Key remains in input after save');
  await page.getByLabel('Tên chatbot',{exact:true}).fill('Groq browser QA');
  await page.getByRole('button',{name:'Cấp Chatbot Groq',exact:true}).click();
  const card=page.locator('.chat-group').filter({has:page.getByRole('heading',{name:'Groq browser QA',exact:true})});
  await card.waitFor();
  if(deployed.length!==1||deployed[0].model!==models[0].id||!deployed[0].roundId)throw new Error('Allocation payload missing model or round');
  if(await card.getByRole('button',{name:'Thêm Pod',exact:true}).count())throw new Error('Groq advertises a Pod');
  if((await card.innerText()).includes('/giờ'))throw new Error('Groq has GPU hourly billing');
  await page.screenshot({path:'output/playwright/groq-admin-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.getByLabel('Nhà cung cấp khi cấp phát').scrollIntoViewIfNeeded();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1))throw new Error('Mobile horizontal overflow');
  await page.screenshot({path:'output/playwright/groq-admin-mobile.png',fullPage:true});
  const group='00000000-0000-4000-8000-0000000000ab',sessions=new Map();
  const attach=async p=>p.route('**/api/workspace/chat*',async route=>{
    const req=route.request(),u=new URL(req.url()),v=req.method()==='POST'?req.postDataJSON():Object.fromEntries(u.searchParams);
    if(u.pathname==='/api/workspace/chat/history')return route.fulfill({json:{items:[],nextCursor:null,roundTitle:'QA round',runId:'00000000-0000-4000-8000-0000000000ac',admin:true}});
    const s=sessions.get(v.session)||{messages:[],inputTokens:0,outputTokens:0};
    if(req.method()==='POST'){s.messages.push({role:'user',content:v.content},{role:'assistant',content:'Groq QA: '+v.content});s.inputTokens+=20;s.outputTokens+=10;sessions.set(v.session,s);}
    return route.fulfill({status:req.method()==='POST'?202:200,json:{provider:'groq',model:models[0].id,session:s,template:{tokenLimitMode:'turn',sessionTokenLimit:2000,inputTokenLimit:1800,outputTokenLimit:1024},enabled:true,policyOpen:true,teamName:'QA team',roundTitle:'QA round',runId:'00000000-0000-4000-8000-0000000000ac'}});
  });
  const chat=await page.context().newPage();await chat.setViewportSize({width:390,height:844});await attach(chat);await chat.goto(base+'/workspace/chat?groupId='+group);
  const ready=async p=>p.getByRole('textbox',{name:'Tin nhắn cho Chatbot'}).waitFor();
  await ready(chat);await chat.getByRole('textbox',{name:'Tin nhắn cho Chatbot'}).fill('tab A');await chat.getByRole('button',{name:'Gửi tin nhắn',exact:true}).click();await chat.getByText('Groq QA: tab A',{exact:true}).waitFor();
  const key='arena-chat:group:'+group,id=await chat.evaluate(k=>sessionStorage.getItem(k),key);
  const second=await page.context().newPage();await attach(second);await second.goto(base+'/workspace/chat?groupId='+group);await ready(second);
  if(await second.evaluate(k=>sessionStorage.getItem(k),key)===id)throw new Error('Groq tabs share a session');
  if(await second.locator('.chat-message').count())throw new Error('Groq tabs share history');
  await chat.reload();await ready(chat);await chat.getByText('Groq QA: tab A',{exact:true}).waitFor();
  if(await chat.evaluate(k=>sessionStorage.getItem(k),key)!==id)throw new Error('Refresh changed session');
  await chat.getByRole('button',{name:'Mở lịch sử trò chuyện'}).click();
  await chat.getByRole('button',{name:'Đoạn chat mới',exact:true}).click();
  if(await chat.evaluate(k=>sessionStorage.getItem(k),key)===id)throw new Error('New chat did not rotate session');
  await chat.screenshot({path:'output/playwright/groq-chat-mobile.png',fullPage:true});
  await second.close();await chat.close();
  await page.unrouteAll({behavior:'wait'});
  if(errors.length)throw new Error(errors.join('; '));
  return {result:'PASS',mockedProvider:true,checks:['provider selection','key clearing','model list','allocation payload','API card','desktop/mobile layout','Groq reply','separate tabs','refresh','new chat'],realProviderMutations:0};
}
