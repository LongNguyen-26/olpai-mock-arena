// Run on the isolated localhost SQL fixture; enqueues one real SQL job.
async page => {
  const base = new URL(page.url()).origin;
  if (!base.startsWith('http://localhost:')) throw new Error('Use the local QA fixture');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const response=await page.request.get(base+'/api/workspace/state');
  if(!response.ok())throw new Error('SQL fixture state unavailable');
  const state=await response.json(),group=state.chatGroups.find(g=>g.name==='SQL QA Groq');
  if(state.runpodMode!=='disabled'||!group)throw new Error('Unexpected QA fixture');
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/#workspace');
  await page.getByText('GPU/Jupyter đang tạm ngừng. Các chatbot đã cấp và lịch sử vẫn có thể truy cập.',{exact:true}).waitFor();
  const disabled=await page.getByLabel('Nhà cung cấp khi cấp phát').locator('option[value="runpod"]').isDisabled();
  if(!disabled)throw new Error('Runpod option must be disabled');
  await page.screenshot({path:'output/playwright/sql-runtime-workspace-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Mobile horizontal overflow');
  await page.screenshot({path:'output/playwright/sql-runtime-workspace-mobile.png',fullPage:true});
  await page.goto(base+'/workspace/chat?groupId='+group.id);
  const input=page.getByRole('textbox',{name:'Tin nhắn cho Chatbot'});
  await input.waitFor();await input.fill('Browser to SQL queue QA');
  const posted=page.waitForResponse(r=>r.url().endsWith('/api/workspace/chat')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Gửi tin nhắn',exact:true}).click();
  if((await posted).status()!==202)throw new Error('SQL chat enqueue failed');
  if(errors.length)throw new Error(errors.join('; '));
  return {result:'PASS',runpodDisabled:true,desktopMobile:true,realSqlEnqueue:true,providerCalls:0};
}
