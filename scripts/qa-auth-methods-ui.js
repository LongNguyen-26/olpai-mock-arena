async page => {
 const base='http://localhost:3123',password='QA-account-password-12345',errors=[],bad=[];
 const check=(ok,m)=>{if(!ok)throw new Error(m)};
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=500)bad.push(r.status()+' '+new URL(r.url()).pathname)});
 const post=async(route,data)=>page.request.post(base+'/api/'+route,{headers:{Origin:base},data});
 await page.context().clearCookies();await page.setViewportSize({width:1440,height:1050});await page.goto(base+'/login');
 await page.getByRole('button',{name:'Dùng mã OTP / liên kết email',exact:true}).click();
 await page.getByRole('heading',{name:'Đăng nhập bằng email',exact:true}).waitFor();
 await page.screenshot({path:'output/playwright/account-layout-otp-desktop.png',fullPage:true});
 await page.getByRole('textbox',{name:'Email',exact:true}).fill('member@example.test');await page.getByRole('button',{name:'Gửi mã và liên kết',exact:true}).click();
 await page.getByLabel('Mã đăng nhập',{exact:true}).fill('123456');await page.getByRole('button',{name:'Xác nhận mã',exact:true}).click();
 await page.waitForURL(base+'/');await page.goto(base+'/#settings');await page.locator('.account-panel').waitFor();
 check((await page.locator('.account-panel').innerText()).includes('Email đã xác minh'),'verified status');
 const width=await page.evaluate(()=>{const panel=document.querySelector('.account-panel'),content=document.querySelector('.content'),style=getComputedStyle(content);return {panel:panel.getBoundingClientRect().width,available:content.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)};});
 check(width.panel>=width.available-2,'account does not fill available content');
 await page.getByRole('button',{name:'Cập nhật trường',exact:true}).click();
 await page.getByLabel('Tên trường',{exact:true}).fill('Đại học Bách khoa – ĐH Đà Nẵng');
 await page.getByRole('button',{name:'Lưu trường',exact:true}).click();
 await page.locator('.account-school').getByText('Đại học Bách khoa – ĐH Đà Nẵng',{exact:true}).waitFor();
 await page.reload();await page.locator('.account-school').getByText('Đại học Bách khoa – ĐH Đà Nẵng',{exact:true}).waitFor();
 await page.screenshot({path:'output/playwright/account-layout-overview-desktop.png',fullPage:true});

 await page.getByRole('button',{name:'Đổi mật khẩu',exact:true}).click();
 await page.getByLabel('Mật khẩu hiện tại',{exact:true}).waitFor();await page.getByLabel('Nhập lại mật khẩu mới',{exact:true}).waitFor();
 await page.screenshot({path:'output/playwright/account-layout-email-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'email mobile overflow');
 await page.screenshot({path:'output/playwright/account-layout-email-mobile.png',fullPage:true});
 await post('auth/logout',{});await page.setViewportSize({width:1440,height:1050});
 const google=await (await post('auth/google',{next:'/#settings'})).json();await page.goto(google.url);await page.locator('.account-panel').waitFor();
 check((await page.locator('.account-panel').innerText()).includes('Đã liên kết'),'Google status');
 check(await page.getByRole('button',{name:'Đổi mật khẩu',exact:true}).count()===1,'Google+password must offer change');
 await page.screenshot({path:'output/playwright/account-layout-google-password-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Google mobile overflow');await page.screenshot({path:'output/playwright/account-layout-google-password-mobile.png',fullPage:true});
 for (const w of [1024,768,320]) {await page.setViewportSize({width:w,height:1000});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'account overflow at '+w);check(await page.locator('.account-identity-copy').evaluate(e=>e.getBoundingClientRect().width>=120),'profile text squeezed at '+w);await page.screenshot({path:'output/playwright/account-layout-google-'+w+'.png',fullPage:true});}
 await post('auth/logout',{});await page.context().clearCookies();await page.goto(base+'/login');await page.getByRole('button',{name:'Quên mật khẩu?',exact:true}).click();
 await page.getByRole('textbox',{name:'Email',exact:true}).fill('google-new@example.test');await page.getByRole('button',{name:'Gửi liên kết đặt lại',exact:true}).click();await page.getByRole('status').waitFor();
 await page.screenshot({path:'output/playwright/account-layout-forgot-mobile.png',fullPage:true});
 await page.goto(base+'/email-login');await page.getByRole('heading',{name:'Đăng nhập bằng email',exact:true}).waitFor();check(await page.getByRole('button',{name:'Xác nhận đăng nhập'}).count()===0,'missing link not rejected');
 check(errors.length===0,errors.join(';'));check(bad.length===0,bad.join(';'));await page.context().clearCookies();
 return {result:'PASS',OTPThroughBrowser:true,emailAndGooglePasswordUI:true,desktopMobile:true,errors:errors.length,serverErrors:bad.length};
}
