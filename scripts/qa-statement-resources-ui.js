async page => {
 const base='http://localhost:3133',password='QA-round-groups-password-2026',errors=[],bad=[];const check=(v,m)=>{if(!v)throw new Error(m)};
 page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=500)bad.push(new URL(r.url()).pathname)});
 const post=(path,data)=>page.request.post(base+'/api/'+path,{headers:{Origin:base},data});
 const fits=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
 await page.context().clearCookies();await page.setViewportSize({width:1440,height:1050});await page.goto(base+'/');await page.locator('.round-directory').waitFor();
 for(const [value,title] of [['mock','Thi thử Olympic AI'],['topic','Luyện tập chuyên đề'],['selection','Thi tuyển chọn']]){await page.getByRole('combobox',{name:'Nhóm vòng luyện',exact:true}).selectOption(value);const h=page.getByRole('region',{name:'Kết quả vòng luyện'});check(await h.locator('h2 svg').count()===1,'category icon '+value);check(await h.locator('.directory-section-heading p').count()===2,'category description and count');check((await h.locator('.directory-section-heading h2').innerText())===title,'category title');}
 const rounds=(await (await page.request.get(base+'/api/arena')).json()).rounds;
 const regional=rounds.find(r=>r.title==='QA Regional 01'),mock=rounds.find(r=>r.title==='QA Mô phỏng thi 03');check(regional&&mock,'resource fixtures');
 for(const round of [regional,mock]){
  await page.goto(base+'/?round='+round.id+'&task=general#statement');await page.getByRole('button',{name:'Hướng dẫn chung',exact:true}).waitFor();
  const tabs=await page.locator('.statement-head .segmented button').allTextContents();check(JSON.stringify(tabs)===JSON.stringify(['Tác vụ 01','Tác vụ 02','Hướng dẫn chung']),'guide after tasks');
  check((await page.locator('.statement-title h2').innerText())==='Hướng dẫn chung','general deep link');
  check((await page.locator('.statement-panel .prose').first().innerText()).includes(round===regional?'Giai đoạn làm bài':'Dữ liệu và mã nguồn mẫu'),'general content');
  if(round===mock){await page.locator('.statement-attributions summary').click();check((await page.locator('.statement-attributions').innerText()).includes('Oxford-IIIT Pet'),'attributions preserved');}
  await page.screenshot({path:'output/playwright/statement-guide-'+(round===regional?'regional':'mock')+'.png',fullPage:true});
  for(const task of ['01','02']){await page.getByRole('button',{name:'Tác vụ '+task,exact:true}).click();await page.locator('.prose .katex-display').first().waitFor();check(await page.locator('.katex-error').count()===0,'valid math');check(await page.locator('.prose math').count()>0,'accessible math');await page.locator('.prose .katex-display').first().scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/statement-math-'+(round===regional?'regional':'mock')+'-'+task+'.png',fullPage:false});for(const w of [390,320]){await page.setViewportSize({width:w,height:844});check(await fits(),'math overflow '+w);await page.locator('.prose .katex-display').first().scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/statement-math-'+(round===regional?'regional':'mock')+'-'+task+'-'+w+'.png',fullPage:false});}await page.setViewportSize({width:1440,height:1050});}
 }
 check((await post('auth/login',{username:'qa_groups_student',password})).status()===200,'student login');
 for(const round of [regional,mock]){
  await page.goto(base+'/?round='+round.id+'#data');await page.locator('.asset-grid').waitFor();const names=await page.locator('.asset-card h3').allTextContents();check(!names.some(n=>n.includes('private')),'private locked');
  if(round===regional){check(names.includes('Bo_de_Regional_01.pdf'),'combined PDF kept');check(await page.locator('.asset-notebook').count()===3,'accurate notebook names');check(await page.locator('.asset-icon .lucide-file-text').count()===3,'PDF icons');check(await page.locator('.asset-icon .lucide-database').count()===2,'ZIP icons');check((await page.locator('.asset-notebooks').allTextContents()).join(' ').includes('baseline.ipynb'),'standard baseline');}
  else{check(!names.includes('Ghi_cong_va_giay_phep.txt')&&!names.includes('Huong_dan_chung.pdf'),'inline files removed');check(await page.locator('.asset-notebook').count()===0,'old package no new badge');}
  await page.screenshot({path:'output/playwright/statement-data-'+(round===regional?'regional':'mock')+'.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});check(await fits(),'data overflow');await page.screenshot({path:'output/playwright/statement-data-'+(round===regional?'regional':'mock')+'-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1050});
 }
 await post('auth/logout',{});await page.context().clearCookies();check(!errors.length,errors.join(';'));check(!bad.length,bad.join(';'));
 return {result:'PASS',categoryIconsDescription:true,generalAfterTasks:true,generalDeepLink:true,licensesPreserved:true,mathFourTasks:true,noKatexErrors:true,notebookBadges:true,documentIcons:true,combinedPdfKept:true,scopePreserved:true,desktopMobile:true,errors:0,serverErrors:0};
}