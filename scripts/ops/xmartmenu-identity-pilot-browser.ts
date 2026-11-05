import {initializeApp} from 'firebase/app'
import {getAuth,setPersistence,inMemoryPersistence,signInWithPopup,GoogleAuthProvider,signOut,RecaptchaVerifier,signInWithPhoneNumber} from 'firebase/auth'
import {PILOT_PREFIX,PILOT_ORIGIN} from './xmartmenu-identity-pilot-public'

const status=document.querySelector<HTMLParagraphElement>('#status')!
const email=document.querySelector<HTMLInputElement>('#email')!,password=document.querySelector<HTMLInputElement>('#password')!
let busy=false,pending:Awaited<ReturnType<typeof signInWithPhoneNumber>>|undefined,captcha:RecaptchaVerifier|undefined
const message=(text:string)=>{status.textContent=text}
async function api(operation:string,body?:object){
  const response=await fetch(`${PILOT_PREFIX}/api/${operation}`,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',
    headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined})
  if(!response.ok)throw new Error('Proof unavailable. Sign in again or use reviewed recovery.')
  return response.json()
}
async function client(){
  if(location.origin!==PILOT_ORIGIN)throw new Error('Wrong origin')
  const config=await api('config')
  const auth=getAuth(initializeApp(config,`xmartmenu-isolated-pilot-${config.projectId}`))
  await setPersistence(auth,inMemoryPersistence);return auth
}
const authentication=client().catch(()=>{message('Isolated sign-in is unavailable.');return null})
async function challenge(){return(await api('challenge',{})).challenge as string}
async function complete(idToken:string){
  let signedIn=false
  try{await api('session');signedIn=true}catch{/* A first independent Source proof is required. */}
  if(signedIn)await api('link',{idToken,challenge:await challenge()})
  else {
    if(!email.value.trim()||!password.value)throw new Error('Enter your previous account credentials first.')
    try{await api('existing-account-link',{email:email.value,password:password.value,idToken,challenge:await challenge()})}
    finally{password.value=''}
  }
  await api('login',{idToken,challenge:await challenge()});await api('session')
  message('The verified sign-in works in the isolated copy. Your existing account was preserved.')
}
async function run(action:()=>Promise<void>){
  if(busy)return;busy=true
  document.querySelectorAll<HTMLButtonElement>('button').forEach(button=>{button.disabled=true})
  try{await action()}catch{message('Proof unavailable. Check your previous credentials, request a fresh sign-in, or use reviewed recovery.')}
  finally{busy=false;document.querySelectorAll<HTMLButtonElement>('button').forEach(button=>{button.disabled=false})}
}
document.querySelector('#google')!.addEventListener('click',()=>void run(async()=>{
  const auth=await authentication;if(!auth)throw new Error('Unavailable');await api('config')
  try{const result=await signInWithPopup(auth,new GoogleAuthProvider());await complete(await result.user.getIdToken())}finally{await signOut(auth)}
}))
document.querySelector('#phone-form')!.addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
  const auth=await authentication;if(!auth)throw new Error('Unavailable');await api('config')
  if(pending){try{await complete(await(await pending.confirm(document.querySelector<HTMLInputElement>('#code')!.value)).user.getIdToken())}
    finally{pending=undefined;captcha?.clear();captcha=undefined;await signOut(auth);document.querySelector('#phone-submit')!.textContent='Send code';document.querySelector<HTMLInputElement>('#code')!.value=''}
  }else{
    const phone=document.querySelector<HTMLInputElement>('#phone')!.value.replace(/[\s()-]/g,'')
    if(!/^\+[1-9]\d{7,14}$/.test(phone))throw new Error('Invalid number')
    captcha=new RecaptchaVerifier(auth,document.querySelector<HTMLElement>('#captcha')!,{size:'normal'})
    try{pending=await signInWithPhoneNumber(auth,phone,captcha)}catch(error){captcha.clear();captcha=undefined;throw error}
    document.querySelector('#phone-submit')!.textContent='Verify code';message('Enter the code sent to your phone.')
  }
})})
document.querySelector('#logout')!.addEventListener('click',()=>void run(async()=>{pending=undefined;captcha?.clear();captcha=undefined;await api('logout',{});password.value='';message('Signed out of the isolated copy.')}))
