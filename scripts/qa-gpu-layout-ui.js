/** CLI callback: real isolated QA login; all provider endpoints are mocked. */
async page => {
  const base='http://localhost:3007', shots='output/playwright/gpu-layout-';
  const check=(value,message)=>{if(!value)throw new Error(message)};
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.context().clearCookies();
  await page.setViewportSize({width:1600,height:1050});
  await page.goto(base+'/login');
  await page.getByRole('textbox',{name:'Email hoặc tên đăng nhập',exact:true}).fill('qa_admin');
  await page.getByRole('textbox',{name:'Mật khẩu',exact:true}).fill('QA-Admin-Refinements-2026!');
  await page.locator('form').getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await page.waitForURL(base+'/');
  const round=(await (await page.request.get(base+'/api/arena')).json()).rounds[0].id;
  const template={id:'00000000-0000-4000-8000-000000000040',name:'A40 · Môi trường luyện tập',gpuTypeId:'NVIDIA A40',cloudType:'SECURE',imageName:'example/workspace@sha256:qa',minRAMPerGPU:48,minVCPUPerGPU:8,containerDiskInGb:30,volumeInGb:100,sessionTokenLimit:2000,inputTokenLimit:1800,outputTokenLimit:1024};
  let workspaces=[{id:'qa-pod',teamName:'BKDN.AVENGERS',roundTitle:'Vòng luyện QA',roundId:round,scope:'team',services:'both',status:'running',podId:'vl683qgpypoaxf',template,estimatedUsd:0.0815,meterRate:0.59,uptimeSeconds:222,uptimeObservedAt:Date.now(),syncedAt:Date.now(),health:{gpu:'NVIDIA A40, 19687 MiB, 46068 MiB, 97 %',jupyter:false,llm:false,publicReady:false,privateReady:false,stage:'Pod đang chạy; đang chờ dịch vụ khởi động.'},accessMessage:'JupyterLab đang khởi động; chưa mở truy cập.'}];
  const deploys=[];
  await page.route('**/api/workspace/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith('/state'))return route.fulfill({json:{workspaces,templates:[template],defaultTemplate:template,hasCredential:true,encryptionReady:true,teams:[{id:'qa-team',name:'Đội QA',members:1}],serverNow:Date.now()}});
    if(path.endsWith('/prices'))return route.fulfill({json:{gpus:[{id:'NVIDIA A40',name:'NVIDIA A40',memory:48,price:{secure:0.59,community:0.39}}],fetchedAt:Date.now()}});
    if(path.endsWith('/sync'))return route.fulfill({json:{ok:true}});
    if(path.endsWith('/deploy')){deploys.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}})}
    throw new Error('Unexpected provider mutation: '+path);
  });
  await page.goto(base+'/?round='+round+'&tab=workspace');
  if(!await page.getByRole('heading',{name:'GPU Workspace',exact:true}).count())await page.getByRole('navigation',{name:'Điều hướng chính'}).getByRole('button',{name:'GPU Workspace',exact:true}).click();
  await page.locator('.gpu-metric-grid').waitFor();
  check((await page.locator('.gpu-metric-grid').innerText()).includes('19.2 / 45.0 GiB'),'Legacy telemetry conversion');
  check(!(await page.locator('body').innerText()).includes('Ước tính tổng'),'Floating total remains');
  check(await page.locator('.gpu-status-detail').getAttribute('open')===null,'Details should collapse');
  await page.screenshot({path:shots+'desktop.png',fullPage:true});
  await page.locator('.gpu-status-detail summary').click();
  check(await page.locator('.gpu-status-detail').getAttribute('open')!==null,'Status detail must expand');
  await page.locator('.gpu-status-detail summary').click();
  await page.getByRole('combobox',{name:'Dữ liệu trên JupyterLab',exact:true}).selectOption('none');
  await page.getByRole('combobox',{name:'Đội thi',exact:true}).selectOption('qa-team');
  await page.getByRole('button',{name:'Cấp 1 GPU riêng cho đội',exact:true}).click();
  await page.locator('.gpu-inline-notice').waitFor();
  check(deploys.length===1&&deploys[0].loadDataset===false,'No-dataset option must reach API');
  check(await page.locator('.gpu-inline-notice').evaluate(e=>e.parentElement.classList.contains('gpu-head-actions')),'Notice should sit with refresh');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:shots+'mobile.png',fullPage:true});
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile horizontal overflow');
  check(errors.length===0,errors.join('\n'));
  await page.context().unroute('**/api/workspace/**');
  await page.request.post(base+'/api/auth/logout',{data:{}});await page.context().clearCookies();
  console.log('PASS desktop/mobile: labeled legacy telemetry, collapsed status, inline notice, no floating total and no-dataset deployment payload; provider mocked.');
}
